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

/** F1-overlay style tyre wear colour: calm when fresh, alarming as wear climbs. */
export function tyreWearColor(wear: number | null | undefined): string {
  if (wear == null || !isFinite(wear)) return 'rgba(255, 255, 255, 0.34)'
  const pct = Math.max(0, Math.min(100, wear))
  if (pct >= 90) return '#B000F7'
  if (pct >= 75) return '#E10600'
  if (pct >= 55) return '#FF7A00'
  if (pct >= 35) return '#F7D210'
  return '#49D66A'
}
