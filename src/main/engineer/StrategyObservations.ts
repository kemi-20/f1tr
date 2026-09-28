import type { RaceState, RivalState } from '@shared/types/state'

type Phase = 'GREEN' | 'VSC' | 'SC' | 'OTHER'
type Reference = { gap: number; pits: number }
type Snapshot = {
  uid: string; frame: number; ts: number; phase: Phase; weather: number
  pit: boolean; refs: Map<number, Reference>
}
type Stop = { phase: Phase; weather: number; lap: number; low: number; high: number; references: number }

/** Supporting observations, not a pit-loss model or an automatic box command. */
export class StrategyObservations {
  private previous: Snapshot | null = null
  private entry: Snapshot | null = null
  private stops: Stop[] = []

  observe(state: RaceState, now: number): void {
    if (!state.lastPacketMs || now < state.lastPacketMs || now - state.lastPacketMs > 5000 || state.flashbackActive) {
      this.reset()
      return
    }
    const current: Snapshot = {
      uid: state.session.sessionUID, frame: state.session.overallFrameIdentifier, ts: now,
      phase: phase(state), weather: state.weather.weatherCode,
      pit: state.player.pitStatus !== 0, refs: new Map()
    }
    for (const r of Object.values(state.rivals)) {
      if (r.carIndex === state.player.carIndex || r.status !== 'running' || r.pitStatus !== 0 ||
          r.lap !== state.player.lap || !Number.isFinite(r.gapToPlayerS) || r.gapToPlayerS == null) continue
      current.refs.set(r.carIndex, { gap: r.gapToPlayerS, pits: r.pitStopCount })
    }
    const prev = this.previous
    if (prev && (prev.uid !== current.uid || current.frame < prev.frame || now < prev.ts)) this.reset()
    else if (prev && now - prev.ts <= 2000) {
      if (!prev.pit && current.pit && prev.phase === current.phase && prev.weather === current.weather && current.phase !== 'OTHER') {
        this.entry = prev
      }
      const entry = this.entry
      if (entry) {
        if (entry.phase !== current.phase || entry.weather !== current.weather || now - entry.ts > 180_000) {
          this.entry = null
        } else {
          // Once a reference becomes incomparable, do not reinstate it during this stop.
          for (const [id, ref] of entry.refs) {
            const next = current.refs.get(id)
            if (!next || next.pits !== ref.pits) entry.refs.delete(id)
          }
          if (prev.pit && !current.pit) {
            const losses = [...entry.refs].map(([id, ref]) => current.refs.get(id)!.gap - ref.gap)
              .filter(loss => Number.isFinite(loss) && loss > 0 && loss <= 120)
            if (losses.length >= 2) {
              this.stops.push({ phase: entry.phase, weather: entry.weather, lap: state.player.lap,
                low: Math.min(...losses), high: Math.max(...losses), references: losses.length })
              this.stops = this.stops.slice(-12)
            }
            this.entry = null
          }
        }
      }
    } else this.entry = null
    this.previous = current
  }

  report(state: RaceState): string[] {
    const lines = [`Pit strategy regime: ${phase(state)}. Keep GREEN/VSC/SC losses separate; no default pit-loss seconds.`]
    const length = state.session.trackLengthM
    const playerPct = state.player.lapDistancePct
    if (Number.isFinite(length) && length > 0 && validFraction(playerPct) && state.player.pitStatus === 0) {
      const traffic = Object.values(state.rivals).filter(r => r.carIndex !== state.player.carIndex &&
        r.status === 'running' && r.pitStatus === 0 && validFraction(r.lapDistancePct))
        .map(r => ({ r, forward: ((r.lapDistancePct - playerPct + 1) % 1) * length }))
      const ahead = traffic.slice().sort((a, b) => a.forward - b.forward)[0]
      const behind = traffic.slice().sort((a, b) => b.forward - a.forward)[0]
      if (ahead) lines.push(trafficLine('ahead', ahead.r, ahead.forward, state.player.lap))
      if (behind) lines.push(trafficLine('behind', behind.r, behind.forward === 0 ? 0 : length - behind.forward, state.player.lap))
      if (traffic.length) lines.push('Physical separation is along-track metres, NOT a time gap or a predicted pit rejoin. Check original lap packet freshness; default positions can be unknown.')
    }
    for (const regime of ['GREEN', 'VSC', 'SC'] as const) {
      const comparable = this.stops.filter(stop => stop.phase === regime && stop.weather === state.weather.weatherCode)
      const recent = comparable[comparable.length - 1]
      lines.push(recent
        ? `${regime} stop observation L${recent.lap}: relative gap loss ${recent.low.toFixed(2)}-${recent.high.toFixed(2)}s against ${recent.references} non-pitting references; ${comparable.length} retained stop(s). Noisy evidence, NOT calibrated net pit loss: includes pace, service/penalties and sampling error; verify with raw lap timers/history.`
        : `${regime} pit-loss observation: unavailable in this session/conditions. Query pit timers/history or use an explicitly uncertain range; do not fabricate a fixed loss.`)
    }
    return lines
  }

  reset(): void { this.previous = null; this.entry = null; this.stops = [] }
}

function validFraction(value: number): boolean { return Number.isFinite(value) && value >= 0 && value < 1 }
function phase(state: RaceState): Phase {
  if (state.session.isRedFlag || state.session.trackFlag === 'red') return 'OTHER'
  if (state.session.isSafetyCar) return 'SC'
  if (state.session.isVirtualSafetyCar) return 'VSC'
  return state.session.trackFlag === 'yellow' ? 'OTHER' : 'GREEN'
}
function trafficLine(direction: string, rival: RivalState, metres: number, playerLap: number): string {
  return `Physical traffic ${direction}: carIndex ${rival.carIndex}, ${Math.round(metres)}m along track; race P${rival.position}, lap counter difference ${rival.lap - playerLap}. Lap counters differ around the line too; check total distance before calling a car lapped.`
}
