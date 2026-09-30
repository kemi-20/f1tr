import type { RaceState, RivalState } from '../types/state'
import type { TriggerFiring } from '../types/triggers'
import { sessionKind } from './sessionKind'
import { forwardDistance, validCircuitDistance } from './trackLayout'

export function isQualifying(state: RaceState): boolean {
  return sessionKind(state.session) === 'qualifying'
}

export function isTimedRunSession(state: RaceState): boolean {
  return ['practice', 'qualifying'].includes(sessionKind(state.session))
}

/** Unknown on-track qualifying phases stay quiet until preparation is confirmed. */
export function holdQualifyingRadio(state: RaceState, firing: TriggerFiring, now = Date.now()): boolean {
  if (!isQualifying(state) || firing.reasonCode === 'manual' || firing.priority === 'critical') return false
  const player = state.player
  if (!player.onTrack || player.pitStatus !== 0) return false
  if (!player.lapDataUpdatedAt || now < player.lapDataUpdatedAt || now - player.lapDataUpdatedAt > 2500) return true
  return !['out', 'cooling', 'in', 'garage'].includes(player.lapPhase ?? 'unknown')
}

const LAP_DATA_FRESH_MS = 2500

function freshLapData(ts: number | undefined, now: number): boolean {
  return ts != null && Number.isFinite(ts) && now >= ts && now - ts <= LAP_DATA_FRESH_MS
}

/**
 * The single definition of a valid flying rival physically behind the player on a
 * preparation lap. Both the trigger stage and the playback recheck use this gate;
 * they differ only in how they measure closing speed and ETA.
 */
export function qualifyingYieldGeometry(state: RaceState, rival: RivalState | undefined, now = Date.now()): { distanceM: number } | null {
  const p = state.player
  const length = state.session.trackLengthM
  if (!isTimedRunSession(state) || !['out', 'cooling', 'in'].includes(p.lapPhase ?? '') ||
      !p.onTrack || p.pitStatus !== 0 || !freshLapData(p.lapDataUpdatedAt, now) ||
      !rival || rival.status !== 'running' || rival.pitStatus !== 0 || rival.lapPhase !== 'flying' ||
      rival.currentLapInvalid !== false || !freshLapData(rival.lapDataUpdatedAt, now) ||
      !validCircuitDistance(p.distanceFromStartM, length) || !validCircuitDistance(rival.distanceFromStartM, length)) return null
  const distance = forwardDistance(rival.distanceFromStartM, p.distanceFromStartM, length)
  if (!(distance >= 1 && distance <= Math.min(800, length * 0.2))) return null
  return { distanceM: distance }
}

export function qualifyingYieldStillRelevant(state: RaceState, firing: TriggerFiring, now = Date.now()): boolean {
  if (firing.reasonCode !== 'qualifying_yield') return true
  const car = Number(firing.ruleId.replace(/^qualifying_yield_/, ''))
  if (now < firing.ts || now - firing.ts > 12_000) return false
  return qualifyingYieldGeometry(state, state.rivals[car], now) != null
}
