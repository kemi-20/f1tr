import type { RaceState } from '@shared/types/state'

interface LapSample {
  lap: number
  time: number
  fuelUsed: number | null
  wearAdded: number
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
  clean: boolean
  weather: number
  damage: number
}

/** Bounded, local observations collected even when the radio is silent. */
export class RaceAnalysis {
  private previous: Observation | null = null
  private boundary: Observation | null = null
  private laps: LapSample[] = []
  private cleanLap = false
  private gaps: { ts: number; id: number; gap: number; lap: number }[] = []

  observe(state: RaceState, now = Date.now()): void {
    const p = state.player
    const s = state.session
    if (state.flashbackActive || !state.lastPacketMs || now - state.lastPacketMs > 5000) {
      this.reset()
      return
    }
    const current: Observation = {
      uid: s.sessionUID, frame: s.overallFrameIdentifier, lap: p.lap,
      age: p.tyres.ageLaps, compound: p.tyres.compound, pits: p.pitStopCount,
      fuel: Number.isFinite(p.fuelRemainingKg) ? p.fuelRemainingKg : null,
      wear: Math.max(...Object.values(p.tyres.wear)),
      clean: p.onTrack && !p.currentLapInvalid && p.pitStatus === 0 && !s.isSafetyCar && !s.isVirtualSafetyCar &&
        !s.isRedFlag && !['yellow', 'red'].includes(s.trackFlag),
      weather: state.weather.weatherCode,
      damage: Math.max(...Object.values(p.damage))
    }
    const prev = this.previous
    if (prev && (prev.uid !== current.uid || current.frame < prev.frame || current.lap < prev.lap ||
      current.pits !== prev.pits || current.age < prev.age || current.compound !== prev.compound ||
      current.wear < prev.wear - 5 || current.weather !== prev.weather || current.damage > prev.damage + 0.02)) {
      this.reset()
    }
    if (!this.previous) this.cleanLap = false // first observed lap may be partial
    this.cleanLap = this.cleanLap && current.clean
    if (this.previous && current.lap !== this.previous.lap) {
      const b = this.boundary
      const time = p.lastLapTimeS
      if (b && current.lap === b.lap + 1 && this.cleanLap && time != null &&
        Number.isFinite(time) && time > 20 && time < 600) {
        const used = b.fuel != null && current.fuel != null ? b.fuel - current.fuel : null
        this.laps.push({ lap: current.lap - 1, time,
          fuelUsed: used != null && used > 0 && used < 10 ? used : null,
          wearAdded: Math.max(0, current.wear - b.wear) })
        this.laps = this.laps.slice(-6)
      } else {
        this.laps = []
      }
      this.boundary = current
      this.cleanLap = current.clean
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
      'Corner order in digest: RL/RR/FL/FR. Rival signed gap: positive=ahead, negative=behind; never infer DRS eligibility from gap alone.',
      `Brake C RL/RR/FL/FR: ${Object.values({ rl: p.tyres.brakeTempC.rl, rr: p.tyres.brakeTempC.rr, fl: p.tyres.brakeTempC.fl, fr: p.tyres.brakeTempC.fr }).map(Math.round).join('/')}; floor damage ${(p.damage.floor * 100).toFixed(0)}%.`]
    if (!state.lastPacketMs || now - state.lastPacketMs > 5000 || state.flashbackActive) {
      return lines.concat('STALE/UNAVAILABLE: no live strategy or trend claims; request fresh telemetry.').join('\n')
    }
    const samples = this.laps
    const remaining = s.totalLaps != null ? s.totalLaps - p.lap + 1 - p.lapDistancePct : null
    const gameFuelLaps = p.fuelRemainingLaps
    if (remaining != null && remaining > 0 && gameFuelLaps != null && Number.isFinite(gameFuelLaps)) {
      const margin = gameFuelLaps - remaining
      lines.push(`Game fuel estimate: ${gameFuelLaps.toFixed(2)} laps available, ${remaining.toFixed(2)} laps to flag, margin ${margin >= 0 ? '+' : ''}${margin.toFixed(2)} laps. ${margin >= 0.25 ? 'Fuel is sufficient at the current rate; do not request lift-and-coast or repeatedly warn about fuel.' : margin >= 0 ? 'Positive but narrow margin; monitor, no saving instruction solely from this reading.' : 'Estimated shortfall; assess recent consumption before requesting saving.'} Game estimate changes with pace and neutralisation.`)
    }
    lines.push(`Comparable observed laps: ${samples.map(l => `L${l.lap}=${l.time.toFixed(3)}s`).join(', ') || 'not enough yet'}. Pit/neutralised/weather-change laps excluded; validity and traffic can still confound pace.`)
    if (samples.length >= 3) {
      const old = samples.slice(0, -1)
      const baseline = old.reduce((sum, l) => sum + l.time, 0) / old.length
      lines.push(`Latest lap versus preceding mean: ${(samples[samples.length - 1].time - baseline).toFixed(3)}s (positive=slower); this alone does NOT prove tyre degradation.`)
      const wearRate = samples.reduce((sum, l) => sum + l.wearAdded, 0) / samples.length
      lines.push(`Observed maximum-corner wear rise: ${wearRate.toFixed(2)} percentage points/lap; linear trend only, not a puncture prediction or universal pit threshold.`)
      const fuelSamples = samples.map(l => l.fuelUsed).filter((v): v is number => v != null)
      if (fuelSamples.length >= 3 && p.fuelRemainingKg != null && remaining != null && remaining > 0) {
        const rate = fuelSamples.reduce((a, b) => a + b, 0) / fuelSamples.length
        const projected = p.fuelRemainingKg - rate * remaining
        if (gameFuelLaps != null && gameFuelLaps - remaining >= 0.25 && projected > 0) {
          lines.push('Historical fuel cross-check also projects positive fuel at the flag. No fuel-saving instruction is warranted at the current rate; avoid repeating this status unless it changes.')
        } else {
          lines.push(`Historical fuel cross-check: ${projected.toFixed(2)}kg at flag using ${rate.toFixed(2)}kg/lap across ${fuelSamples.length} laps. This is remaining fuel, NOT a deficit or target; positive fuel at the flag means enough to finish at this rate. Use game fuel-laps estimate above as the primary current signal when available. No reserve included; driving/SC changes invalidate projection. F1 race refuelling is not an option.`)
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
    lines.push('Unknown: measured pit-lane time loss, rejoin prediction, tyre inventory/mandatory compound completion, weather arrival time, corner-specific balance/slip. Do not invent these or issue a confident undercut/box call without them.')
    return lines.join('\n')
  }

  reset(): void {
    this.previous = null
    this.boundary = null
    this.laps = []
    this.cleanLap = false
    this.gaps = []
  }
}
