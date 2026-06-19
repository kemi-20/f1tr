import type { TyreCompound } from '@shared/index'

/**
 * Map F1 25 `m_actualTyreCompound` / `m_visualTyreCompound` to our label.
 *
 * F1 25 uses the C-compound naming (the @deltazeroproduction lib TYRES table):
 *   16 = C5  (red)    → soft
 *   17 = C4  (red)    → soft
 *   18 = C3  (yellow) → medium
 *   19 = C2  (white)  → hard
 *   20 = C1  (white)  → hard
 *   21 = C0  (white)  → hard
 *   22 = C6  (red)    → soft  (C6 is the super-soft variant)
 *   7  = inter, 8 = wet
 * Classic values (F1 22 and earlier): 0=hypersoft, 3=soft, 4=medium, 5=hard...
 */
const COMPOUND_MAP: Record<number, TyreCompound> = {
  // F1 25 actualTyreCompound (C-compound scheme)
  16: 'soft', // C5
  17: 'soft', // C4
  18: 'medium', // C3
  19: 'hard', // C2
  20: 'hard', // C1
  21: 'hard', // C0
  22: 'soft', // C6
  // intermediates & wets
  7: 'inter',
  8: 'wet',
  // classic fallback (F1 22-era visual compounds)
  3: 'soft',
  4: 'medium',
  5: 'hard'
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
