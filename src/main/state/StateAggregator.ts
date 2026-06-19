import type { RaceState, RecentEvent, PacketFormat, TrackPosition, RivalState } from '@shared/index'
import { getTrack } from '@shared/index'
import { emptyRaceState } from './defaults'
import { mapCompound, decodeSafetyCar, sessionTypeLabel } from './mappings'
import type { AnyParsedPacket } from '../telemetry/UdpReceiver'
import type { PacketHeader } from '../telemetry/HeaderTypes'
import { nanoid } from 'nanoid'
import { logger } from '../logging/Logger'

const MAX_EVENTS = 12
const WHEEL = ['rl', 'rr', 'fl', 'fr'] as const

/**
 * StateAggregator — single source of truth; holds canonical full-resolution RaceState.
 * Latest-wins, idempotent: safe against UDP reorder/dup.
 * Event detection (rising edges) lives here so reducers stay pure-ish.
 */
export class StateAggregator {
  public state: RaceState = emptyRaceState()
  private lastSessionUID = ''
  private prevSC = 0
  private lastEventBucket = new Set<string>()

  getState(): RaceState {
    return this.state
  }

  /** Reset racing state when session changes (keeps nothing — memory is handled elsewhere). */
  reset(format: PacketFormat): void {
    const prevErrors = this.state.recentEvents
    this.state = emptyRaceState(format)
    this.state.recentEvents = prevErrors
    this.lastSessionUID = ''
    this.lastEventBucket.clear()
  }

  // ───────────────────────── reducers ─────────────────────────

  onSession(p: AnyParsedPacket): void {
    const h = p.m_header as PacketHeader
    const s = this.state.session
    const uid = h.m_sessionUID.toString()
    const sessionChanged = this.lastSessionUID && this.lastSessionUID !== uid
    s.sessionType = p.m_sessionType
    s.sessionTypeLabel = sessionTypeLabel(p.m_sessionType)
    s.trackId = p.m_trackId
    s.trackName = getTrack(p.m_trackId)?.name ?? (p.m_trackId >= 0 ? `Track ${p.m_trackId}` : '')
    s.totalLaps = p.m_totalLaps || null
    s.sessionTimeLeftS = p.m_sessionTimeLeft ?? s.sessionTimeLeftS
    s.sessionDurationS = p.m_sessionDuration ?? s.sessionDurationS
    s.pitSpeedLimitKmh = p.m_pitSpeedLimit ?? s.pitSpeedLimitKmh
    s.trackLengthM = p.m_trackLength ?? s.trackLengthM
    s.gameYear = h.m_gameYear
    s.packetFormat = (h.m_packetFormat === 2026 ? 2026 : 2025) as PacketFormat
    s.sessionUID = uid
    s.overallFrameIdentifier = h.m_overallFrameIdentifier
    s.lastUpdateMs = Date.now()
    this.state.packetFormat = s.packetFormat

    // safety car
    const scStatus = p.m_safetyCarStatus ?? 0
    const decoded = decodeSafetyCar(scStatus)
    s.isSafetyCar = decoded.sc
    s.isVirtualSafetyCar = decoded.vsc
    s.safetyCarPhase = scStatus
    if (scStatus !== this.prevSC) {
      if (decoded.sc && !this.isDupe('sc', uid)) this.pushEvent('safetyCar', 'Safety Car deployed')
      else if (decoded.vsc && !this.isDupe('vsc', uid)) this.pushEvent('vsc', 'Virtual Safety Car')
      this.prevSC = scStatus
    }

    // weather
    const w = this.state.weather
    w.airTempC = p.m_airTemperature ?? w.airTempC
    w.trackTempC = p.m_trackTemperature ?? w.trackTempC
    w.weatherCode = p.m_weather ?? w.weatherCode
    const rainPct = p.m_weatherForecastSamples?.[0]?.m_rainPercentage ?? w.rainPercentage
    const wasRaining = w.rainPercentage > 30
    w.rainPercentage = rainPct ?? w.rainPercentage
    const nowRaining = w.rainPercentage > 30
    w.isRaining = nowRaining
    w.rainOnset = !wasRaining && nowRaining
    if (!wasRaining && nowRaining && rainPct > 0 && !this.isDupe('rain', uid)) {
      this.pushEvent('weatherChange', 'Rain detected')
    }

    if (sessionChanged) {
      this.lastSessionUID = uid
      logger.info(`Session changed -> ${s.sessionTypeLabel} @ track ${s.trackId}`)
    }
    this.lastSessionUID = uid
  }
  onParticipants(p: AnyParsedPacket): void {
    const h = p.m_header as PacketHeader
    const list = (p.m_participants ?? []) as Array<Record<string, number | string>>
    for (let i = 0; i < list.length; i++) {
      const part = list[i]
      const r = this.ensureRival(i)
      r.name = String(part.m_name ?? '')
      r.team = String(part.m_teamId ?? '')
      r.raceNumber = Number(part.m_raceNumber ?? 0)
    }
    this.state.player.carIndex = h.m_playerCarIndex
  }

  onLapData(p: AnyParsedPacket): void {
    const h = p.m_header as PacketHeader
    const arr = (p.m_lapData ?? []) as AnyParsedPacket[]
    const playerIdx = h.m_playerCarIndex
    const positions: TrackPosition[] = []

    for (let i = 0; i < arr.length; i++) {
      const d = arr[i]
      const r = this.ensureRival(i)
      r.carIndex = i
      // position 0 = invalid in F1 spec
      r.position = d.m_carPosition > 0 ? d.m_carPosition : r.position
      r.lap = numOr(d.m_currentLapNum, r.lap)
      // lapDistancePct: use track length (metres) not total distance (cumulative).
      // F1 25's m_lapDistance is distance into current lap; m_totalDistance is cumulative.
      const trackLen = this.state.session.trackLengthM || d.m_totalDistance || 1
      r.lapDistancePct = clamp01((d.m_lapDistance ?? 0) / Math.max(1, trackLen))
      // F1 25 (format 2024/2025) emits gap as TWO fields: m_deltaToCarInFrontMSPart + m_deltaToCarInFrontMinutesPart.
      // The combined m_deltaToCarInFrontInMS only exists in the 2023 branch. Combine both defensively.
      r.deltaToCarInFrontS = readGapS(d)
      r.deltaToCarBehindS = null
      r.pitStopCount = numOr(d.m_numPitStops, r.pitStopCount)
      r.pitStatus = numOr(d.m_pitStatus, r.pitStatus)
      // m_penalties is already in SECONDS (not ms) in the F1 spec — don't divide by 1000.
      r.penaltiesS = numOr(d.m_penalties, r.penaltiesS)
      r.lastLapTimeS = msToS(d.m_lastLapTimeInMs)
      r.currentLapTimeS = msToS(d.m_currentLapTimeInMs)
      r.gridPosition = numOr(d.m_gridPosition, r.gridPosition)
      r.resultStatus = numOr(d.m_resultStatus, r.resultStatus)
      r.status = rivalStatus(d.m_driverStatus, d.m_resultStatus)
      positions.push({
        carIndex: i,
        lapDistancePct: r.lapDistancePct,
        speedKmh: i === playerIdx ? this.state.player.speedKmh : 0,
        isPlayer: i === playerIdx
      })
    }

    // Cumulative gap-to-player: walk the sorted-by-position list, accumulating deltas
    // from the player's position. This gives the REAL total gap (not just the adjacent
    // pair delta), fixing the bug where non-adjacent rivals showed wrong gaps.
    // Also derive deltaToCarBehindS for each car along the way.
    const sorted = Object.values(this.state.rivals).slice().sort((a, b) => a.position - b.position)
    for (let i = 0; i < sorted.length - 1; i++) {
      sorted[i].deltaToCarBehindS = sorted[i + 1].deltaToCarInFrontS
    }

    this.state.trackPositions = positions

    // player mirror
    const pld = arr[playerIdx]
    if (pld) {
      const pl = this.state.player
      pl.position = pld.m_carPosition > 0 ? pld.m_carPosition : pl.position
      pl.lap = numOr(pld.m_currentLapNum, pl.lap)
      this.state.session.currentLap = numOr(pld.m_currentLapNum, this.state.session.currentLap)
      const pldTrackLen = this.state.session.trackLengthM || pld.m_totalDistance || 1
      pl.lapDistancePct = clamp01((pld.m_lapDistance ?? 0) / Math.max(1, pldTrackLen))
      pl.currentLapTimeS = msToS(pld.m_currentLapTimeInMs)
      pl.lastLapTimeS = msToS(pld.m_lastLapTimeInMs)
      pl.pitStatus = numOr(pld.m_pitStatus, pl.pitStatus)
      pl.pitTimerS = msToS(pld.m_pitStopTimerInMS)
      pl.pitStopCount = numOr(pld.m_numPitStops, pl.pitStopCount)
      pl.penaltiesS = numOr(pld.m_penalties, pl.penaltiesS)
      // driverStatus 1-4 are all "on track" (flying lap, in lap, out lap, on track)
      pl.onTrack = (pld.m_driverStatus ?? 1) >= 1 && (pld.m_driverStatus ?? 1) <= 4
    }

    // gap-to-player via cumulative walk from the player's position in the sorted order.
    // The player is NOT in rivals[] — so we find where they would sit and walk from there.
    const playerPos = this.state.player.position
    // find the insertion index: first car with position > playerPos means player sits before them
    let playerIdxInSorted = sorted.findIndex((r) => r.position > playerPos)
    if (playerIdxInSorted === -1) playerIdxInSorted = sorted.length // player is last
    if (sorted.length > 0) {
      // walk UP (cars ahead): accumulate their deltaToCarInFrontS
      let cumAhead = 0
      for (let i = playerIdxInSorted - 1; i >= 0; i--) {
        const gap = sorted[i + 1].deltaToCarInFrontS
        if (gap != null) cumAhead += gap
        sorted[i].gapToPlayerS = cumAhead > 0 ? cumAhead : null
      }
      // walk DOWN (cars behind): accumulate their deltaToCarInFrontS (negative)
      let cumBehind = 0
      for (let i = playerIdxInSorted; i < sorted.length; i++) {
        const gap = sorted[i].deltaToCarInFrontS
        if (gap != null) cumBehind += gap
        sorted[i].gapToPlayerS = cumBehind > 0 ? -cumBehind : null
      }
    }
    for (const r of sorted) {
      r.relationToPlayer =
        r.position < playerPos ? 'ahead' : r.position > playerPos ? 'behind' : 'same'
    }
  }

  onCarTelemetry(p: AnyParsedPacket): void {
    const h = p.m_header as PacketHeader
    const idx = h.m_playerCarIndex
    const arr = (p.m_carTelemetryData ?? []) as AnyParsedPacket[]
    const t = arr[idx]
    if (!t) return
    const pl = this.state.player
    pl.speedKmh = t.m_speed ?? pl.speedKmh
    pl.gear = t.m_gear ?? pl.gear
    pl.rpm = t.m_engineRPM ?? pl.rpm
    pl.throttle = t.m_throttle ?? pl.throttle
    pl.brake = t.m_brake ?? pl.brake
    pl.revLightsPercent = t.m_revLightsPercent ?? pl.revLightsPercent
    pl.drsActive = (t.m_drs ?? 0) === 1

    const surf = (t.m_tyresSurfaceTemperature ?? []) as number[]
    const inner = (t.m_tyresInnerTemperature ?? []) as number[]
    const brakes = (t.m_brakesTemperature ?? []) as number[]
    WHEEL.forEach((w, i) => {
      pl.tyres.surfaceTempC[w] = surf[i] ?? 0
      pl.tyres.innerTempC[w] = inner[i] ?? 0
      pl.tyres.brakeTempC[w] = brakes[i] ?? 0
    })

    // update track position speeds
    for (const tp of this.state.trackPositions) {
      const td = arr[tp.carIndex]
      if (td) tp.speedKmh = td.m_speed ?? tp.speedKmh
    }
  }

  onCarStatus(p: AnyParsedPacket): void {
    const h = p.m_header as PacketHeader
    const arr = (p.m_carStatusData ?? []) as AnyParsedPacket[]
    // update ALL cars' tyre compound (rivals + player)
    for (let i = 0; i < arr.length; i++) {
      const st = arr[i]
      if (!st) continue
      if (i === h.m_playerCarIndex) {
        const pl = this.state.player
        pl.fuelRemainingKg = st.m_fuelInTank ?? pl.fuelRemainingKg
        pl.fuelMix = (st.m_fuelMix ?? 1) as 0 | 1 | 2 | 3
        pl.drsAllowed = (st.m_drsAllowed ?? 0) !== 0
        pl.tyres.rawCompoundId = typeof st.m_actualTyreCompound === 'number' ? st.m_actualTyreCompound : -1
        pl.tyres.compound = mapCompound(pl.tyres.rawCompoundId, this.state.session.trackId)
        pl.tyres.ageLaps = st.m_tyresAgeLaps ?? pl.tyres.ageLaps
        // ERS store energy is in joules, capacity ~4e6 J
        pl.ersPercent = clamp01((st.m_ersStoreEnergy ?? 0) / 4_000_000)
      } else {
        // update rival's tyre compound
        const r = this.ensureRival(i)
        r.tyreCompound = mapCompound(st.m_actualTyreCompound ?? -1, this.state.session.trackId)
      }
    }
  }

  onCarDamage(p: AnyParsedPacket): void {
    const h = p.m_header as PacketHeader
    const idx = h.m_playerCarIndex
    const arr = (p.m_carDamageData ?? []) as AnyParsedPacket[]
    const d = arr[idx]
    if (!d) return
    const pl = this.state.player
    const wear = (d.m_tyresWear ?? []) as number[]
    const blist = (d.m_tyreBlisters ?? []) as number[]
    WHEEL.forEach((w, i) => {
      pl.tyres.wear[w] = clampPct(wear[i] ?? 0)
      pl.tyres.blisters[w] = clampPct(blist[i] ?? 0)
    })
    // power-unit wear fields are uint8 0..100 in the F1 spec (0=new, 100=worn).
    // Per request, only show: engine(ICE), turbo(TC), MGU-H, ES, CE, gearbox, exhaust.
    pl.powerUnit.engine = 1 - clamp01(normPctTo01(d.m_engineICEWear))
    pl.powerUnit.turbo = 1 - clamp01(normPctTo01(d.m_engineTCWear))
    pl.powerUnit.mguh = 1 - clamp01(normPctTo01(d.m_engineMGUHWear))
    pl.powerUnit.es = 1 - clamp01(normPctTo01(d.m_engineESWear))
    pl.powerUnit.ce = 1 - clamp01(normPctTo01(d.m_engineCEWear))
    pl.powerUnit.gearbox = 1 - clamp01(normPctTo01(d.m_gearBoxDamage))
    pl.powerUnit.exhaust = pl.powerUnit.engine
    // wing damage is uint8 0..100 — divide by 100, NOT clamp01 (which would max any value > 1).
    pl.damage.frontLeftWing = clamp01(normPctTo01(d.m_frontLeftWingDamage))
    pl.damage.frontRightWing = clamp01(normPctTo01(d.m_frontRightWingDamage))
    pl.damage.rearWing = clamp01(normPctTo01(d.m_rearWingDamage))
    pl.damage.floor = clamp01(normPctTo01(d.m_floorDamage))
    pl.damage.sidepodL = clamp01(normPctTo01(d.m_sidepodDamage))
    pl.damage.sidepodR = pl.damage.sidepodL
  }

  onCarSetup(p: AnyParsedPacket): void {
    const h = p.m_header as PacketHeader
    const idx = h.m_playerCarIndex
    const arr = (p.m_carSetups ?? []) as AnyParsedPacket[]
    const s = arr[idx]
    if (!s) return
    this.state.player.setup = {
      frontWing: s.m_frontWing ?? 0,
      rearWing: s.m_rearWing ?? 0,
      onThrottleDiff: s.m_onThrottle ?? 0,
      offThrottleDiff: s.m_offThrottle ?? 0,
      camberFL: s.m_frontCamber ?? 0,
      camberFR: s.m_frontCamber ?? 0,
      camberRL: s.m_rearCamber ?? 0,
      camberRR: s.m_rearCamber ?? 0,
      antiRollFront: s.m_frontAntiRollBar ?? 0,
      antiRollRear: s.m_rearAntiRollBar ?? 0,
      brakePressure: s.m_brakePressure ?? 0,
      brakeBias: s.m_brakeBias ?? 0,
      frontTyrePressure: s.m_frontLeftTyrePressure ?? 0,
      rearTyrePressure: s.m_rearLeftTyrePressure ?? 0,
      ballast: s.m_ballast ?? 0,
      fuelLoad: s.m_fuelLoad ?? 0
    }
  }

  onEvent(p: AnyParsedPacket): void {
    const h = p.m_header as PacketHeader
    const code = String(p.m_eventStringCode ?? '')
    const d = (p.m_eventDetails ?? {}) as Record<string, number>
    const uid = h.m_sessionUID.toString()
    const vIdx = d.vehicleIdx ?? -1
    switch (code) {
      case 'FTLP':
        if (!this.isDupe(`ftlp-${vIdx}`, uid)) this.pushEvent('fastestLap', `Fastest lap by car ${vIdx}`, vIdx)
        break
      case 'RTMT':
        // RTMT = Retirement (car carries vehicleIdx). SEND = SessionEnded, NOT retirement.
        if (!this.isDupe(`retire-${vIdx}`, uid)) this.pushEvent('retirement', `Car ${vIdx} retired`, vIdx)
        break
      case 'BUTN':
        // button press — informational, no event needed
        break
      case 'SEND':
        // SessionEnded — NOT retirement
        if (!this.isDupe('sessionEnded', uid)) this.pushEvent('sessionEnded', 'Session ended', vIdx)
        break
      case 'PENA':
        if (vIdx === this.state.player.carIndex && !this.isDupe(`pen-${vIdx}`, uid))
          this.pushEvent('penalty', `Penalty for car ${vIdx}`, vIdx)
        break
      case 'RCWN':
        if (!this.isDupe(`win-${vIdx}`, uid)) this.pushEvent('raceWinner', `Car ${vIdx} wins`, vIdx)
        break
      default:
        break
    }
  }

  onSessionHistory(p: AnyParsedPacket): void {
    const h = p.m_header as PacketHeader
    void h
    const carIdx = p.m_carIdx as number
    const r = this.ensureRival(carIdx)
    const laps = (p.m_lapHistoryData ?? []) as AnyParsedPacket[]
    if (laps.length > 0) {
      // treat non-positive lap times as empty slots (the parser zero-fills unused history entries)
      const best = laps.reduce(
        (min, l) => Math.min(min, l.m_lapTimeInMS > 0 ? l.m_lapTimeInMS : Infinity),
        Infinity
      )
      r.bestLapTimeS = best === Infinity ? null : best / 1000
    }
    if (carIdx === this.state.player.carIndex && r.bestLapTimeS != null) {
      this.state.player.bestLapTimeS = r.bestLapTimeS
    }
  }

  // ───────────────────────── helpers ─────────────────────────

  private ensureRival(carIndex: number): RivalState {
    if (!this.state.rivals[carIndex]) {
      this.state.rivals[carIndex] = {
        carIndex,
        name: '',
        team: '',
        raceNumber: 0,
        carClass: 0,
        position: carIndex + 1,
        gridPosition: 0,
        lap: 0,
        lapDistancePct: 0,
        bestLapTimeS: null,
        lastLapTimeS: null,
        currentLapTimeS: null,
        deltaToCarInFrontS: null,
        deltaToCarBehindS: null,
        gapToPlayerS: null,
        pitStopCount: 0,
        pitStatus: 0,
        penaltiesS: 0,
        tyreCompound: 'unknown',
        resultStatus: 0,
        status: 'running',
        relationToPlayer: 'same'
      }
    }
    return this.state.rivals[carIndex]
  }

  private pushEvent(type: RecentEvent['type'], text: string, carIndex?: number): void {
    const ev: RecentEvent = { id: nanoid(8), ts: Date.now(), type, text, carIndex }
    this.state.recentEvents = [...this.state.recentEvents, ev].slice(-MAX_EVENTS)
  }

  private isDupe(key: string, uid: string): boolean {
    const bucket = `${uid}:${key}`
    if (this.lastEventBucket.has(bucket)) return true
    this.lastEventBucket.add(bucket)
    if (this.lastEventBucket.size > 200) {
      // prune oldest half
      const arr = Array.from(this.lastEventBucket)
      this.lastEventBucket = new Set(arr.slice(arr.length / 2))
    }
    return false
  }
}

function clamp01(x: number): number {
  if (!isFinite(x)) return 0
  return Math.max(0, Math.min(1, x))
}
/** Prefer the packet value when it's a real number; otherwise keep the previous value. */
function numOr(v: number | undefined | null, fallback: number): number {
  if (v == null || !isFinite(v)) return fallback
  return v
}
function clampPct(x: number): number {
  if (!isFinite(x)) return 0
  return Math.max(0, Math.min(100, x))
}
function clamp01Pct(x: number): number {
  return clamp01(x / 100)
}
void clamp01Pct
function msToS(ms: number | undefined | null): number | null {
  if (ms == null || ms === 0 || ms === -1 || !isFinite(ms)) return null
  return ms / 1000
}

/**
 * Read the gap to the car in front as seconds.
 * F1 25 (format 2024/2025) splits it into m_deltaToCarInFrontMSPart (uint16) +
 * m_deltaToCarInFrontMinutesPart (uint8). The combined m_deltaToCarInFrontInMS
 * only exists in the 2023 branch. Read whichever is present (defensive across formats).
 */
function readGapS(d: AnyParsedPacket): number | null {
  // combined (2023) form
  if (typeof d.m_deltaToCarInFrontInMS === 'number' && d.m_deltaToCarInFrontInMS > 0) {
    return d.m_deltaToCarInFrontInMS / 1000
  }
  // split (2024/2025) form
  const minPart = typeof d.m_deltaToCarInFrontMinutesPart === 'number' ? d.m_deltaToCarInFrontMinutesPart : 0
  const msPart = typeof d.m_deltaToCarInFrontMSPart === 'number' ? d.m_deltaToCarInFrontMSPart : 0
  const totalMs = minPart * 60000 + msPart
  return totalMs > 0 ? totalMs / 1000 : null
}
/** Convert a 0..100 percentage field (uint8 damage/wear) to 0..1, guarding NaN/undef. */
function normPctTo01(v: number | undefined | null): number {
  if (v == null || !isFinite(v)) return 0
  return Math.max(0, Math.min(1, v / 100))
}
function rivalStatus(driverStatus: number, resultStatus: number): RivalState['status'] {
  if (resultStatus === 3) return 'finished'
  if (resultStatus === 4 || driverStatus === 4) return 'retired'
  if (driverStatus === 0 || driverStatus === 7) return 'inGarage'
  return 'running'
}
