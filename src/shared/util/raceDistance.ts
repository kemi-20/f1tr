import type { RaceState } from '../types/state'
import { sessionKind } from './sessionKind'

/** Current lap is one-based and includes its uncompleted fraction. */
export function lapsToFlag(state: RaceState): number | null {
  const total = state.session.totalLaps
  const { lap, lapDistancePct } = state.player
  if (total == null || !Number.isInteger(total) || total <= 0 || total > 255 ||
      !Number.isInteger(lap) || lap < 1 || lap > total + 1 ||
      !Number.isFinite(lapDistancePct) || lapDistancePct < 0 || lapDistancePct > 1) return null
  return Math.max(0, total - lap + 1 - lapDistancePct)
}

export function raceFuelMargin(state: RaceState): number | null {
  const margin = state.player.fuelRemainingLaps
  // The race MFD value is already relative to the finish. Practice uses a run
  // estimate, so must not inherit the race surplus/deficit interpretation.
  if (sessionKind(state.session) !== 'race' ||
      margin == null || !Number.isFinite(margin)) return null
  return margin
}
