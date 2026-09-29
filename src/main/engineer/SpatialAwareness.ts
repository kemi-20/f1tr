import type { RaceState, RivalState } from '@shared/types/state'
import { sessionKind } from '@shared/util/sessionKind'
import { forwardDistance, validCircuitDistance } from '@shared/util/trackLayout'
export { validCircuitDistance } from '@shared/util/trackLayout'

const FRESH_MS = 2500

export function sampleAge(ts: number | undefined, now: number): number | null {
  return ts != null && Number.isFinite(ts) && ts > 0 && ts <= now ? now - ts : null
}

function lapTime(value: number | null): number | null {
  return value != null && Number.isFinite(value) && value > 0 && value <= 600 ? value : null
}

/** Separate timing-sheet performance, classification timing and physical loop proximity. */
export function relativePosition(state: RaceState, rival: RivalState, now = Date.now()) {
  const p = state.player
  const length = state.session.trackLengthM
  const playerAge = sampleAge(p.lapDataUpdatedAt, now)
  const rivalAge = sampleAge(rival.lapDataUpdatedAt, now)
  const fresh = !state.flashbackActive && playerAge != null && rivalAge != null &&
    playerAge <= FRESH_MS && rivalAge <= FRESH_MS && Math.abs(playerAge - rivalAge) <= 750
  const comparable = fresh && p.onTrack && p.pitStatus === 0 &&
    rival.status === 'running' && rival.pitStatus === 0 &&
    validCircuitDistance(p.distanceFromStartM, length) && validCircuitDistance(rival.distanceFromStartM, length)
  const forward = comparable ? forwardDistance(p.distanceFromStartM!, rival.distanceFromStartM!, length) : null
  const backward = forward == null ? null : (length - forward) % length
  const signed = forward == null ? null : forward > length / 2 ? forward - length : forward
  const playerBest = lapTime(p.bestLapTimeS)
  const rivalBest = lapTime(rival.bestLapTimeS)
  const kind = sessionKind(state.session)
  return {
    carIndex: rival.carIndex,
    name: rival.name,
    classificationPosition: fresh && Number.isInteger(rival.position) && rival.position > 0 && rival.position <= 24
      ? rival.position : null,
    route: rival.pitStatus !== 0 ? 'pit' : rival.status === 'inGarage' ? 'garage'
      : rival.status === 'running' ? 'track' : 'unknown',
    lapPhase: rival.lapPhase ?? 'unknown',
    lapPhaseEvidence: rival.lapPhaseEvidence ?? null,
    currentLapInvalid: rival.currentLapInvalid ?? null,
    lapDataAgeMs: rivalAge,
    playerLapDataAgeMs: playerAge,
    physicalComparisonAvailable: comparable,
    unavailableReason: comparable ? null : !fresh ? 'stale, missing, unsynchronised or flashback LapData'
      : 'different route, inactive car or missing/invalid lap distance',
    lapDifference: rival.lap - p.lap,
    raceDistanceSeparationM: fresh && Number.isFinite(p.totalDistanceM) && Number.isFinite(rival.totalDistanceM)
      ? rival.totalDistanceM! - p.totalDistanceM! : null,
    forwardCircuitDistanceM: forward,
    backwardCircuitDistanceM: backward,
    trackRelativeSeparationM: signed,
    shortestArcDistanceM: signed == null ? null : Math.abs(signed),
    nearestDirection: signed == null ? 'unknown' : signed === 0 ? 'alongside'
      : Math.abs(signed) === length / 2 ? 'equidistant' : signed > 0 ? 'ahead' : 'behind',
    playerBestLapTimeS: playerBest,
    bestLapTimeS: rivalBest,
    bestLapDeltaToPlayerS: playerBest != null && rivalBest != null ? rivalBest - playerBest : null,
    raceTimingGapToPlayerS: kind === 'race' && fresh && Number.isFinite(rival.gapToPlayerS)
      ? rival.gapToPlayerS : null,
    rankingDisplayDeltaS: kind === 'race'
      ? fresh && Number.isFinite(rival.gapToPlayerS) ? -rival.gapToPlayerS! : null
      : playerBest != null && rivalBest != null ? rivalBest - playerBest : null
  }
}

/** At least three coherent LapData observations; never divide proximity by one car's speed. */
export function relativeMotion(states: readonly RaceState[], carIndex: number, now = Date.now()) {
  const unavailable = { closingMps: null, catchEstimateS: null, sampleCount: 0,
    observationWindowS: null, evidence: 'insufficient coherent recent relative-position observations' }
  const latest = states.at(-1)
  if (!latest || latest.flashbackActive) return unavailable
  const length = latest.session.trackLengthM
  const samples: { ts: number; distance: number; player: number; rival: number; frame: number }[] = []
  for (const state of states) {
    const r = state.rivals[carIndex]
    const ts = state.player.lapDataUpdatedAt
    if (!r || !ts || state.session.sessionUID !== latest.session.sessionUID ||
      state.session.sessionType !== latest.session.sessionType || state.session.trackId !== latest.session.trackId ||
      state.session.trackLengthM !== length || state.player.carIndex !== latest.player.carIndex || state.flashbackActive) return unavailable
    const relative = relativePosition(state, r, ts)
    if (!relative.physicalComparisonAvailable || relative.trackRelativeSeparationM == null ||
      sampleAge(ts, now) == null || now - ts > 4000) return unavailable
    if (samples.at(-1)?.ts === ts) continue
    samples.push({ ts, distance: relative.trackRelativeSeparationM,
      player: state.player.distanceFromStartM!, rival: r.distanceFromStartM!, frame: state.session.overallFrameIdentifier })
  }
  if (samples.length < 3 || now - samples.at(-1)!.ts > FRESH_MS) return unavailable
  const rates: number[] = []
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i]
    const dt = (b.ts - a.ts) / 1000
    if (dt < 0.1 || dt > 2 || b.frame < a.frame || Math.sign(a.distance) !== Math.sign(b.distance) ||
      Math.abs(b.distance - a.distance) > Math.min(length / 4, 120 * dt)) return unavailable
    for (const key of ['player', 'rival'] as const) {
      // Tiny negative jitter is tolerated, but a flashback/teleport must not become closing speed.
      const advance = forwardDistance(a[key], b[key], length)
      if (advance > 120 * dt && advance < length - 2) return unavailable
    }
    rates.push((Math.abs(a.distance) - Math.abs(b.distance)) / dt)
  }
  const first = samples[0], last = samples.at(-1)!
  const dt = (last.ts - first.ts) / 1000
  if (dt < 1 || Math.abs(last.distance) >= Math.min(1000, length / 4)) return unavailable
  const closing = (Math.abs(first.distance) - Math.abs(last.distance)) / dt
  const stable = rates.every(rate => rate > 1) && Math.max(...rates) - Math.min(...rates) <= 20
  const eta = stable && closing > 1 ? Math.abs(last.distance) / closing : null
  return { closingMps: Math.round(closing * 10) / 10,
    catchEstimateS: eta != null && eta <= 30 ? Math.round(eta * 10) / 10 : null,
    sampleCount: samples.length, observationWindowS: dt,
    evidence: 'Observed shortest-arc change on the same racing route. Positive closing means converging; ETA assumes rates persist, is not a timing gap and is not a pit-rejoin prediction.' }
}
