import type { RaceState } from '@shared/types/state'
import { getTrackLayout, trackLengthDisagrees, validCircuitDistance, wrapDistance } from '@shared/util/trackLayout'
import { sampleAge } from './SpatialAwareness'

export interface RejoinScenario { exitAfterMinS?: number; exitAfterMaxS?: number }

/** Coarse scenario screening, never an exact rejoin or a pit-loss calibration. */
export function pitRejoinTraffic(state: RaceState, scenario: RejoinScenario, now: number) {
  const layout = getTrackLayout(state.session.trackId)
  const length = state.session.trackLengthM
  const age = sampleAge(state.lastPacketMs, now)
  const min = scenario.exitAfterMinS, max = scenario.exitAfterMaxS
  const unavailable = (reason: string) => ({ available: false, reason })
  if (age == null || age > 2500 || state.flashbackActive) return unavailable('Fresh live telemetry required')
  if (!layout || layout.pitExitM == null || !Number.isFinite(length) || length <= 0 || trackLengthDisagrees(length, layout)) {
    return unavailable('Calibrated pit exit unavailable or track length mismatch')
  }
  if (state.session.isSafetyCar || state.session.isVirtualSafetyCar || state.session.isRedFlag || state.session.trackFlag !== 'green') {
    return unavailable('Lap-average projection is invalid during neutralisation or flag transitions; inspect live queue and game rejoin estimate')
  }
  if (min == null || max == null) return unavailable('Supply an evidence-based elapsed-time range from NOW until pit EXIT, including approach, pit travel, service and penalties. Net pit loss alone is NOT elapsed time. No default is assumed.')
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < min || max > 180) return unavailable('Invalid exit horizon: require 0 <= min <= max <= 180 seconds')
  const exit = layout.pitExitM / layout.lengthM * length
  const candidates: Array<Record<string, unknown>> = []
  const excluded: Array<{ carIndex: number; reason: string }> = []
  for (const r of Object.values(state.rivals)) {
    if (r.carIndex === state.player.carIndex) continue
    const lapAge = sampleAge(r.lapDataUpdatedAt, now)
    const lap = r.lastLapTimeS
    if (r.status !== 'running' || r.pitStatus !== 0 || lapAge == null || lapAge > 2500 ||
        !validCircuitDistance(r.distanceFromStartM, length) || lap == null || !Number.isFinite(lap) || lap < 20 || lap > 600 ||
        ['out', 'in', 'cooling', 'garage'].includes(r.lapPhase ?? '') || r.currentLapInvalid === true) {
      excluded.push({ carIndex: r.carIndex, reason: 'Inactive, pit route, stale/missing location, or no representative lap pace' })
      continue
    }
    // A declared sensitivity band, not a confidence interval. Local corner speeds can differ much more.
    const start = wrapDistance(r.distanceFromStartM, length) - exit
    const low = start + length / lap * 0.85 * min
    const high = start + length / lap * 1.15 * max
    const band = 500
    const nearExit = Math.ceil((low - band) / length) <= Math.floor((high + band) / length)
    const midpoint = wrapDistance((low + high) / 2 + length / 2, length) - length / 2
    candidates.push({ carIndex: r.carIndex, name: r.name, racePosition: r.position,
      lapDifference: r.lap - state.player.lap, lapPhase: r.lapPhase ?? 'unknown',
      lastLapTimeS: lap, lapDataAgeMs: lapAge, potentialExitTraffic: nearExit,
      midpointSignedDistanceFromExitM: Math.round(midpoint),
      unwrappedDistanceRangeFromExitM: [Math.floor(low), Math.ceil(high)],
      uncertaintySpansWholeLap: high - low >= length })
  }
  return { available: true, confidence: 'coarse scenario only', pitExitM: exit,
    assumedExitAfterS: [min, max], assumedPaceSensitivity: [0.85, 1.15], proximityBandM: 500,
    candidates, excluded, clearExitConfirmed: false,
    limitations: 'Uses previous-lap average speed, not a sector-speed profile; +/-15% is sensitivity only, not a bound. Positive midpoint means ahead of exit, negative behind. Includes lapped cars. Excluded cars remain unknown threats. Does not predict racing order, local corner speed, rival stops, cold-tyre out-lap loss or safe merge clearance. Compare multiple supported exit windows and live game rejoin estimate before choosing an undercut/overcut.' }
}
