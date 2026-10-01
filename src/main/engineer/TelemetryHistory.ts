import { toolResultFits } from './toolLimits'
import { CircuitPace } from './CircuitPace'
import { StrategyJournal } from './StrategyTools'
import type { RaceState, RecentEvent, TyreCompound } from '@shared/types/state'
import { WeekendIdentity } from './WeekendIdentity'
import type { WeekendIdentitySnapshot, WeekendIdentityTransition } from './WeekendIdentity'

interface Sample {
  ts: number
  data: string
  bytes: number
  sessionKey: string
  frame: number
  lap: number
}

interface StoredRecord {
  ts: number
  data: string
  bytes: number
  key: string
}

interface PacketSample extends StoredRecord {
  frame: number | null
  sampledAt: number
}

interface Rollback {
  sessionKey: string
  detectedAt: number
  previousFrame: number
}

interface StintData {
  id: number
  sessionKey: string
  sessionUid: string
  sessionType: number
  startTs: number
  endTs: number
  startLap: number
  endLap: number
  compound: TyreCompound
  rawCompoundId: number
  tyreAgeStart: number
  tyreAgeEnd: number
  pitStopCount: number
  fuelStartKg: number | null
  fuelEndKg: number | null
  wearStart: RaceState['player']['tyres']['wear']
  wearEnd: RaceState['player']['tyres']['wear']
}

const MEMORY_BUDGET_BYTES = 256 * 1024 * 1024
const RECENT_WINDOW_MS = 5 * 60 * 1000
const RECENT_INTERVAL_MS = 500
const OLDER_INTERVAL_MS = 5000
const MAX_PACKET_SAMPLES = 12
const MAX_LAPS = 10_000
const MAX_EVENTS = 8192
const MAX_STINTS = 1024
const MAX_SESSIONS = 64
const MAX_PACKET_JSON_CHARS = 100_000
const MAX_PACKET_ARRAY_PAGE = 64
const MAX_FIELD_DEPTH = 8
const FIELD_SEGMENT_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/
const BLOCKED_FIELD_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor'])
const EVENT_TYPES = new Set<RecentEvent['type']>([
  'fastestLap', 'retirement', 'sessionEnded', 'penalty', 'warning', 'raceWinner', 'safetyCar', 'vsc',
  'redFlag', 'yellowFlag', 'blueFlag', 'greenFlag', 'weatherChange', 'pitEntered', 'pitExited',
  'collision', 'damage', 'overtake', 'spin'
])

/** Retains sampled telemetry and summaries for the active race weekend, in memory only. */
export class TelemetryHistory {
  readonly circuitPace = new CircuitPace()
  readonly strategyJournal = new StrategyJournal()
  private samples: Sample[] = []
  private laps: StoredRecord[] = []
  private events: StoredRecord[] = []
  private stints: StoredRecord[] = []
  private sessions: StoredRecord[] = []
  private packets = new Map<string, PacketSample[]>()
  private readonly eventKeys = new Set<string>()
  private readonly lapKeys = new Set<string>()
  private readonly identity = new WeekendIdentity()
  private packetSession = ''
  private memoryBytes = 0
  private nextStintId = 1
  private frameHighWater: { sessionKey: string; frame: number } | null = null
  private rollback: Rollback | null = null

  inventory(now = Date.now()): string {
    const latest = this.samples[this.samples.length - 1]
    const first = this.samples[0]
    const current = this.identity.current()
    return JSON.stringify({
      capturedAt: latest?.ts ?? null,
      ageMs: latest ? now - latest.ts : null,
      sampleCount: this.samples.length,
      retainedWindowS: 300,
      weekendCapturedS: first && latest ? Math.max(0, Math.floor((latest.ts - first.ts) / 1000)) : 0,
      sampling: { recentHz: 2, olderIntervalS: 5, recentWindowS: 300 },
      memory: { estimatedBytes: this.memoryBytes, budgetBytes: MEMORY_BUDGET_BYTES },
      weekend: current,
      sessions: this.sessions.map(record => parseRecord(record.data)),
      lapBoundaries: this.laps.slice(-120).map(record => parseRecord(record.data).completedLap),
      eventCount: this.events.length,
      stintCount: this.stints.length,
      packets: [...this.packets].map(([key, values]) => ({
        key,
        latestTs: values[values.length - 1]?.ts ?? null,
        samples: values.length
      })),
      limitations: 'In-memory current-weekend history only; there is no raw UDP archive. Packet snapshots are decoded JSON, strings truncated to 256 characters, up to 12 samples per packet key with a live latest value and older samples at 5-second spacing. Normalized state covers packets 0-7, 10, 11 and 16; packets 8, 9 and 12-15 are decoded and readable only through read_telemetry_packet. Packet 16 (carTelemetry2) exists only in the 2026 format. Large packets must be read with field/arrayOffset/arrayLimit. Restricted or default zeros are not confirmed healthy data.'
    })
  }

  readState(section: string): unknown {
    const latest = this.samples[this.samples.length - 1]
    const state = latest ? tryParseState(latest.data) : null
    return state ? { ts: latest.ts, data: selectSection(state, section) }
      : { unavailable: latest ? 'corrupt telemetry sample' : true }
  }

  /** Latest normalized state, or null when nothing usable is retained. */
  latestState(): RaceState | null {
    const latest = this.samples[this.samples.length - 1]
    return latest ? tryParseState(latest.data) : null
  }

  /** Short bounded 2 Hz window for motion evidence, separate from 5-second trend pages. */
  recentPositionStates(now = Date.now()): RaceState[] {
    const latest = this.samples.at(-1)
    if (!latest) return []
    return this.samples.slice(-7).filter(sample => sample.sessionKey === latest.sessionKey &&
      sample.ts <= now && now - sample.ts <= 3000)
      .flatMap(sample => { const state = tryParseState(sample.data); return state ? [state] : [] })
  }

  thermalStates(now = Date.now()): RaceState[] {
    const latest = this.samples.at(-1)
    if (!latest) return []
    return this.samples.slice(-600).filter(sample => sample.sessionKey === latest.sessionKey &&
      sample.ts <= now && now - sample.ts <= RECENT_WINDOW_MS)
      .flatMap(sample => { const state = tryParseState(sample.data); return state ? [state] : [] })
  }

  readHistory(section: string, offset: number, limit: number): unknown {
    const recent: Sample[] = []
    for (let i = this.samples.length - 1; i >= 0; i--) {
      const sample = this.samples[i]
      const picked = recent[recent.length - 1]
      if (!picked || picked.sessionKey !== sample.sessionKey || picked.ts - sample.ts >= OLDER_INTERVAL_MS) {
        recent.push(sample)
      }
    }
    const safeOffset = safePage(offset, 0)
    const safeLimit = safePage(limit, 3)
    const page = recent.slice(safeOffset, safeOffset + safeLimit)
    return {
      order: 'newest first, 5 second samples',
      total: recent.length,
      nextOffset: safeOffset + safeLimit < recent.length ? safeOffset + safeLimit : null,
      samples: page.map(sample => ({ ts: sample.ts, data: selectSection(parseState(sample.data), section) }))
    }
  }

  readLaps(section: string, offset: number, limit: number): unknown {
    const recent = [...this.laps].reverse()
    const safeOffset = safePage(offset, 0)
    const safeLimit = safePage(limit, 3)
    const page = recent.slice(safeOffset, safeOffset + safeLimit)
    return {
      order: 'newest completed lap first',
      validity: 'Boundary observations; check flags, pit status and original lap validity before comparing.',
      total: recent.length,
      nextOffset: safeOffset + safeLimit < recent.length ? safeOffset + safeLimit : null,
      laps: page.map(record => {
        const lap = parseRecord(record.data)
        const boundary = tryParseState(lap.state)
        return { ts: record.ts, completedLap: lap.completedLap,
          data: boundary ? selectSection(boundary, section) : { unavailable: 'corrupt lap boundary record' } }
      })
    }
  }

  readEvents(offset = 0, limit = 50): unknown {
    const recent = [...this.events].reverse()
    const safeOffset = safePage(offset, 0)
    const safeLimit = safePage(limit, 50)
    const page = recent.slice(safeOffset, safeOffset + safeLimit)
    return { order: 'newest first', total: recent.length,
      nextOffset: safeOffset + safeLimit < recent.length ? safeOffset + safeLimit : null,
      events: page.map(record => ({ ts: record.ts, data: parseRecord(record.data).event })) }
  }

  readStints(offset = 0, limit = 50): unknown {
    const recent = [...this.stints].reverse()
    const safeOffset = safePage(offset, 0)
    const safeLimit = safePage(limit, 50)
    const page = recent.slice(safeOffset, safeOffset + safeLimit)
    return { order: 'newest stint first', total: recent.length,
      nextOffset: safeOffset + safeLimit < recent.length ? safeOffset + safeLimit : null,
      stints: page.map(record => parseRecord(record.data)) }
  }

  recordPacket(packetId: number, packet: Record<string, unknown>, now = Date.now()): void {
    if (!Number.isInteger(packetId) || packetId < 0 || packetId > 16 || !Number.isFinite(now)) return
    const transition = this.identity.observePacket(packet, now)
    if (transition) {
      if (!this.applyTransition(transition, now)) return
    }

    const header = asRecord(packet.m_header)
    const uid = safeUid(header?.m_sessionUID) ?? ''
    if (uid && this.identity.isInactiveKnownSession(uid)) return
    if (uid !== this.packetSession) {
      this.clearPackets()
      this.packetSession = uid
    }

    const car = Number(packet.m_carIdx)
    const key = `${packetId}${Number.isInteger(car) && car >= 0 && car < 24 ? ':' + car : ''}`
    const entries = this.packets.get(key) ?? []
    const frame = safeInteger(header?.m_frameIdentifier, 0, 0xffffffff)
    let json: string
    try {
      json = JSON.stringify(packet, (_key, value: unknown) => {
        if (typeof value === 'bigint') return value.toString()
        if (typeof value === 'string') return value.slice(0, 256)
        if (typeof value === 'number' && !Number.isFinite(value)) return null
        return value
      })
    } catch {
      return
    }
    if (json.length > MAX_PACKET_JSON_CHARS) return
    const last = entries[entries.length - 1]
    if (last && ((frame !== null && frame === last.frame && (packetId !== 3 || json === last.data)) || json === last.data)) return

    const record: PacketSample = { ts: now, data: json, frame, sampledAt: now, key, bytes: estimatedRecordBytes(json, key) }
    // Keep the newest sample live between 5-second buckets so offset 0 is fresh,
    // while older entries keep their recorded spacing.
    if (last && packetId !== 3 && now - last.sampledAt < OLDER_INTERVAL_MS) {
      const refreshed = { ...record, sampledAt: last.sampledAt }
      entries[entries.length - 1] = refreshed
      this.memoryBytes += refreshed.bytes - last.bytes
      this.enforceMemoryBudget()
      return
    }
    entries.push(record)
    this.packets.set(key, entries)
    this.memoryBytes += record.bytes
    while (entries.length > MAX_PACKET_SAMPLES) this.removePacket(key, 0)
    this.enforceMemoryBudget()
  }

  query(args: unknown): string {
    if (!args || typeof args !== 'object' || Array.isArray(args)) return 'Invalid history query'
    const input = args as Record<string, unknown>
    const allowed = new Set(['packet', 'offset', 'field', 'arrayOffset', 'arrayLimit'])
    if (Reflect.ownKeys(input).some(key => typeof key !== 'string' || !allowed.has(key))) return 'Invalid history query'
    const { packet, field } = input
    const offset = input.offset ?? 0
    const hasArrayOptions = Object.prototype.hasOwnProperty.call(input, 'arrayOffset') ||
      Object.prototype.hasOwnProperty.call(input, 'arrayLimit')
    const arrayOffset = input.arrayOffset ?? 0
    const arrayLimit = input.arrayLimit ?? 16
    if (typeof packet !== 'string' || !/^\d{1,2}(?::\d{1,2})?$/.test(packet) ||
      typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0 || offset >= MAX_PACKET_SAMPLES ||
      (field !== undefined && !isFieldPath(field)) ||
      (hasArrayOptions && field === undefined) ||
      typeof arrayOffset !== 'number' || !Number.isInteger(arrayOffset) || arrayOffset < 0 || arrayOffset > 10_000 ||
      typeof arrayLimit !== 'number' || !Number.isInteger(arrayLimit) || arrayLimit < 1 || arrayLimit > MAX_PACKET_ARRAY_PAGE) {
      return 'Invalid history query'
    }
    const entries = this.packets.get(packet)
    const result = entries?.[entries.length - 1 - offset]
    if (!result) return JSON.stringify({ unavailable: true, packet })
    const data = parseRecord(result.data)
    if (field === undefined) {
      const encoded = JSON.stringify({ ts: result.ts, data })
      return packetQueryFits(encoded) ? encoded : packetTooLarge(result.ts, packet)
    }

    const selection = readFieldPath(data, field)
    if (!selection.found) return JSON.stringify({ unavailable: true, packet, field })
    if (Array.isArray(selection.value)) {
      const items = selection.value.slice(arrayOffset, arrayOffset + arrayLimit)
      const payload = {
        ts: result.ts,
        packet,
        field,
        data: {
          total: selection.value.length,
          offset: arrayOffset,
          items,
          nextOffset: arrayOffset + items.length < selection.value.length ? arrayOffset + items.length : null
        }
      }
      const encoded = JSON.stringify(payload)
      return packetQueryFits(encoded) ? encoded : packetTooLarge(result.ts, packet, field)
    }
    if (hasArrayOptions) return 'Invalid history query: array paging requires an array field'
    const encoded = JSON.stringify({ ts: result.ts, packet, field, data: selection.value })
    return packetQueryFits(encoded) ? encoded : packetTooLarge(result.ts, packet, field)
  }

  observe(state: RaceState, now = Date.now()): void {
    if (!Number.isFinite(now) || !Number.isFinite(state.lastPacketMs)) return
    const age = now - state.lastPacketMs
    if (age < 0 || age > 5000) return

    let transition = this.identity.observeState(state, now)
    if (!this.applyTransition(transition, now)) return
    if (!state.lastPacketMs || state.flashbackActive) {
      this.circuitPace.reset()
      if (state.flashbackActive) this.noteRollback(state, now, transition.sessionKey)
      return
    }

    let sessionKey = transition.sessionKey
    const frame = safeInteger(state.session.overallFrameIdentifier, 0, 0xffffffff)
    if (frame !== null) {
      if (this.frameHighWater && this.frameHighWater.sessionKey === sessionKey &&
        frame < this.frameHighWater.frame - 5) {
        if (!this.rollback || this.rollback.sessionKey !== sessionKey) {
          this.noteRollback(state, now, sessionKey)
          return
        }
        if (frame >= this.rollback.previousFrame - 5) {
          this.rollback = null
        } else if (now - this.rollback.detectedAt < 5000) {
          return
        } else {
          transition = this.identity.restartState(state, now)
          if (!this.applyTransition(transition, now)) return
          sessionKey = transition.sessionKey
          this.frameHighWater = null
          this.rollback = null
        }
      } else if (this.frameHighWater && this.frameHighWater.sessionKey === sessionKey &&
        frame < this.frameHighWater.frame) {
        return
      }
    }

    const previous = this.latestSampleForSession(sessionKey)
    if (previous && now === previous.ts) return
    if (previous && now - previous.ts < RECENT_INTERVAL_MS) return

    const stateJson = serialize(telemetryCopy(state))
    if (!stateJson) return
    const sample: Sample = {
      ts: now,
      data: stateJson,
      bytes: estimatedRecordBytes(stateJson, sessionKey),
      sessionKey,
      frame: frame ?? -1,
      lap: safeInteger(state.player.lap, 0, 100_000) ?? 0
    }
    this.samples.push(sample)
    this.circuitPace.observe(state, now)
    this.memoryBytes += sample.bytes

    if (previous && previous.lap > 0 && sample.lap > previous.lap &&
      !this.lapKeys.has(`${sessionKey}:${sample.lap - 1}`)) {
      this.addLap(sessionKey, sample.lap - 1, now, stateJson)
    }
    this.recordEvents(state.recentEvents, sessionKey, now)
    this.updateStint(state, sessionKey, now, transition)
    if (frame !== null) this.frameHighWater = { sessionKey, frame: Math.max(frame, this.frameHighWater?.sessionKey === sessionKey ? this.frameHighWater.frame : frame) }
    this.rollback = null
    this.compactOlderSamples(now)
    this.enforceMemoryBudget()
  }

  reset(): void {
    this.strategyJournal.reset()
    this.circuitPace.reset()
    this.identity.reset()
    this.clearRecords()
  }

  private applyTransition(transition: WeekendIdentityTransition, now: number): boolean {
    if (transition.duplicate) return false
    if (transition.newWeekend) this.clearRecords()
    if (transition.newSession) {
      this.strategyJournal.reset()
      this.circuitPace.reset()
      this.clearPackets()
      this.packetSession = transition.sessionUid
      this.frameHighWater = null
      this.rollback = null
    }
    this.upsertSession(transition, now)
    return true
  }

  private upsertSession(identity: WeekendIdentityTransition, now: number): void {
    const previous = this.sessions[this.sessions.length - 1]
    if (previous && previous.key === identity.sessionKey) {
      const data = parseRecord(previous.data)
      const nextData = serialize({ ...identitySnapshot(identity), startTs: data.startTs,
        endTs: now, restart: data.restart || identity.restart })
      if (nextData) this.replaceRecord(previous, nextData)
      return
    }
    const data = serialize({ ...identitySnapshot(identity), startTs: now, endTs: now,
      restart: identity.restart })
    if (!data) return
    const record: StoredRecord = { ts: now, data, key: identity.sessionKey,
      bytes: estimatedRecordBytes(data, identity.sessionKey) }
    this.sessions.push(record)
    this.memoryBytes += record.bytes
    while (this.sessions.length > MAX_SESSIONS) this.removeRecord(this.sessions, 0)
  }

  private addLap(sessionKey: string, completedLap: number, now: number, state: string): void {
    const key = `${sessionKey}:${completedLap}`
    // The generic serializer truncates strings to 256 characters, which would cut this
    // embedded state JSON in half and make every later readLaps() parse throw.
    const data = embedRecord({ completedLap, state })
    if (!data) return
    const record: StoredRecord = { ts: now, data, key, bytes: estimatedRecordBytes(data, key) }
    this.laps.push(record)
    this.lapKeys.add(key)
    this.memoryBytes += record.bytes
    while (this.laps.length > MAX_LAPS) this.removeRecord(this.laps, 0, this.lapKeys)
  }

  private recordEvents(events: RecentEvent[], sessionKey: string, now: number): void {
    for (const candidate of events.slice(-12)) {
      if (!candidate || typeof candidate.id !== 'string' || !EVENT_TYPES.has(candidate.type)) continue
      const id = candidate.id.slice(0, 128)
      const key = `${sessionKey}:${id}`
      if (!id || this.eventKeys.has(key)) continue
      const event = {
        id,
        ts: Number.isFinite(candidate.ts) ? candidate.ts : now,
        type: candidate.type,
        ...(Number.isInteger(candidate.carIndex) && candidate.carIndex! >= 0 && candidate.carIndex! < 24
          ? { carIndex: candidate.carIndex } : {}),
        text: typeof candidate.text === 'string' ? candidate.text.slice(0, 256) : ''
      }
      const data = serialize({ event })
      if (!data) continue
      const record: StoredRecord = { ts: now, data, key, bytes: estimatedRecordBytes(data, key) }
      this.events.push(record)
      this.eventKeys.add(key)
      this.memoryBytes += record.bytes
      while (this.events.length > MAX_EVENTS) this.removeRecord(this.events, 0, this.eventKeys)
    }
  }

  private updateStint(state: RaceState, sessionKey: string, now: number, identity: WeekendIdentitySnapshot): void {
    const currentRecord = this.stints[this.stints.length - 1]
    let current: StintData | null = null
    if (currentRecord?.key === sessionKey) {
      const parsed = parseRecord(currentRecord.data)
      current = parsed.stint as StintData
    }
    const player = state.player
    const compound = player.tyres.compound
    const rawCompoundId = player.tyres.rawCompoundId
    const tyreAge = safeInteger(player.tyres.ageLaps, 0, 10_000) ?? 0
    const pitStopCount = safeInteger(player.pitStopCount, 0, 10_000) ?? 0
    const compoundKnown = compound !== 'unknown'
    const tyreChanged = !!current && compoundKnown && current.compound !== 'unknown' &&
      (current.compound !== compound || (rawCompoundId >= 0 && current.rawCompoundId >= 0 && rawCompoundId !== current.rawCompoundId))
    const ageReset = !!current && current.tyreAgeEnd >= 2 && tyreAge + 1 < current.tyreAgeEnd
    const pitChanged = !!current && pitStopCount > current.pitStopCount

    if (!current || current.sessionKey !== sessionKey || tyreChanged || ageReset || pitChanged) {
      const stint: StintData = {
        id: this.nextStintId++,
        sessionKey,
        sessionUid: identity.sessionUid,
        sessionType: identity.sessionType,
        startTs: now,
        endTs: now,
        startLap: safeInteger(player.lap, 0, 100_000) ?? 0,
        endLap: safeInteger(player.lap, 0, 100_000) ?? 0,
        compound,
        rawCompoundId,
        tyreAgeStart: tyreAge,
        tyreAgeEnd: tyreAge,
        pitStopCount,
        fuelStartKg: finiteOrNull(player.fuelRemainingKg),
        fuelEndKg: finiteOrNull(player.fuelRemainingKg),
        wearStart: player.tyres.wear,
        wearEnd: player.tyres.wear
      }
      const data = serialize({ stint })
      if (!data) return
      const record: StoredRecord = { ts: now, data, key: sessionKey,
        bytes: estimatedRecordBytes(data, sessionKey) }
      this.stints.push(record)
      this.memoryBytes += record.bytes
      while (this.stints.length > MAX_STINTS) this.removeRecord(this.stints, 0)
      return
    }

    if (current.compound === 'unknown' && compoundKnown) {
      current.compound = compound
      current.rawCompoundId = rawCompoundId
      current.tyreAgeStart = tyreAge
    }
    current.endTs = now
    current.endLap = safeInteger(player.lap, 0, 100_000) ?? current.endLap
    current.tyreAgeEnd = tyreAge
    current.pitStopCount = pitStopCount
    current.fuelEndKg = finiteOrNull(player.fuelRemainingKg)
    current.wearEnd = player.tyres.wear
    const data = serialize({ stint: current })
    if (data && currentRecord) this.replaceRecord(currentRecord, data)
  }

  private latestSampleForSession(sessionKey: string): Sample | undefined {
    for (let i = this.samples.length - 1; i >= 0; i--) {
      if (this.samples[i].sessionKey === sessionKey) return this.samples[i]
    }
    return undefined
  }

  private noteRollback(state: RaceState, now: number, sessionKey: string): void {
    this.circuitPace.reset()
    this.strategyJournal.reset()
    const frame = safeInteger(state.session.overallFrameIdentifier, 0, 0xffffffff)
    this.rollback = { sessionKey, detectedAt: now,
      previousFrame: this.frameHighWater?.sessionKey === sessionKey ? this.frameHighWater.frame : frame ?? 0 }
  }

  private compactOlderSamples(now: number): void {
    const cutoff = now - RECENT_WINDOW_MS
    const lastBucketBySession = new Map<string, number>()
    const keep = new Set<number>()
    for (let i = this.samples.length - 1; i >= 0; i--) {
      const sample = this.samples[i]
      if (sample.ts >= cutoff) {
        keep.add(i)
        continue
      }
      const bucket = Math.floor(sample.ts / OLDER_INTERVAL_MS)
      const lastBucket = lastBucketBySession.get(sample.sessionKey)
      if (lastBucket === undefined || lastBucket !== bucket) {
        keep.add(i)
        lastBucketBySession.set(sample.sessionKey, bucket)
      }
    }
    if (keep.size === this.samples.length) return
    const compacted: Sample[] = []
    for (let i = 0; i < this.samples.length; i++) {
      if (keep.has(i)) compacted.push(this.samples[i])
      else this.memoryBytes -= this.samples[i].bytes
    }
    this.samples = compacted
  }

  private enforceMemoryBudget(): void {
    while (this.memoryBytes > MEMORY_BUDGET_BYTES) {
      const candidates: Array<{ ts: number; remove: () => void }> = []
      const consider = (ts: number | undefined, remove: () => void) => {
        if (ts !== undefined) candidates.push({ ts, remove })
      }
      const sample = this.samples[0]
      if (sample) consider(sample.ts, () => {
        this.samples.shift()
        this.memoryBytes -= sample.bytes
      })
      const lap = this.laps[0]
      if (lap) consider(lap.ts, () => this.removeRecord(this.laps, 0, this.lapKeys))
      const event = this.events[0]
      if (event) consider(event.ts, () => this.removeRecord(this.events, 0, this.eventKeys))
      const stint = this.stints.length > 1 ? this.stints[0] : undefined
      if (stint) consider(stint.ts, () => this.removeRecord(this.stints, 0))
      const session = this.sessions.length > 1 ? this.sessions[0] : undefined
      if (session) consider(session.ts, () => this.removeRecord(this.sessions, 0))
      for (const [key, entries] of this.packets) {
        const packet = entries[0]
        if (packet) consider(packet.ts, () => this.removePacket(key, 0))
      }
      if (candidates.length === 0) break
      candidates.sort((a, b) => a.ts - b.ts)
      candidates[0].remove()
    }
  }

  private replaceRecord(record: StoredRecord, data: string): void {
    const bytes = estimatedRecordBytes(data, record.key)
    this.memoryBytes += bytes - record.bytes
    record.data = data
    record.bytes = bytes
  }

  private removeRecord(records: StoredRecord[], index: number, keys?: Set<string>): void {
    const [record] = records.splice(index, 1)
    if (!record) return
    this.memoryBytes -= record.bytes
    keys?.delete(record.key)
  }

  private removePacket(key: string, index: number): void {
    const entries = this.packets.get(key)
    const [record] = entries?.splice(index, 1) ?? []
    if (record) this.memoryBytes -= record.bytes
    if (entries && entries.length === 0) this.packets.delete(key)
  }

  private clearPackets(): void {
    for (const entries of this.packets.values()) {
      for (const packet of entries) this.memoryBytes -= packet.bytes
    }
    this.packets.clear()
  }

  private clearRecords(): void {
    this.circuitPace.reset()
    this.strategyJournal.reset()
    this.samples = []
    this.laps = []
    this.events = []
    this.stints = []
    this.sessions = []
    this.packets.clear()
    this.eventKeys.clear()
    this.lapKeys.clear()
    this.packetSession = ''
    this.memoryBytes = 0
    this.nextStintId = 1
    this.frameHighWater = null
    this.rollback = null
  }
}

function telemetryCopy(state: RaceState): RaceState {
  const bounded = { ...state,
    rivals: Object.fromEntries(Object.entries(state.rivals).slice(0, 24)),
    recentEvents: state.recentEvents.slice(-12),
    trackPositions: state.trackPositions.slice(0, 24) }
  return JSON.parse(JSON.stringify(bounded, (_key, value: unknown) => {
    if (typeof value === 'string') return value.slice(0, 256)
    if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null
    if (typeof value === 'bigint') return value.toString()
    return value
  })) as RaceState
}

function selectSection(state: RaceState, section: string): unknown {
  switch (section) {
    case 'player': return state.player
    case 'rivals': return state.rivals
    case 'weather': return state.weather
    case 'session': return state.session
    case 'trackPositions': return state.trackPositions
    case 'events': return state.recentEvents
    case 'all': return state
    default: return { error: 'Unknown section' }
  }
}

function serialize(value: unknown): string | null {
  try {
    return JSON.stringify(value, (_key, item: unknown) => {
      if (typeof item === 'bigint') return item.toString()
      if (typeof item === 'string') return item.slice(0, 256)
      if (typeof item === 'number' && !Number.isFinite(item)) return null
      return item
    })
  } catch {
    return null
  }
}

function parseState(json: unknown): RaceState {
  if (typeof json !== 'string') throw new TypeError('Stored race state must be a string')
  return JSON.parse(json) as RaceState
}

/** Same as parseState but returns null instead of throwing on a damaged record. */
function tryParseState(json: unknown): RaceState | null {
  try {
    return parseState(json)
  } catch {
    return null
  }
}

/**
 * Record envelope for records that embed a full serialized RaceState. The generic
 * serializer truncates strings at 256 characters, which would corrupt the embedded
 * JSON; this one only guards against non-finite values.
 */
function embedRecord(value: unknown): string | null {
  try {
    return JSON.stringify(value, (_key, item: unknown) => {
      if (typeof item === 'bigint') return item.toString()
      if (typeof item === 'number' && !Number.isFinite(item)) return null
      return item
    })
  } catch {
    return null
  }
}

function parseRecord(json: string): Record<string, unknown> {
  const value: unknown = JSON.parse(json)
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Stored telemetry record must be an object')
  }
  return value as Record<string, unknown>
}

function identitySnapshot(transition: WeekendIdentityTransition): WeekendIdentitySnapshot {
  return {
    weekendKey: transition.weekendKey,
    sessionKey: transition.sessionKey,
    sessionUid: transition.sessionUid,
    seasonLinkIdentifier: transition.seasonLinkIdentifier,
    weekendLinkIdentifier: transition.weekendLinkIdentifier,
    sessionLinkIdentifier: transition.sessionLinkIdentifier,
    trackId: transition.trackId,
    gameMode: transition.gameMode,
    playerCarIndex: transition.playerCarIndex,
    gameYear: transition.gameYear,
    packetFormat: transition.packetFormat,
    sessionType: transition.sessionType,
    phase: transition.phase,
    source: transition.source
  }
}

function estimatedRecordBytes(data: string, key: string): number {
  // UTF-16 upper bound for retained strings plus a conservative object/array allowance.
  return data.length * 2 + key.length * 2 + 512
}

/**
 * Field paths are dotted own-property names. Segments are restricted to a plain
 * identifier shape and the prototype keys are rejected outright, so a model can
 * never reach a prototype or a computed key.
 */
function isFieldPath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) return false
  const segments = value.split('.')
  return segments.length <= MAX_FIELD_DEPTH && segments.every(segment =>
    FIELD_SEGMENT_PATTERN.test(segment) && !BLOCKED_FIELD_SEGMENTS.has(segment))
}

function readFieldPath(root: unknown, path: string): { found: boolean; value?: unknown } {
  let cursor: unknown = root
  for (const segment of path.split('.')) {
    if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) return { found: false }
    const record = cursor as Record<string, unknown>
    if (!Object.prototype.hasOwnProperty.call(record, segment)) return { found: false }
    cursor = record[segment]
  }
  return { found: true, value: cursor }
}

function packetQueryFits(encoded: string): boolean {
  return toolResultFits(encoded)
}

function packetTooLarge(ts: number, packet: string, field?: string): string {
  return JSON.stringify({
    ts,
    packet,
    ...(field ? { field } : {}),
    truncated: true,
    hint: 'Decoded sample exceeds the tool result budget. Pass field, and arrayOffset/arrayLimit for array fields, to read a bounded slice.'
  })
}

function safePage(value: number, fallback: number): number {
  return Number.isInteger(value) && value >= 0 && value <= 1_000_000 ? value : fallback
}

function safeInteger(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max
    ? value : null
}

function finiteOrNull(value: number | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function safeUid(value: unknown): string | null {
  if (typeof value === 'bigint') return value >= 0n ? value.toString() : null
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? String(value) : null
  if (typeof value === 'string' && value.length > 0 && value.length <= 64 && /^[A-Za-z0-9_-]+$/.test(value)) return value
  return null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null
}
