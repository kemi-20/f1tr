import type { RaceState, RecentEvent, PacketFormat, TrackPosition, RivalState } from '@shared/index'
import { getTrack } from '@shared/index'
import { constants } from '@z0mt3c/f1-telemetry-client'
import { emptyRaceState } from './defaults'
import { resolveCompound, decodeSafetyCar, sessionTypeLabel } from './mappings'
import type { AnyParsedPacket } from '../telemetry/UdpReceiver'
import type { PacketHeader } from '../telemetry/HeaderTypes'
import { nanoid } from 'nanoid'
import { logger } from '../logging/Logger'
import { LapPhaseTracker } from './LapPhaseTracker'

const MAX_EVENTS = 12
/** Same-frame event repeats are UDP duplicates; anything older than this is a new event. */
const EVENT_DEDUPE_TTL_MS = 120_000
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
  private prevTrackFlag = 'none'
  private scActive = false
  private _prevRedFlagCount = 0
  private recentEventKeys = new Map<string, number>() // dedupe key -> seenAt ms
  private oncePerSessionKeys = new Set<string>()
  private lapPhases = new LapPhaseTracker()

  getState(): RaceState {
    return this.state
  }

  setFlashbackActive(active: boolean): void {
    if (active && !this.state.flashbackActive) this.lapPhases.reset()
    this.state.flashbackActive = active
  }

  setHealthStats(stats: { lastPacketMs: number; packetsReceived: number; packetsDropped: number }): void {
    this.state.lastPacketMs = stats.lastPacketMs
    this.state.packetsReceived = stats.packetsReceived
    this.state.packetsDropped = stats.packetsDropped
  }

  /** Reset racing state when session changes (keeps nothing — memory is handled elsewhere). */
  reset(format: PacketFormat): void {
    this.state = emptyRaceState(format)
    this.lastSessionUID = ''
    this.recentEventKeys.clear()
    this.oncePerSessionKeys.clear()
    this.lapPhases.reset()
    this.prevSC = 0
    this.prevTrackFlag = 'none'
    this.scActive = false
    this._prevRedFlagCount = 0
  }

  // ───────────────────────── reducers ─────────────────────────

  onSession(p: AnyParsedPacket): void {
    const h = p.m_header as PacketHeader
    const s = this.state.session
    const uid = h.m_sessionUID.toString()
    const sessionChanged = this.lastSessionUID && this.lastSessionUID !== uid
    s.sessionType = p.m_sessionType
    s.sessionTypeLabel = sessionTypeLabel(p.m_sessionType)
    s.sessionLengthCode = Number.isInteger(p.m_sessionLength) && p.m_sessionLength >= 0 && p.m_sessionLength <= 7
      ? p.m_sessionLength : null
    const count = p.m_numSessionsInWeekend
    const structure = Array.isArray(p.m_weekendStructure) && Number.isSafeInteger(count) &&
      count >= 1 && count <= 12 && count <= p.m_weekendStructure.length
      ? p.m_weekendStructure.slice(0, count) : null
    s.isSprintRace = s.sessionType === 15 && structure && structure.every(
      (type: unknown) => Number.isSafeInteger(type) && Number(type) >= 0 && Number(type) <= 18)
      ? structure.includes(16) : s.sessionType >= 16 && s.sessionType <= 17 ? false : null
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
    // red flag: m_numRedFlagPeriods is cumulative; detect rising edge to latch.
    // Clear when racing resumes (m_safetyCarStatus 0 or 5, and no SC/VSC active).
    const redCount = p.m_numRedFlagPeriods ?? 0
    if (redCount > (this._prevRedFlagCount ?? 0)) {
      s.isRedFlag = true
      this._prevRedFlagCount = redCount
      if (!this.oncePerSession(`redFlag-${redCount}`, uid))
        this.pushEvent('redFlag', `Red flag #${redCount}`, undefined)
    } else if (decoded.resumed || (scStatus === 0 && !decoded.sc && !decoded.vsc)) {
      // racing has resumed — clear red flag
      s.isRedFlag = false
      this._prevRedFlagCount = redCount
    } else {
      this._prevRedFlagCount = Math.max(this._prevRedFlagCount ?? 0, redCount)
    }
    s.safetyCarPhase = scStatus
    const flag = readTrackFlag(p.m_marshalZones)
    s.trackFlag = flag.flag
    s.activeFlagZones = flag.activeZones
    if (s.trackFlag !== this.prevTrackFlag) {
      if (s.trackFlag === 'yellow') this.pushEvent('yellowFlag', flag.activeZones > 1 ? 'Yellow flags' : 'Yellow flag')
      if (s.trackFlag === 'blue') this.pushEvent('blueFlag', 'Blue flag')
      if (s.trackFlag === 'red' && !s.isRedFlag) this.pushEvent('redFlag', 'Red flag')
      if (s.trackFlag === 'green' && this.prevTrackFlag !== 'none') this.pushEvent('greenFlag', 'Green flag')
      this.prevTrackFlag = s.trackFlag
    }
    if (decoded.sc || decoded.vsc) {
      this.scActive = true
    }
    if (scStatus !== this.prevSC) {
      const frame = h.m_overallFrameIdentifier
      if (decoded.sc && !this.isDuplicate('sc', uid, frame)) this.pushEvent('safetyCar', 'Safety Car deployed')
      else if (decoded.vsc && !this.isDuplicate('vsc', uid, frame)) this.pushEvent('vsc', 'Virtual Safety Car')
      else if (decoded.formation && !this.isDuplicate('formation', uid, frame)) this.pushEvent('safetyCar', 'Formation lap')
      // SC/VSC may pass through status 4 (VSC ending), so keep a latched active
      // flag instead of relying only on the immediately previous enum value.
      if (this.scActive && (scStatus === 0 || decoded.resumed)) {
        if (!this.isDuplicate('sc-ended', uid, frame)) this.pushEvent('safetyCar', 'SC/VSC ended — green flag')
        this.scActive = false
      }
      this.prevSC = scStatus
    }

    // weather
    const w = this.state.weather
    w.airTempC = p.m_airTemperature ?? w.airTempC
    w.trackTempC = p.m_trackTemperature ?? w.trackTempC
    w.weatherCode = p.m_weather ?? w.weatherCode
    // m_trackWetness may not exist in all parser versions; derive from weather code as fallback
    const rawWetness = typeof p.m_trackWetness === 'number' ? p.m_trackWetness : null
    if (rawWetness != null) {
      w.wetness = clamp01(rawWetness / 100)
    } else if (isRainWeatherCode(w.weatherCode)) {
      w.wetness = Math.max(w.wetness, w.weatherCode >= 4 ? 0.7 : 0.3)
    }
    const forecast = p.m_weatherForecastSamples?.[0]
    const forecastRainPct = forecast?.m_rainPercentage
    const wasRaining = w.isRaining
    const currentRainCode = isRainWeatherCode(w.weatherCode)
    const wetTrack = w.wetness >= 0.08
    w.rainPercentage = currentRainCode
      ? Math.max(60, forecastRainPct ?? w.rainPercentage)
      : (forecastRainPct ?? w.rainPercentage)
    w.predictedCode = forecast?.m_weather ?? w.predictedCode
    w.predictedWetness = clamp01((forecast?.m_rainPercentage ?? w.predictedWetness * 100) / 100)
    w.rainOnset = false
    const nowRaining = currentRainCode || wetTrack
    w.isRaining = nowRaining
    w.rainOnset = !wasRaining && nowRaining
    if (!wasRaining && nowRaining && !this.isDuplicate('rain', uid, h.m_overallFrameIdentifier)) {
      this.pushEvent('weatherChange', currentRainCode ? 'Rain detected' : 'Wet track detected')
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
      const rawDriverId = part.m_driverId
      const driverId = rawDriverId == null || rawDriverId === '' ? null : Number(rawDriverId)
      const rawTeamId = part.m_teamId
      const teamId = rawTeamId == null || rawTeamId === '' ? null : Number(rawTeamId)
      const driver = driverId == null || !Number.isFinite(driverId) ? undefined : constants.DRIVERS[driverId]
      const team = teamId == null || !Number.isFinite(teamId) ? undefined : constants.TEAMS[teamId]
      const participantName = String(part.m_name ?? '').trim()
      const fallbackName = driver ? [driver.firstName, driver.lastName].filter(Boolean).join(' ') : ''
      r.driverId = driverId ?? 0
      r.driverCode = driver?.abbreviation ?? ''
      r.name = participantName || fallbackName || r.name
      r.team = teamId == null ? '' : String(teamId)
      r.teamName = team?.name ?? ''
      r.teamColor = team?.color ?? ''
      r.raceNumber = Number(part.m_raceNumber ?? 0)
    }
    this.state.player.carIndex = h.m_playerCarIndex
  }

  onLapData(p: AnyParsedPacket): void {
    const h = p.m_header as PacketHeader
    const arr = (p.m_lapData ?? []) as AnyParsedPacket[]
    const playerIdx = h.m_playerCarIndex
    this.state.player.carIndex = playerIdx
    // Carry forward the per-car speeds Motion recorded: rebuilding this list must not
    // discard them, or the physical plausibility check below loses its input.
    const speeds = new Map(this.state.trackPositions.map(tp => [tp.carIndex, tp.speedKmh]))
    const positions: TrackPosition[] = []

    for (let i = 0; i < arr.length; i++) {
      const d = arr[i]
      const r = this.ensureRival(i)
      r.carIndex = i
      // position 0 = invalid in F1 spec
      r.position = d.m_carPosition > 0 ? d.m_carPosition : r.position
      r.lap = numOr(d.m_currentLapNum, r.lap)
      // lapDistancePct: use track length from session packet. If not yet available,
      // keep the previous value (don't fall back to m_totalDistance — it's cumulative).
      const trackLen = this.state.session.trackLengthM
      if (trackLen > 0) {
        r.lapDistancePct = clamp01((d.m_lapDistance ?? 0) / Math.max(1, trackLen))
      }
      r.distanceFromStartM = finiteOrNull(d.m_lapDistance)
      r.totalDistanceM = finiteOrNull(d.m_totalDistance)
      // Parser field names differ from the wire spec; combine the milliseconds and minutes.
      r.deltaToCarInFrontS = readGapS(d)
      r.deltaToCarBehindS = null
      r.pitStopCount = numOr(d.m_numPitStops, r.pitStopCount)
      r.pitStatus = numOr(d.m_pitStatus, r.pitStatus)
      // m_penalties is already in SECONDS (not ms) in the F1 spec — don't divide by 1000.
      r.penaltiesS = numOr(d.m_penalties, r.penaltiesS)
      r.lastLapTimeS = msToS(d.m_lastLapTimeInMS)
      r.currentLapTimeS = msToS(d.m_currentLapTimeInMS)
      r.gridPosition = numOr(d.m_gridPosition, r.gridPosition)
      r.resultStatus = numOr(d.m_resultStatus, r.resultStatus)
      r.status = rivalStatus(d.m_driverStatus, d.m_resultStatus)
      r.driverStatus = Number.isInteger(d.m_driverStatus) && d.m_driverStatus >= 0 && d.m_driverStatus <= 4
        ? d.m_driverStatus : undefined
      r.currentLapInvalid = d.m_currentLapInvalid === 1
      r.lapDataUpdatedAt = Date.now()
      const phase = this.lapPhases.observe({
        car: i, lap: r.lap, distance: r.lapDistancePct, time: r.currentLapTimeS ?? 0,
        context: `${this.state.weather.weatherCode}:${r.tyreCompound}`,
        status: r.driverStatus, pit: r.pitStatus, invalid: r.currentLapInvalid,
        lastLap: r.lastLapTimeS, neutralised: this.state.session.isSafetyCar ||
          this.state.session.isVirtualSafetyCar || this.state.session.isRedFlag || this.state.session.trackFlag === 'yellow'
      })
      r.lapPhase = phase.phase
      r.lapPhaseEvidence = phase.evidence
      positions.push({
        carIndex: i,
        lapDistancePct: r.lapDistancePct,
        speedKmh: i === playerIdx ? this.state.player.speedKmh : speeds.get(i) ?? 0,
        isPlayer: i === playerIdx,
        ...this.trackWorldPosition(i)
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
      pl.currentSector = typeof pld.m_sector === 'number' ? pld.m_sector : pl.currentSector
      pl.lap = numOr(pld.m_currentLapNum, pl.lap)
      this.state.session.currentLap = numOr(pld.m_currentLapNum, this.state.session.currentLap)
      const pldTrackLen = this.state.session.trackLengthM
      if (pldTrackLen > 0) {
        pl.lapDistancePct = clamp01((pld.m_lapDistance ?? 0) / Math.max(1, pldTrackLen))
      }
      pl.distanceFromStartM = finiteOrNull(pld.m_lapDistance)
      pl.totalDistanceM = finiteOrNull(pld.m_totalDistance)
      pl.currentLapTimeS = msToS(pld.m_currentLapTimeInMS)
      pl.lastLapTimeS = msToS(pld.m_lastLapTimeInMS)
      pl.currentLapInvalid = pld.m_currentLapInvalid === 1
      pl.driverStatus = this.state.rivals[playerIdx].driverStatus
      pl.lapPhase = this.state.rivals[playerIdx].lapPhase
      pl.lapPhaseEvidence = this.state.rivals[playerIdx].lapPhaseEvidence
      pl.lapDataUpdatedAt = this.state.rivals[playerIdx].lapDataUpdatedAt
      pl.pitStatus = numOr(pld.m_pitStatus, pl.pitStatus)
      pl.pitTimerS = msToS(pld.m_pitStopTimerInMS)
      pl.pitStopCount = numOr(pld.m_numPitStops, pl.pitStopCount)
      pl.penaltiesS = numOr(pld.m_penalties, pl.penaltiesS)
      // driverStatus 1-4 are all "on track" (flying lap, in lap, out lap, on track)
      pl.onTrack = (pld.m_driverStatus ?? 1) >= 1 && (pld.m_driverStatus ?? 1) <= 4
    }

    const playerPos = this.state.player.position
    const playerCarIndex = this.state.player.carIndex
    const trackLen = this.state.session.trackLengthM
    const playerTotal = this.state.player.totalDistanceM

    // Race progress and physical traffic are different coordinates. Preserve whole laps
    // in the former; wrap only the latter around the start/finish line.
    for (const r of Object.values(this.state.rivals)) {
      r.separationFromPlayerM = playerTotal != null && r.totalDistanceM != null
        ? r.totalDistanceM - playerTotal : null
      r.trackRelativeSeparationM = validLapDistance(this.state.player.distanceFromStartM, trackLen) &&
        validLapDistance(r.distanceFromStartM, trackLen)
        ? shortestTrackSeparation(r.distanceFromStartM - this.state.player.distanceFromStartM, trackLen)
        : null
    }

    // Match by carIndex only — position fallback causes wrong matches in spectator mode
    // (playerCarIndex=255, position=0 would match the first AI car in the sorted list)
    const playerIdxInSorted = sorted.findIndex((r) => r.carIndex === playerCarIndex)
    if (playerIdxInSorted >= 0) {
      const playerRival = sorted[playerIdxInSorted]
      playerRival.gapToPlayerS = 0
      playerRival.separationFromPlayerM = 0
      playerRival.trackRelativeSeparationM = 0

      const pairIsUsable = (leader: RivalState, trailer: RivalState, gap: number | null): boolean => {
        if (gap == null || leader.lap !== trailer.lap || leader.pitStatus !== 0 || trailer.pitStatus !== 0) return false
        if (leader.totalDistanceM == null || trailer.totalDistanceM == null) return true
        const metres = leader.totalDistanceM - trailer.totalDistanceM
        if (metres < 0) return false
        const leaderSpeed = speeds.get(leader.carIndex) ?? 0
        const trailerSpeed = speeds.get(trailer.carIndex) ?? 0
        return !rejectsGap(gap, metres, Math.max(leaderSpeed, trailerSpeed, 400))
      }

      // Walk UP from the player. The first car ahead uses the player's own
      // delta-to-front; cars further ahead use the closer car's chained gap.
      let cumAhead = 0
      let validAhead = false
      for (let i = playerIdxInSorted - 1; i >= 0; i--) {
        const gap = i === playerIdxInSorted - 1
          ? playerRival.deltaToCarInFrontS
          : sorted[i].deltaToCarBehindS
        // Reject a delta the physical separation makes impossible (line-crossing glitch).
        const usable = pairIsUsable(sorted[i], sorted[i + 1], gap)
        if (gap != null && usable) {
          cumAhead += gap
          validAhead = true
        } else {
          validAhead = false
        }
        sorted[i].gapToPlayerS = validAhead && cumAhead >= 0 ? cumAhead : null
      }

      // Walk DOWN from the player. Each trailing car's delta-to-front is its gap
      // to the car immediately ahead in the running order.
      let cumBehind = 0
      let validBehind = false
      for (let i = playerIdxInSorted + 1; i < sorted.length; i++) {
        const gap = sorted[i].deltaToCarInFrontS
        const usable = pairIsUsable(sorted[i - 1], sorted[i], gap)
        if (gap != null && usable) {
          cumBehind += gap
          validBehind = true
        } else {
          validBehind = false
        }
        sorted[i].gapToPlayerS = validBehind && cumBehind >= 0 ? -cumBehind : null
      }
    }
    for (const r of sorted) {
      r.relationToPlayer =
        r.position > 0 && r.position < playerPos ? 'ahead' : r.position > playerPos ? 'behind' : 'same'
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
    pl.engineTempC = t.m_engineTemperature ?? pl.engineTempC
    pl.throttle = t.m_throttle ?? pl.throttle
    pl.brake = t.m_brake ?? pl.brake
    pl.revLightsPercent = t.m_revLightsPercent ?? pl.revLightsPercent
    pl.drsActive = t.m_drs === 1

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

  onCarTelemetry2(p: AnyParsedPacket): void {
    if (p.m_header.m_packetFormat !== 2026) return
    const t = (p.m_carTelemetry2Data as AnyParsedPacket[] | undefined)?.[p.m_header.m_playerCarIndex]
    if (!t) return
    const pl = this.state.player
    pl.regulations2026 = t.m_2026Regulations === 1
    pl.activeAeroMode = t.m_activeAeroMode === 1 ? 'straight' : 'corner'
    pl.activeAeroAvailable = t.m_activeAeroAvailable === 1
    pl.activeAeroActivationDistanceM = t.m_activeAeroActivationDistance ?? 0
    pl.overtakeAvailable = t.m_overtakeAvailable === 1
    pl.overtakeActive = t.m_overtakeActive === 1
    pl.overtakeActivationDistanceM = t.m_overtakeActivationDistance ?? 0
  }

  onMotion(p: AnyParsedPacket): void {
    const h = p.m_header as PacketHeader
    const arr = (p.m_carMotionData ?? []) as AnyParsedPacket[]
    const byCar = new Map(this.state.trackPositions.map((tp) => [tp.carIndex, tp]))
    for (let i = 0; i < arr.length; i++) {
      const motion = arr[i]
      if (!motion) continue
      const worldX = finiteOrNull(motion.m_worldPositionX)
      const worldY = finiteOrNull(motion.m_worldPositionY)
      const worldZ = finiteOrNull(motion.m_worldPositionZ)
      if (worldX == null || worldZ == null) continue

      const existing = byCar.get(i)
      if (existing) {
        existing.worldX = worldX
        existing.worldY = worldY ?? existing.worldY
        existing.worldZ = worldZ
        existing.isPlayer = i === h.m_playerCarIndex
      } else {
        const r = this.ensureRival(i)
        const tp = {
          carIndex: i,
          lapDistancePct: r.lapDistancePct,
          speedKmh: i === h.m_playerCarIndex ? this.state.player.speedKmh : 0,
          isPlayer: i === h.m_playerCarIndex,
          worldX,
          ...(worldY != null ? { worldY } : {}),
          worldZ
        }
        this.state.trackPositions.push(tp)
        byCar.set(i, tp)
      }
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
        pl.fuelRemainingLaps = typeof st.m_fuelRemainingLaps === 'number' && Number.isFinite(st.m_fuelRemainingLaps)
          ? st.m_fuelRemainingLaps : null
        pl.fuelMix = (st.m_fuelMix ?? 1) as 0 | 1 | 2 | 3
        pl.drsAllowed = (st.m_drsAllowed ?? 0) !== 0
        pl.tyres.rawCompoundId = typeof st.m_actualTyreCompound === 'number' ? st.m_actualTyreCompound : -1
        pl.tyres.compound = resolveCompound(
          pl.tyres.rawCompoundId,
          st.m_visualTyreCompound,
          this.state.session.trackId,
          this.state.packetFormat
        )
        pl.tyres.ageLaps = st.m_tyresAgeLaps ?? pl.tyres.ageLaps
        // ERS store energy is in joules, capacity ~4e6 J
        pl.ersPercent = clamp01((st.m_ersStoreEnergy ?? 0) / 4_000_000)
        // mirror player's tyre into rival entry so RivalsPanel shows it (not '?')
        const pr = this.ensureRival(i)
        pr.tyreCompound = pl.tyres.compound
      } else {
        // update rival's tyre compound
        const r = this.ensureRival(i)
        r.tyreCompound = resolveCompound(
          st.m_actualTyreCompound ?? -1,
          st.m_visualTyreCompound,
          this.state.session.trackId,
          this.state.packetFormat
        )
      }
    }
  }

  onCarDamage(p: AnyParsedPacket): void {
    const h = p.m_header as PacketHeader
    const idx = h.m_playerCarIndex
    const arr = (p.m_carDamageData ?? []) as AnyParsedPacket[]
    for (let i = 0; i < arr.length; i++) {
      const carDamage = arr[i]
      if (!carDamage) continue
      this.ensureRival(i).tyreWearAvg = averagePct((carDamage.m_tyresWear ?? []) as number[])
    }

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
    const d = (p.m_eventDetails ?? {}) as Record<string, number | undefined>
    const uid = h.m_sessionUID.toString()
    const frame = h.m_overallFrameIdentifier
    const vIdx = numOrNull(d.vehicleIdx)
    const playerIdx = this.state.player.carIndex
    const driver = this.driverLabel(vIdx)
    switch (code) {
      case 'FTLP':
        // One call per qualifying packet: improving your own fastest lap must fire again,
        // only a duplicated datagram is filtered (frame id is part of the key).
        if (!this.isDuplicate(`ftlp-${vIdx}`, uid, frame)) {
          this.pushEvent('fastestLap', `Fastest lap by ${driver}`, vIdx ?? undefined)
        }
        break
      case 'RTMT':
        // RTMT = Retirement (car carries vehicleIdx). SEND = SessionEnded, NOT retirement.
        if (!this.oncePerSession(`retire-${vIdx}`, uid)) {
          this.pushEvent('retirement', `${driver} retired`, vIdx ?? undefined)
        }
        break
      case 'OVTK': {
        // The parser exposes overtakingVehicleIdx / beingOvertakenVehicleIdx — there is
        // no `vehicleIdx` on this event, so reading it produced "driver #-1" and a
        // dedupe key that swallowed every overtake after the first.
        const overtaking = numOrNull(d.overtakingVehicleIdx)
        const overtaken = numOrNull(d.beingOvertakenVehicleIdx)
        if (overtaking == null || overtaken == null) break
        if (!this.isDuplicate(`ovtk-${overtaking}-${overtaken}`, uid, frame)) {
          this.pushEvent(
            'overtake',
            `${this.driverLabel(overtaking)} overtook ${this.driverLabel(overtaken)}`,
            overtaking
          )
        }
        break
      }
      case 'COLL': {
        // Collision carries vehicle1Idx / vehicle2Idx (not vehicleIdx).
        const a = numOrNull(d.vehicle1Idx)
        const b = numOrNull(d.vehicle2Idx)
        if (a == null || b == null) break
        if (!this.isDuplicate(`coll-${a}-${b}`, uid, frame)) {
          const involvesPlayer = a === playerIdx || b === playerIdx
          const text = involvesPlayer
            ? `Collision: you and ${this.driverLabel(a === playerIdx ? b : a)}`
            : `Collision between ${this.driverLabel(a)} and ${this.driverLabel(b)}`
          // Tag the event with the player when involved so the engineer reacts to it.
          this.pushEvent('collision', text, involvesPlayer ? playerIdx : a)
        }
        break
      }
      case 'SPIN':
        if (!this.isDuplicate(`spin-${vIdx}`, uid, frame)) {
          this.pushEvent('spin', `${driver} spun`, vIdx ?? undefined)
        }
        break
      case 'DRSE':
        if (vIdx === playerIdx) logger.debug('DRS enabled')
        break
      case 'DRSD':
        if (vIdx === playerIdx) logger.debug('DRS disabled')
        break
      case 'FLBK':
        // flashback — handled by TelemetryService.checkFlashback
        break
      case 'STLG':
        logger.info(`Starting lights: ${d.value ?? '?'}`)
        break
      case 'LGOT':
        logger.info('Lights out — race has started')
        break
      case 'SCAR':
        logger.info('Safety car ending')
        break
      case 'BUTN':
        // button press — informational, no event needed
        break
      case 'SEND':
        // SessionEnded — NOT retirement
        if (!this.oncePerSession('sessionEnded', uid)) {
          this.pushEvent('sessionEnded', 'Session ended', vIdx ?? undefined)
        }
        break
      case 'PENA': {
        // A driver can be penalised more than once — the key has to include what the
        // penalty actually is, not just the car number.
        const penKey = `pen-${vIdx}-${d.penaltyType ?? ''}-${d.infringementType ?? ''}-${d.lapNum ?? ''}`
        if (!this.isDuplicate(penKey, uid, frame)) {
          this.pushEvent('penalty', `Penalty for ${driver}`, vIdx ?? undefined)
        }
        break
      }
      case 'RCWN':
        if (!this.oncePerSession(`win-${vIdx}`, uid)) {
          this.pushEvent('raceWinner', `${driver} wins`, vIdx ?? undefined)
        }
        break
      default:
        break
    }
  }

  onSessionHistory(p: AnyParsedPacket): void {
    const carIdx = p.m_carIdx as number
    if (!Number.isInteger(carIdx) || carIdx < 0 || carIdx >= (this.state.packetFormat === 2026 ? 24 : 22)) return
    const r = this.ensureRival(carIdx)
    const laps = ((p.m_lapHistoryData ?? []) as AnyParsedPacket[]).slice(0,
      Number.isInteger(p.m_numLaps) ? Math.max(0, Math.min(100, p.m_numLaps)) : 0)
    // Bit zero is full-lap validity. Recompute so deleted laps/flashbacks can remove a former best.
    const validTimes = laps.filter(l => Number.isInteger(l.m_lapValidBitFlags) &&
      (l.m_lapValidBitFlags & 1) !== 0 && Number.isFinite(l.m_lapTimeInMS) && l.m_lapTimeInMS > 0)
      .map(l => l.m_lapTimeInMS as number)
    r.bestLapTimeS = validTimes.length ? Math.min(...validTimes) / 1000 : null
    if (carIdx === this.state.player.carIndex) this.state.player.bestLapTimeS = r.bestLapTimeS
  }

  // ───────────────────────── helpers ─────────────────────────

  private ensureRival(carIndex: number): RivalState {
    if (!this.state.rivals[carIndex]) {
      this.state.rivals[carIndex] = {
        carIndex,
        driverId: 0,
        driverCode: '',
        name: '',
        team: '',
        teamName: '',
        teamColor: '',
        raceNumber: 0,
        carClass: 0,
        position: 0,
        gridPosition: 0,
        lap: 0,
        lapDistancePct: 0,
        distanceFromStartM: null,
        totalDistanceM: null,
        separationFromPlayerM: null,
        trackRelativeSeparationM: null,
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
        tyreWearAvg: null,
        resultStatus: 0,
        status: 'running',
        relationToPlayer: 'same'
      }
    }
    return this.state.rivals[carIndex]
  }

  private driverLabel(carIndex: number | null): string {
    if (carIndex == null) return 'an unknown car'
    if (carIndex === this.state.player.carIndex) return this.state.rivals[carIndex]?.name || 'player'
    return this.state.rivals[carIndex]?.name || `driver #${carIndex}`
  }

  private pushEvent(type: RecentEvent['type'], text: string, carIndex?: number): void {
    const ev: RecentEvent = { id: nanoid(8), ts: Date.now(), type, text, carIndex }
    this.state.recentEvents = [...this.state.recentEvents, ev].slice(-MAX_EVENTS)
  }

  /** True if this exact event packet (same session + frame + payload) was already seen. */
  private isDuplicate(key: string, uid: string, frame: number): boolean {
    const bucket = `${uid}:${frame}:${key}`
    const now = Date.now()
    const seenAt = this.recentEventKeys.get(bucket)
    if (seenAt != null && now - seenAt < EVENT_DEDUPE_TTL_MS) return true
    this.recentEventKeys.set(bucket, now)
    if (this.recentEventKeys.size > 512) {
      for (const [k, t] of this.recentEventKeys) {
        if (now - t >= EVENT_DEDUPE_TTL_MS) this.recentEventKeys.delete(k)
      }
    }
    return false
  }

  /** True if this key was already emitted once in the current session (retirements, winner…). */
  private oncePerSession(key: string, uid: string): boolean {
    const bucket = `${uid}:${key}`
    if (this.oncePerSessionKeys.has(bucket)) return true
    this.oncePerSessionKeys.add(bucket)
    return false
  }

  private trackWorldPosition(carIndex: number): Partial<TrackPosition> {
    const existing = this.state.trackPositions.find((tp) => tp.carIndex === carIndex)
    if (!existing) return {}
    return {
      ...(existing.worldX != null ? { worldX: existing.worldX } : {}),
      ...(existing.worldY != null ? { worldY: existing.worldY } : {}),
      ...(existing.worldZ != null ? { worldZ: existing.worldZ } : {})
    }
  }
}

function clamp01(x: number): number {
  if (!isFinite(x)) return 0
  return Math.max(0, Math.min(1, x))
}

function shortestTrackSeparation(deltaM: number, lengthM: number): number {
  const forward = ((deltaM % lengthM) + lengthM) % lengthM
  return forward > lengthM / 2 ? forward - lengthM : forward
}

function validLapDistance(distanceM: number | null, lengthM: number): distanceM is number {
  return distanceM != null && Number.isFinite(distanceM) && Number.isFinite(lengthM) &&
    lengthM > 0 && distanceM >= -lengthM && distanceM <= lengthM * 2
}

/**
 * A chained m_deltaToCarInFrontInMS is only believable when it is physically possible:
 * even at a conservative 400 km/h reference, covering the physical gap cannot take
 * less than this long. A smaller reported delta is a line-crossing glitch.
 */
function rejectsGap(deltaS: number, physicalMetres: number, speedKmh: number): boolean {
  if (!(physicalMetres > 0) || !(speedKmh > 0)) return false
  const floorS = physicalMetres / (speedKmh / 3.6)
  return deltaS < floorS * 0.5
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
function averagePct(values: number[]): number | null {
  if (values.length === 0) return null
  const finite = values.filter((v) => typeof v === 'number' && isFinite(v)).map((v) => clampPct(v))
  if (finite.length === 0) return null
  return finite.reduce((sum, v) => sum + v, 0) / finite.length
}
function msToS(ms: number | undefined | null): number | null {
  if (ms == null || ms === 0 || ms === -1 || !isFinite(ms)) return null
  return ms / 1000
}

/** Read the split milliseconds/minutes gap under either parser's field names. */
function readGapS(d: AnyParsedPacket): number | null {
  const ms = d.m_deltaToCarInFrontInMS ?? d.m_deltaToCarInFrontMSPart
  const minutes = d.m_deltaToCarInFrontMinutes ?? d.m_deltaToCarInFrontMinutesPart ?? 0
  if (typeof ms !== 'number' || !Number.isFinite(ms) || typeof minutes !== 'number' || !Number.isFinite(minutes)) return null
  const totalMs = minutes * 60000 + ms
  return totalMs > 0 ? totalMs / 1000 : null
}
/** Convert a 0..100 percentage field (uint8 damage/wear) to 0..1, guarding NaN/undef. */
function normPctTo01(v: number | undefined | null): number {
  if (v == null || !isFinite(v)) return 0
  return Math.max(0, Math.min(1, v / 100))
}
function finiteOrNull(v: unknown): number | null {
  return typeof v === 'number' && isFinite(v) ? v : null
}
/** Event-detail reader: keeps a real car index, rejects missing/NaN placeholders (-1). */
function numOrNull(v: number | undefined | null): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return null
  return Math.trunc(v)
}
function isRainWeatherCode(code: number): boolean {
  // F1 weather enum: 0 clear, 1 light cloud, 2 overcast, 3 light rain, 4 heavy rain, 5 storm.
  return code >= 3
}

function readTrackFlag(rawZones: unknown): { flag: RaceState['session']['trackFlag']; activeZones: number } {
  const zones = Array.isArray(rawZones) ? rawZones : []
  let activeZones = 0
  let flag: RaceState['session']['trackFlag'] = 'none'
  for (const zone of zones) {
    const zoneFlag = typeof zone?.m_zoneFlag === 'number' ? zone.m_zoneFlag : -1
    if (zoneFlag <= 0) continue
    if (zoneFlag !== 1) activeZones += 1
    if (zoneFlag === 4) return { flag: 'red', activeZones: Math.max(1, activeZones) }
    if (zoneFlag === 3) flag = 'yellow'
    else if (zoneFlag === 2 && flag !== 'yellow') flag = 'blue'
    else if (zoneFlag === 1 && flag === 'none') flag = 'green'
  }
  return { flag, activeZones }
}
function rivalStatus(driverStatus: number, resultStatus: number): RivalState['status'] {
  if (resultStatus === 3) return 'finished'
  // resultStatus 4=DSQ, 5=not classified, 6=retired — driverStatus 4=on track (not retired)
  if (resultStatus === 4 || resultStatus === 5 || resultStatus === 6) return 'retired'
  if (driverStatus === 0 || driverStatus === 7) return 'inGarage'
  return 'running'
}
