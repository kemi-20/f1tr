export interface DistanceSample { ts: number; distance: number }

/** Shared conservative closing estimate for trigger admission and live position tools. */
export function estimateClosing(samples: readonly DistanceSample[]) {
  const unknown = { closingMps: null, catchEstimateS: null } as const
  if (samples.length < 3) return unknown
  const rates: number[] = []
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i]
    const dt = (b.ts - a.ts) / 1000
    if (!Number.isFinite(a.distance) || !Number.isFinite(b.distance) || !Number.isFinite(dt) ||
        dt < 0.1 || dt > 2 || Math.sign(a.distance) !== Math.sign(b.distance)) return unknown
    const rate = (Math.abs(a.distance) - Math.abs(b.distance)) / dt
    if (Math.abs(rate) > 120) return unknown
    rates.push(rate)
  }
  const first = samples[0], last = samples[samples.length - 1]
  const dt = (last.ts - first.ts) / 1000
  if (dt < 1) return unknown
  const closing = (Math.abs(first.distance) - Math.abs(last.distance)) / dt
  const stable = rates.every(rate => rate > 1) && Math.max(...rates) - Math.min(...rates) <= 20
  const eta = stable && closing > 1 ? Math.abs(last.distance) / closing : null
  return { closingMps: Math.round(closing * 10) / 10,
    catchEstimateS: eta != null && eta <= 30 ? Math.round(eta * 10) / 10 : null }
}
