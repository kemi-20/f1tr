import type { Corners, RaceState } from '@shared/types/state'
import { lapsToFlag, raceFuelMargin } from '@shared/util/raceDistance'
import { StrategyObservations } from './StrategyObservations'
import { isQualifying } from '@shared/util/lapPhase'
import { sessionKind } from '@shared/util/sessionKind'
import { relativePosition } from './SpatialAwareness'

const corners = ['fl', 'fr', 'rl', 'rr'] as const

interface LapSample {
  lap: number
  time: number
  fuelUsed: number | null
  wearAdded: number
  cornerWearAdded: Corners
  trafficAffected: boolean
}

interface Observation {
  uid: string
  frame: number
  lap: number
  age: number
  compound: string
  pits: number
  fuel: number | null
  wear: number
  cornerWear: Corners
  clean: boolean
  weather: number
  damage: number
}

/** Bounded, local observations collected even when the radio is silent. */
export class RaceAnalysis {
  private readonly strategy = new StrategyObservations()
  private previous: Observation | null = null
  private boundary: Observation | null = null
  private laps: LapSample[] = []
  private cleanLap = false
  private trafficAffected = false
  private gaps: { ts: number; id: number; gap: number; lap: number }[] = []
  private pitInstruction: { uid: string; lap: number; pitStops: number } | null = null

  noteRadio(state: RaceState, text: string): void {
    if (sessionKind(state.session) !== 'race') return
    if (/^(?:box(?:,?\s+box)?(?:\s+this\s+lap)?\b|本圈进站|这圈(?:就)?进站)/i.test(text.trim().slice(0, 200))) {
      this.pitInstruction = { uid: state.session.sessionUID, lap: state.player.lap,
        pitStops: state.player.pitStopCount }
    }
  }

  observe(state: RaceState, now = Date.now()): void {
    this.strategy.observe(state, now)
    const p = state.player
    const s = state.session
    if (state.flashbackActive || !state.lastPacketMs || now - state.lastPacketMs > 5000) {
      this.resetStint()
      this.pitInstruction = null
      return
    }
    if (this.pitInstruction && (this.pitInstruction.uid !== s.sessionUID ||
      p.pitStopCount > this.pitInstruction.pitStops || p.lap < this.pitInstruction.lap)) {
      this.pitInstruction = null
    }
    const current: Observation = {
      uid: s.sessionUID, frame: s.overallFrameIdentifier, lap: p.lap,
      age: p.tyres.ageLaps, compound: p.tyres.compound, pits: p.pitStopCount,
      fuel: Number.isFinite(p.fuelRemainingKg) ? p.fuelRemainingKg : null,
      wear: Math.max(...Object.values(p.tyres.wear)),
      cornerWear: { ...p.tyres.wear },
      clean: corners.every(c => Number.isFinite(p.tyres.wear[c]) && p.tyres.wear[c] >= 0 && p.tyres.wear[c] <= 100) &&
        p.onTrack && !p.currentLapInvalid && p.pitStatus === 0 && !s.isSafetyCar && !s.isVirtualSafetyCar &&
        !s.isRedFlag && !['yellow', 'red'].includes(s.trackFlag),
      weather: state.weather.weatherCode,
      damage: Math.max(p.damage.frontLeftWing, p.damage.frontRightWing, p.damage.rearWing,
        p.damage.floor, p.damage.sidepodL, p.damage.sidepodR)
    }
    const prev = this.previous
    if (prev && (prev.uid !== current.uid || current.frame < prev.frame || current.lap < prev.lap ||
      current.pits !== prev.pits || current.age < prev.age || current.compound !== prev.compound ||
      current.wear < prev.wear - 5 || current.weather !== prev.weather || current.damage > prev.damage + 0.02)) {
      this.resetStint()
    }
    if (!this.previous) this.cleanLap = false // first observed lap may be partial
    const trafficNow = Object.values(state.rivals).some(r => {
      const position = relativePosition(state, r, now)
      return position.forwardCircuitDistanceM != null && position.forwardCircuitDistanceM > 0 &&
        position.forwardCircuitDistanceM < 150
    })
    this.trafficAffected ||= trafficNow
    this.cleanLap = this.cleanLap && current.clean
    if (this.previous && current.lap !== this.previous.lap) {
      const b = this.boundary
      const time = p.lastLapTimeS
      if (b && current.lap === b.lap + 1 && this.cleanLap && time != null &&
        Number.isFinite(time) && time > 20 && time < 600) {
        const used = b.fuel != null && current.fuel != null ? b.fuel - current.fuel : null
        this.laps.push({ lap: current.lap - 1, time,
          trafficAffected: this.trafficAffected,
          fuelUsed: used != null && used > 0 && used < 10 ? used : null,
          wearAdded: Math.max(0, current.wear - b.wear),
          cornerWearAdded: {
            fl: Math.max(0, current.cornerWear.fl - b.cornerWear.fl),
            fr: Math.max(0, current.cornerWear.fr - b.cornerWear.fr),
            rl: Math.max(0, current.cornerWear.rl - b.cornerWear.rl),
            rr: Math.max(0, current.cornerWear.rr - b.cornerWear.rr)
          } })
        this.laps = this.laps.slice(-6)
      } else {
        this.laps = []
      }
      this.boundary = current
      this.cleanLap = current.clean
      this.trafficAffected = trafficNow
    }
    this.previous = current
    if (!current.clean) this.gaps = []
    if (current.clean && (!this.gaps.length || now - this.gaps[this.gaps.length - 1].ts >= 5000)) {
      for (const r of Object.values(state.rivals)) {
        if (Math.abs(r.position - p.position) !== 1 || r.status !== 'running' || r.pitStatus !== 0 ||
          r.lap !== p.lap || r.gapToPlayerS == null || !Number.isFinite(r.gapToPlayerS)) continue
        this.gaps.push({ ts: now, id: r.carIndex, gap: r.gapToPlayerS, lap: p.lap })
      }
      this.gaps = this.gaps.filter(g => now - g.ts <= 35000).slice(-16)
    }
  }

  report(state: RaceState, now = Date.now()): string {
    const p = state.player
    const s = state.session
    const lines = ['ENGINEERING OBSERVATIONS (estimates, not commands):',
      `Telemetry age: ${state.lastPacketMs ? Math.max(0, now - state.lastPacketMs) + 'ms' : 'unknown'}; format ${state.packetFormat}; flag ${s.trackFlag}; pit status ${p.pitStatus}; penalties ${p.penaltiesS}s.`,
      `Warnings: total=${p.totalWarnings ?? 'unknown'}, track limits=${p.cornerCuttingWarnings ?? 'unknown'} (counts, NOT seconds). Ordinary pit stops do not clear time penalties. Query get_track_layout section=thermal for repeated segment heat before location-specific tyre coaching.`,
      'Corner order in digest: RL/RR/FL/FR. Rival signed gap: positive=ahead, negative=behind.',
      `Brake C RL/RR/FL/FR: ${Object.values({ rl: p.tyres.brakeTempC.rl, rr: p.tyres.brakeTempC.rr, fl: p.tyres.brakeTempC.fl, fr: p.tyres.brakeTempC.fr }).map(Math.round).join('/')}; floor damage ${(p.damage.floor * 100).toFixed(0)}%.`]
    if (!state.lastPacketMs || now - state.lastPacketMs > 5000 || state.flashbackActive) {
      return lines.concat('STALE/UNAVAILABLE: no live strategy or trend claims; request fresh telemetry.').join('\n')
    }
    const samples = this.laps
    if (isQualifying(state)) {
      lines.push(`QUALIFYING/SPRINT SHOOTOUT RUN: ${p.lapPhase ?? 'unknown'}; ${p.lapPhaseEvidence ?? 'no phase evidence'}. Lap invalid: ${p.currentLapInvalid ?? 'unknown'}. Session time left ${s.sessionTimeLeftS ?? 'unknown'}s. Scheduled race laps are NOT a qualifying run target.`)
      return lines.join('\n')
    }
    if (sessionKind(s) === 'practice') {
      lines.push(`PRACTICE RUN: ${s.sessionType === 4 ? 'short practice' : s.sessionType >= 1 && s.sessionType <= 3 ? `full practice P${s.sessionType}` : 'practice'}; ${s.sessionTimeLeftS ?? 'unknown'}s remaining; current lap ${p.lap}. No mandatory race stop or race-distance fuel target applies.`)
      lines.push(`Comparable clean laps this run: ${samples.map(l => `L${l.lap}=${l.time.toFixed(3)}s`).join(', ') || 'not enough yet'}.`)
      return lines.join('\n')
    }
    if (sessionKind(s) !== 'race') {
      lines.push('Session is neither race, practice nor qualifying; do not infer a race pit obligation or lap target.')
      return lines.join('\n')
    }
    lines.push('Race/sprint fuel constraint: no in-race refuelling, including SC/VSC stops. Stops do not replenish fuel. Evaluate finish feasibility with fuel already on board; a credible deficit requires saving, not BOX for fuel.')
    lines.push(...this.strategy.report(state))
    if (this.pitInstruction && this.pitInstruction.uid === s.sessionUID &&
      p.lap > this.pitInstruction.lap && p.pitStopCount === this.pitInstruction.pitStops) {
      lines.push(`Driver continued after our L${this.pitInstruction.lap} BOX instruction: likely strategy objection, not proof that pit entry was impossible.`)
    }
    const remaining = lapsToFlag(state)
    lines.push(remaining == null
      ? 'Race distance unavailable: query the current session before assuming a full Grand Prix distance.'
      : `Race distance: ${s.totalLaps} scheduled laps; ${remaining.toFixed(2)} laps to flag.`)
    const dryNow = !state.weather.isRaining && state.weather.wetness < 0.08 &&
      ['soft', 'medium', 'hard'].includes(p.tyres.compound)
    lines.push(s.totalLaps != null && s.totalLaps <= 5
      ? 'Very short 3/5-lap race: the ordinary dry two-compound stop rule does not apply.'
      : s.isSprintRace === true
        ? 'Confirmed sprint race: the ordinary dry two-compound stop obligation does not apply.'
        : s.isSprintRace === false && dryNow
          ? 'Dry Grand Prix: two-compound planning obligation applies unless special session rules or wet tyres change it.'
          : 'Two-compound obligation not established from live data (weekend structure, short-race setting, wet usage or special rules unknown).')
    const margin = raceFuelMargin(state)
    if (remaining != null && remaining > 0 && margin != null) {
      lines.push(`Game MFD fuel margin ${margin >= 0 ? '+' : ''}${margin.toFixed(2)} laps to finish (already surplus/deficit; do not subtract race distance again). Game estimate changes with pace and neutralisation.`)
    }
    lines.push(`Comparable observed laps: ${samples.map(l => `L${l.lap}=${l.time.toFixed(3)}s`).join(', ') || 'not enough yet'}. Pit/neutralised/weather-change laps excluded; validity and traffic can still confound pace.`)
    if (samples.length >= 3) {
      const old = samples.slice(0, -1)
      const baseline = old.reduce((sum, l) => sum + l.time, 0) / old.length
      lines.push(`Latest lap versus preceding mean: ${(samples[samples.length - 1].time - baseline).toFixed(3)}s (positive=slower); this alone does NOT prove tyre degradation.`)
      lines.push(`Pace confounders: observed nearby-ahead traffic on ${samples.filter(l => l.trafficAffected).map(l => `L${l.lap}`).join(', ') || 'none of these sampled laps'}. Traffic presence is not proof of time lost; sparse/missing positions can miss traffic. Fuel load falls across the stint and is not corrected by a calibrated seconds/kg model. Weather/damage changes, invalid and neutralised laps reset comparable observations. Do not attribute raw pace change solely to wear.`)
      const wearRate = samples.reduce((sum, l) => sum + l.wearAdded, 0) / samples.length
      lines.push(`Observed maximum-corner wear rise: ${wearRate.toFixed(2)} percentage points/lap; linear trend only, not a puncture prediction or universal pit threshold.`)
      if (remaining != null && remaining > 0) {
        for (const corner of corners) {
          const wear = p.tyres.wear[corner]
          const rate = samples.reduce((sum, lap) => sum + lap.cornerWearAdded[corner], 0) / samples.length
          if (!Number.isFinite(wear) || wear < 0 || wear > 100) continue
          const projected = wear + rate * remaining
          lines.push(`${corner.toUpperCase()} wear: ${wear.toFixed(1)}% now, +${rate.toFixed(2)}pp/lap over ${samples.length} comparable laps; no-stop linear finish projection ${projected.toFixed(1)}%. ${projected > 100 ? 'Beyond physical range: this extrapolation cannot support staying out.' : 'Not a safety guarantee or puncture threshold.'}`)
          const rates = samples.map(lap => lap.cornerWearAdded[corner])
          lines.push(`${corner.toUpperCase()} observed-rate sensitivity: ${(wear + Math.min(...rates) * remaining).toFixed(1)}-${(wear + Math.max(...rates) * remaining).toFixed(1)}% at flag. Range uses sampled minimum/maximum rates, not a statistical confidence interval.`)
        }
      }
      const fuelSamples = samples.map(l => l.fuelUsed).filter((v): v is number => v != null)
      if (fuelSamples.length >= 3 && p.fuelRemainingKg != null && Number.isFinite(p.fuelRemainingKg) && remaining != null && remaining > 0) {
        const rate = fuelSamples.reduce((a, b) => a + b, 0) / fuelSamples.length
        const projected = p.fuelRemainingKg - rate * remaining
        lines.push(`Fuel burn observed range ${Math.min(...fuelSamples).toFixed(2)}-${Math.max(...fuelSamples).toFixed(2)}kg/lap; flag-fuel sensitivity ${(p.fuelRemainingKg - Math.max(...fuelSamples) * remaining).toFixed(2)}-${(p.fuelRemainingKg - Math.min(...fuelSamples) * remaining).toFixed(2)}kg. Scenario range, not a guaranteed reserve.`)
        if (margin != null && margin >= 0.25 && projected > 0) {
          lines.push('Historical fuel cross-check also projects positive fuel at the flag.')
        } else {
          lines.push(`Historical fuel cross-check: ${projected.toFixed(2)}kg at flag using ${rate.toFixed(2)}kg/lap across ${fuelSamples.length} laps; this is remaining fuel, not a deficit or target.`)
        }
      }
    }
    for (const r of Object.values(state.rivals)) {
      if (Math.abs(r.position - p.position) !== 1 || r.status !== 'running') continue
      const history = this.gaps.filter(g => g.id === r.carIndex && g.lap === p.lap && now - g.ts <= 35000)
      const first = history[0], last = history[history.length - 1]
      const label = JSON.stringify(r.name.slice(0, 48))
      if (first && last && last.ts - first.ts >= 15000 && Math.sign(first.gap) === Math.sign(last.gap)) {
        lines.push(`Rival ${label}: absolute gap changed ${(Math.abs(last.gap) - Math.abs(first.gap)).toFixed(2)}s over ${((last.ts - first.ts) / 1000).toFixed(0)}s (negative=converging).`)
      }
      lines.push(`Rival ${label}: last lap ${r.lastLapTimeS?.toFixed(3) ?? 'unknown'}s, pit status ${r.pitStatus}; wear ${r.tyreWearAvg == null ? 'unavailable' : r.tyreWearAvg.toFixed(0) + '% (may be restricted)'}.`)
    }
    lines.push('Strategy inputs not computed in this summary: query session packet 1 for pit window/rejoin/rules, player tyre sets packet 12 for availability, session history packet 11 and stint/events for compound use and pit observations. Use inventory keys and timestamps. Do not label these unavailable until checked.')
    return lines.join('\n')
  }

  reset(): void {
    this.strategy.reset()
    this.resetStint()
    this.pitInstruction = null
  }

  private resetStint(): void {
    this.previous = null
    this.boundary = null
    this.laps = []
    this.cleanLap = false
    this.trafficAffected = false
    this.gaps = []
  }
}
