import type { TyreCompound } from '@shared/index'

/**
 * Map F1 25 `m_actualTyreCompound` to our weekend label.
 *
 * The raw value identifies the physical Pirelli C-compound. S/M/H is NOT fixed:
 * Pirelli nominates three compounds per race weekend, and the hardest nominated
 * compound is labelled hard, the middle one medium, and the softest one soft.
 */
type DryCompound = 1 | 2 | 3 | 4 | 5 | 6

const WET_COMPOUND_MAP: Record<number, TyreCompound> = {
  7: 'inter',
  8: 'wet'
}

const ACTUAL_TO_DRY_C: Record<number, DryCompound> = {
  21: 1, // C0/legacy hard-range value; treat as hardest if it appears
  20: 1, // C1
  19: 2, // C2
  18: 3, // C3
  17: 4, // C4
  16: 5, // C5
  22: 6 // C6, used by selected 2025 weekends
}

// F1 25 calendar allocations, keyed by Codemasters m_trackId. Tuple = [hard, medium, soft].
// Madrid is a 2026 DLC track; no final race allocation was available when added, so use
// the game's street-circuit fallback of C3/C4/C5 until an official nomination is published.
export const TRACK_DRY_TYRE_ALLOCATIONS: Record<number, readonly [DryCompound, DryCompound, DryCompound]> = {
  0: [3, 4, 5], // Australia
  2: [2, 3, 4], // China
  3: [1, 2, 3], // Bahrain
  4: [1, 2, 3], // Spain / Catalunya
  5: [4, 5, 6], // Monaco
  6: [4, 5, 6], // Canada
  7: [2, 3, 4], // Silverstone
  9: [3, 4, 5], // Hungary
  10: [1, 3, 4], // Belgium
  11: [3, 4, 5], // Monza
  12: [3, 4, 5], // Singapore
  13: [1, 2, 3], // Japan
  14: [3, 4, 5], // Abu Dhabi
  15: [1, 3, 4], // Austin
  16: [2, 3, 4], // Sao Paulo
  17: [3, 4, 5], // Austria
  19: [2, 4, 5], // Mexico City
  20: [4, 5, 6], // Baku
  26: [2, 3, 4], // Zandvoort
  27: [4, 5, 6], // Imola
  29: [3, 4, 5], // Jeddah
  30: [3, 4, 5], // Miami
  31: [3, 4, 5], // Las Vegas
  32: [1, 2, 3], // Qatar
  42: [3, 4, 5] // Madrid
}

const LEGACY_VISUAL_COMPOUND_MAP: Record<number, TyreCompound> = {
  3: 'soft',
  4: 'medium',
  5: 'hard'
}

export function mapCompound(id: number, trackId?: number): TyreCompound {
  const wet = WET_COMPOUND_MAP[id]
  if (wet) return wet

  const dry = ACTUAL_TO_DRY_C[id]
  if (dry) return mapDryCompoundForTrack(dry, trackId)

  return LEGACY_VISUAL_COMPOUND_MAP[id] ?? 'unknown'
}

function mapDryCompoundForTrack(compound: DryCompound, trackId?: number): TyreCompound {
  const allocation = trackId == null ? null : TRACK_DRY_TYRE_ALLOCATIONS[trackId]
  if (allocation) {
    if (compound === allocation[0]) return 'hard'
    if (compound === allocation[1]) return 'medium'
    if (compound === allocation[2]) return 'soft'
    return 'unknown'
  }

  // Conservative fallback for unknown/custom tracks.
  if (compound <= 2) return 'hard'
  if (compound === 3) return 'medium'
  return 'soft'
}

/** Safety car status -> flags, per F1 spec enum.
 *  0=none, 1=full SC, 2=VSC, 3=formation lap, 4=VSC ending, 5=racing resumed. */
export function decodeSafetyCar(status: number): { sc: boolean; vsc: boolean; formation: boolean; resumed: boolean } {
  return {
    sc: status === 1,
    vsc: status === 2,
    formation: status === 3,
    resumed: status === 5
  }
}

const SESSION_TYPES: Record<number, string> = {
  0: 'Unknown',
  1: 'P1',
  2: 'P2',
  3: 'P3',
  4: 'Short P',
  5: 'Q1',
  6: 'Q2',
  7: 'Q3',
  8: 'Short Q',
  9: 'OSQ',
  10: 'TT',
  11: 'Practice',
  12: 'Qualifying',
  13: 'Race',
  14: 'Race 2',
  15: 'Race 3',
  16: 'Time Trial'
}

export function sessionTypeLabel(t: number): string {
  return SESSION_TYPES[t] ?? `Session ${t}`
}
