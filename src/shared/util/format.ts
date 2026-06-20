/** Pure formatting helpers — used by digest builder and UI. */

export function fmtLapTime(ms: number | null | undefined): string {
  if (ms == null || !isFinite(ms) || ms <= 0) return '--'
  const totalS = ms / 1000
  const m = Math.floor(totalS / 60)
  const s = totalS - m * 60
  return `${m}:${s.toFixed(3).padStart(6, '0')}`
}

export function fmtGap(s: number | null | undefined): string {
  if (s == null || !isFinite(s)) return '--'
  const abs = Math.abs(s)
  const sign = s > 0 ? '+' : s < 0 ? '-' : ''
  if (abs >= 60) {
    const m = Math.floor(abs / 60)
    const rest = abs - m * 60
    return `${sign}${m}:${rest.toFixed(1).padStart(4, '0')}`
  }
  return `${sign}${abs.toFixed(3)}`
}

export function fmtPct(x: number | null | undefined, digits = 0): string {
  if (x == null || !isFinite(x)) return '--'
  return `${(x * 100).toFixed(digits)}%`
}

/** Short label for the compound category (S/M/H/I/W). */
export function compoundLabel(c: string | undefined): string {
  switch (c) {
    case 'soft':
      return 'S'
    case 'medium':
      return 'M'
    case 'hard':
      return 'H'
    case 'inter':
      return 'I'
    case 'wet':
      return 'W'
    default:
      return '?'
  }
}

/** C-compound name from the raw actualTyreCompound id. Returns '' for non-dry compounds. */
export function compoundCName(rawId: number | undefined): string {
  switch (rawId) {
    case 16:
      return 'C5'
    case 17:
      return 'C4'
    case 18:
      return 'C3'
    case 19:
      return 'C2'
    case 20:
      return 'C1'
    case 21:
      return 'C0'
    case 22:
      return 'C6'
    default:
      return '' // inter/wet/unknown have no C-name
  }
}

/** Map tyre surface temp (C) to a 0..1 heat scale for color. */
export function tempScale(c: number | null | undefined): number {
  if (c == null || !isFinite(c)) return 0.5
  const lo = 70
  const hi = 120
  return Math.max(0, Math.min(1, (c - lo) / (hi - lo)))
}

/**
 * Ideal surface-temp window (°C).
 *
 * Per F1 25 / Pirelli model: dry compounds all share a ~85-105°C window
 * (confirmed by ChatGPT research + simracingsetup.com). The window does NOT
 * change per soft/medium/hard colour — it's the same for all dry tyres.
 * Intermediates and wets have their own lower windows.
 */
export const TYRE_TEMP_WINDOW: Record<string, [number, number]> = {
  soft: [85, 105],
  medium: [85, 105],
  hard: [85, 105],
  inter: [60, 85],
  wet: [60, 80],
  unknown: [85, 105]
}

export function tyreTempWindow(compound: string | undefined): [number, number] {
  return TYRE_TEMP_WINDOW[compound ?? 'unknown'] ?? [85, 100]
}

/** Classification of current tyre temp vs the compound's ideal window. */
export function tempStatus(
  c: number | null | undefined,
  compound: string | undefined
): { status: 'cold' | 'ideal' | 'hot'; color: string } {
  if (c == null || !isFinite(c)) return { status: 'ideal', color: '#2DD4BF' }
  const [lo, hi] = tyreTempWindow(compound)
  if (c < lo) return { status: 'cold', color: '#3B82F6' }
  if (c > hi) return { status: 'hot', color: '#FF3B3B' }
  return { status: 'ideal', color: compound === 'inter' ? '#22C55E' : '#2DD4BF' }
}
