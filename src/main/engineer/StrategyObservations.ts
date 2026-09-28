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
    if (Number.isFinite(length) && length > 0 && state.player.pitStatus === 0) {
      // Prefer lap-aware total distance; the lap-fraction path is only a fallback for
      // builds where m_totalDistance is missing.
      const playerTotal = state.player.totalDistanceM
      const playerPct = state.player.lapDistancePct
      const traffic = Object.values(state.rivals).filter(r => r.carIndex !== state.player.carIndex &&
        r.status === 'running' && r.pitStatus === 0)
        .map(r => playerTotal != null && r.totalDistanceM != null
          ? { r, metres: r.totalDistanceM - playerTotal }
          : validFraction(r.lapDistancePct) && validFraction(playerPct)
            ? { r, metres: fallbackSeparation(r, playerPct, state.player.lap, length) }
            : null)
        .filter((entry): entry is { r: RivalState; metres: number } => entry != null &&
          Number.isFinite(entry.metres) && Math.abs(entry.metres) < length)
      const ahead = traffic.filter(t => t.metres > 0).sort((a, b) => a.metres - b.metres).slice(0, 2)
      const behind = traffic.filter(t => t.metres < 0).sort((a, b) => b.metres - a.metres).slice(0, 2)
      for (const t of ahead) lines.push(trafficLine('ahead', t.r, t.metres, state.player.lap, length))
      for (const t of behind) lines.push(trafficLine('behind', t.r, -t.metres, state.player.lap, length))
      if (traffic.length) lines.push('Separation is signed along-track metres from total distance, NOT a time gap and NOT a predicted pit rejoin. Convert to seconds only by dividing by your own current speed, and say that is an estimate. gapToPlayerS comes from the game timing chain and can glitch at the line; if it contradicts these metres, trust the metres.')
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

/**
 * Signed separation from lap fractions when m_totalDistance is unavailable. Wrapping a
 * fraction on its own turns a car 200m BEHIND into "4800m ahead"; the lap counter decides
 * which side of the line the car actually sits on.
 */
function fallbackSeparation(rival: RivalState, playerPct: number, playerLap: number, length: number): number {
  const forward = (rival.lapDistancePct - playerPct + 1) % 1
  const lapDelta = rival.lap - playerLap
  if (lapDelta > 0) return forward * length + lapDelta * length
  if (lapDelta < 0) return forward * length + lapDelta * length
  return forward > 0.5 ? forward * length - length : forward * length
}
function phase(state: RaceState): Phase {
  if (state.session.isRedFlag || state.session.trackFlag === 'red') return 'OTHER'
  if (state.session.isSafetyCar) return 'SC'
  if (state.session.isVirtualSafetyCar) return 'VSC'
  return state.session.trackFlag === 'yellow' ? 'OTHER' : 'GREEN'
}
function trafficLine(direction: string, rival: RivalState, metres: number, playerLap: number, length: number): string {
  const who = (rival.name || rival.driverCode || `carIndex ${rival.carIndex}`).toUpperCase()
  const aheadToLine = direction === 'behind' ? Math.round(length - metres) : null
  return `Physical traffic ${direction}: ${who} P${rival.position}, ${Math.round(metres)}m ${direction} on track${aheadToLine != null ? ` (${aheadToLine}m to the line from behind)` : ''}; lap counter difference ${rival.lap - playerLap}. Gap ${rival.gapToPlayerS != null ? `${rival.gapToPlayerS.toFixed(2)}s` : 'unavailable'} is game timing-chain data, not a measurement of the metres above.`
}
