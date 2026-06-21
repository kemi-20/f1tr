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
  private scActive = false
  private _prevRedFlagCount = 0
  private lastEventBucket = new Set<string>()

  getState(): RaceState {
    return this.state
  }

  setFlashbackActive(active: boolean): void {
    this.state.flashbackActive = active
  }

  setHealthStats(stats: { lastPacketMs: number; packetsReceived: number; packetsDropped: number }): void {
    this.state.lastPacketMs = stats.lastPacketMs
    this.state.packetsReceived = stats.packetsReceived
    this.state.packetsDropped = stats.packetsDropped
  }

  /** Reset racing state when session changes (keeps nothing — memory is handled elsewhere). */
  reset(format: PacketFormat): void {
    const prevErrors = this.state.recentEvents
    this.state = emptyRaceState(format)
    this.state.recentEvents = prevErrors
    this.lastSessionUID = ''
    this.lastEventBucket.clear()
    this.prevSC = 0
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
      if (!this.isDupe('redFlag', uid))
        this.pushEvent('redFlag', `Red flag #${redCount}`, undefined)
    } else if (decoded.resumed || (scStatus === 0 && !decoded.sc && !decoded.vsc)) {
      // racing has resumed — clear red flag
      s.isRedFlag = false
      this._prevRedFlagCount = redCount
    } else {
      this._prevRedFlagCount = Math.max(this._prevRedFlagCount ?? 0, redCount)
    }
    s.safetyCarPhase = scStatus
    if (decoded.sc || decoded.vsc) {
      this.scActive = true
    }
    if (scStatus !== this.prevSC) {
      if (decoded.sc && !this.isDupe('sc', uid)) this.pushEvent('safetyCar', 'Safety Car deployed')
      else if (decoded.vsc && !this.isDupe('vsc', uid)) this.pushEvent('vsc', 'Virtual Safety Car')
      else if (decoded.formation && !this.isDupe('formation', uid)) this.pushEvent('safetyCar', 'Formation lap')
      // SC/VSC may pass through status 4 (VSC ending), so keep a latched active
      // flag instead of relying only on the immediately previous enum value.
      if (this.scActive && (scStatus === 0 || decoded.resumed)) {
        if (!this.isDupe('sc-ended', uid)) this.pushEvent('safetyCar', 'SC/VSC ended — green flag')
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
    if (!wasRaining && nowRaining && !this.isDupe('rain', uid)) {
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
    this.state.player.carIndex = playerIdx
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
      pl.currentLapTimeS = msToS(pld.m_currentLapTimeInMs)
      pl.lastLapTimeS = msToS(pld.m_lastLapTimeInMs)
      pl.pitStatus = numOr(pld.m_pitStatus, pl.pitStatus)
      pl.pitTimerS = msToS(pld.m_pitStopTimerInMS)
      pl.pitStopCount = numOr(pld.m_numPitStops, pl.pitStopCount)
      pl.penaltiesS = numOr(pld.m_penalties, pl.penaltiesS)
      // driverStatus 1-4 are all "on track" (flying lap, in lap, out lap, on track)
      pl.onTrack = (pld.m_driverStatus ?? 1) >= 1 && (pld.m_driverStatus ?? 1) <= 4
    }

    const playerPos = this.state.player.position
    const playerCarIndex = this.state.player.carIndex
    const playerIdxInSorted = sorted.findIndex((r) => r.carIndex === playerCarIndex || r.position === playerPos)
    if (playerIdxInSorted >= 0) {
      const playerRival = sorted[playerIdxInSorted]
      playerRival.gapToPlayerS = 0

      // Walk UP from the player. The first car ahead uses the player's own
      // delta-to-front; cars further ahead use the closer car's chained gap.
      let cumAhead = 0
      let validAhead = false
      for (let i = playerIdxInSorted - 1; i >= 0; i--) {
        const gap = i === playerIdxInSorted - 1
          ? playerRival.deltaToCarInFrontS
          : sorted[i].deltaToCarBehindS
        if (gap != null) {
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
        if (gap != null) {
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
    pl.throttle = t.m_throttle ?? pl.throttle
    pl.brake = t.m_brake ?? pl.brake
    pl.revLightsPercent = t.m_revLightsPercent ?? pl.revLightsPercent
    pl.drsActive = ((t.m_drs ?? 0) & 2) !== 0

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
        pl.fuelMix = (st.m_fuelMix ?? 1) as 0 | 1 | 2 | 3
        pl.drsAllowed = (st.m_drsAllowed ?? 0) !== 0
        pl.tyres.rawCompoundId = typeof st.m_actualTyreCompound === 'number' ? st.m_actualTyreCompound : -1
        pl.tyres.compound = mapCompound(pl.tyres.rawCompoundId, this.state.session.trackId)
        pl.tyres.ageLaps = st.m_tyresAgeLaps ?? pl.tyres.ageLaps
        // ERS store energy is in joules, capacity ~4e6 J
        pl.ersPercent = clamp01((st.m_ersStoreEnergy ?? 0) / 4_000_000)
        // mirror player's tyre into rival entry so RivalsPanel shows it (not '?')
        const pr = this.ensureRival(i)
        pr.tyreCompound = pl.tyres.compound
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
    const d = (p.m_eventDetails ?? {}) as Record<string, number>
    const uid = h.m_sessionUID.toString()
    const vIdx = d.vehicleIdx ?? -1
    const driver = this.driverLabel(vIdx)
    switch (code) {
      case 'FTLP':
        if (!this.isDupe(`ftlp-${vIdx}`, uid)) this.pushEvent('fastestLap', `Fastest lap by ${driver}`, vIdx)
        break
      case 'RTMT':
        // RTMT = Retirement (car carries vehicleIdx). SEND = SessionEnded, NOT retirement.
        if (!this.isDupe(`retire-${vIdx}`, uid)) this.pushEvent('retirement', `${driver} retired`, vIdx)
        break
      case 'OVTK':
        if (!this.isDupe(`ovtk-${vIdx}`, uid)) this.pushEvent('overtake', `${driver} overtook`, vIdx)
        break
      case 'COLL':
        if (!this.isDupe(`coll-${vIdx}`, uid)) this.pushEvent('collision', `Collision involving ${driver}`, vIdx)
        break
      case 'SPIN':
        if (!this.isDupe(`spin-${vIdx}`, uid)) this.pushEvent('spin', `${driver} spun`, vIdx)
        break
      case 'DRSE':
        if (vIdx === this.state.player.carIndex) logger.debug('DRS enabled')
        break
      case 'DRSD':
        if (vIdx === this.state.player.carIndex) logger.debug('DRS disabled')
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
        if (!this.isDupe('sessionEnded', uid)) this.pushEvent('sessionEnded', 'Session ended', vIdx)
        break
      case 'PENA':
        if (!this.isDupe(`pen-${vIdx}`, uid))
          this.pushEvent('penalty', `Penalty for ${driver}`, vIdx)
        break
      case 'RCWN':
        if (!this.isDupe(`win-${vIdx}`, uid)) this.pushEvent('raceWinner', `${driver} wins`, vIdx)
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
      const packetBestS = best === Infinity ? null : best / 1000
      r.bestLapTimeS = minNullable(r.bestLapTimeS, packetBestS)
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
        position: 0,
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
        tyreWearAvg: null,
        resultStatus: 0,
        status: 'running',
        relationToPlayer: 'same'
      }
    }
    return this.state.rivals[carIndex]
  }

  private driverLabel(carIndex: number): string {
    if (carIndex === this.state.player.carIndex) return this.state.rivals[carIndex]?.name || 'player'
    return this.state.rivals[carIndex]?.name || `driver #${carIndex}`
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
  const hasMinPart = typeof d.m_deltaToCarInFrontMinutesPart === 'number'
  const hasMsPart = typeof d.m_deltaToCarInFrontMSPart === 'number'
  if (!hasMinPart && !hasMsPart) return null
  const minPart = hasMinPart ? d.m_deltaToCarInFrontMinutesPart : 0
  const msPart = hasMsPart ? d.m_deltaToCarInFrontMSPart : 0
  const totalMs = minPart * 60000 + msPart
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
function minNullable(a: number | null, b: number | null): number | null {
  if (a == null) return b
  if (b == null) return a
  return Math.min(a, b)
}
function isRainWeatherCode(code: number): boolean {
  // F1 weather enum: 0 clear, 1 light cloud, 2 overcast, 3 light rain, 4 heavy rain, 5 storm.
  return code >= 3
}
function rivalStatus(driverStatus: number, resultStatus: number): RivalState['status'] {
  if (resultStatus === 3) return 'finished'
  // resultStatus 4=DSQ, 5=not classified, 6=retired — driverStatus 4=on track (not retired)
  if (resultStatus === 4 || resultStatus === 5 || resultStatus === 6) return 'retired'
  if (driverStatus === 0 || driverStatus === 7) return 'inGarage'
  return 'running'
}
