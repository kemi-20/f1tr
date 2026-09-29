import type { RaceState } from '../types/state'
import type { TriggerFiring } from '../types/triggers'
import { sessionKind } from './sessionKind'

export function isQualifying(state: RaceState): boolean {
  return sessionKind(state.session) === 'qualifying'
}

/** Unknown on-track qualifying phases stay quiet until preparation is confirmed. */
export function holdQualifyingRadio(state: RaceState, firing: TriggerFiring, now = Date.now()): boolean {
  if (!isQualifying(state) || firing.reasonCode === 'manual' || firing.priority === 'critical') return false
  const player = state.player
  if (!player.onTrack || player.pitStatus !== 0) return false
  if (!player.lapDataUpdatedAt || now - player.lapDataUpdatedAt > 2500) return true
  return !['out', 'cooling', 'in', 'garage'].includes(player.lapPhase ?? 'unknown')
}

export function qualifyingYieldStillRelevant(state: RaceState, firing: TriggerFiring, now = Date.now()): boolean {
  if (firing.reasonCode !== 'qualifying_yield') return true
  const p = state.player
  const car = Number(firing.ruleId.replace(/^qualifying_yield_/, ''))
  const r = state.rivals[car]
  const length = state.session.trackLengthM
  if (!isQualifying(state) || !['out', 'cooling', 'in'].includes(p.lapPhase ?? '') ||
      !p.onTrack || p.pitStatus !== 0 || !p.lapDataUpdatedAt || now - p.lapDataUpdatedAt > 2500 ||
      !r || r.status !== 'running' || r.pitStatus !== 0 || r.lapPhase !== 'flying' ||
      r.currentLapInvalid !== false || !r.lapDataUpdatedAt || now - r.lapDataUpdatedAt > 2500 ||
      !Number.isFinite(length) || length <= 0 || !Number.isFinite(p.lapDistancePct) ||
      !Number.isFinite(r.lapDistancePct) || now - firing.ts > 12_000) return false
  const distance = ((p.lapDistancePct - r.lapDistancePct + 1) % 1) * length
  return distance >= 1 && distance <= Math.min(800, length * 0.2)
}
