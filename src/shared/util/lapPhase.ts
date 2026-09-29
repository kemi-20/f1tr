import type { RaceState } from '../types/state'
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

export function qualifyingYieldStillRelevant(state: RaceState, firing: TriggerFiring, now = Date.now()): boolean {
  if (firing.reasonCode !== 'qualifying_yield') return true
  const p = state.player
  const car = Number(firing.ruleId.replace(/^qualifying_yield_/, ''))
  const r = state.rivals[car]
  const length = state.session.trackLengthM
  if (!isTimedRunSession(state) || !['out', 'cooling', 'in'].includes(p.lapPhase ?? '') ||
      !p.onTrack || p.pitStatus !== 0 || !p.lapDataUpdatedAt || now < p.lapDataUpdatedAt || now - p.lapDataUpdatedAt > 2500 ||
      !r || r.status !== 'running' || r.pitStatus !== 0 || r.lapPhase !== 'flying' ||
      r.currentLapInvalid !== false || !r.lapDataUpdatedAt || now < r.lapDataUpdatedAt || now - r.lapDataUpdatedAt > 2500 ||
      !validCircuitDistance(p.distanceFromStartM, length) || !validCircuitDistance(r.distanceFromStartM, length) ||
      now < firing.ts || now - firing.ts > 12_000) return false
  const distance = forwardDistance(r.distanceFromStartM, p.distanceFromStartM, length)
  return distance >= 1 && distance <= Math.min(800, length * 0.2)
}
