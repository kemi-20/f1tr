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

/** Map tyre surface temp (C) to a 0..1 heat scale for color. */
export function tempScale(c: number | null | undefined): number {
  if (c == null || !isFinite(c)) return 0.5
  // ideal window ~85-100C; cold<80, hot>110
  const lo = 70
  const hi = 120
  return Math.max(0, Math.min(1, (c - lo) / (hi - lo)))
}
