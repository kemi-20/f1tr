import type { TyreCompound } from '@shared/index'

/**
 * Map the F1 actual/visual tyre compound IDs to our label.
 * The spec encodes compounds as small integers; we only need the broad buckets.
 */
const COMPOUND_MAP: Record<number, TyreCompound> = {
  // actualTyreCompound values (F1 23+ spec)
  16: 'soft',
  17: 'medium',
  18: 'hard',
  7: 'inter',
  8: 'wet',
  // classic fallback values
  0: 'soft',
  1: 'medium',
  2: 'hard',
  3: 'inter',
  4: 'wet'
}

export function mapCompound(id: number): TyreCompound {
  return COMPOUND_MAP[id] ?? 'unknown'
}

/** Safety car status -> flags, per F1 spec enum. */
export function decodeSafetyCar(status: number): { sc: boolean; vsc: boolean; red: boolean } {
  // 0=no SC, 1=full SC, 2=virtual SC (approx; red flag separate)
  return {
    sc: status === 1,
    vsc: status === 2,
    red: false
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
