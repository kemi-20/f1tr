import { describe, expect, it } from 'vitest'
import { CALIBRATED_TRACK_MAPS } from './trackMapAssets'

/** The renderer map is a few hundred CSS pixels wide; keep the bundled JSON slim. */
const MAX_POINTS_PER_LINE = 800
const MAX_TOTAL_FUSED_POINTS = 8_000

describe('bundled track map assets', () => {
  it('ships simplified lines with finite coordinates inside their bounds', () => {
    const entries = Object.entries(CALIBRATED_TRACK_MAPS)
    expect(entries.length).toBeGreaterThan(0)
    let fusedTotal = 0
    for (const [key, map] of entries) {
      expect(map.id).toBe(Number(key))
      expect(typeof map.trackId).toBe('string')
      expect(map.trackId.length).toBeGreaterThan(0)
      expect(map.fusedLine.length).toBeGreaterThanOrEqual(2)
      expect(map.fusedLine.length).toBeLessThanOrEqual(MAX_POINTS_PER_LINE)
      fusedTotal += map.fusedLine.length
      for (const key of ['pitLine', 'sector1Line', 'sector2Line', 'sector3Line'] as const) {
        const line = map[key]
        if (!line) continue
        expect(line.length).toBeLessThanOrEqual(MAX_POINTS_PER_LINE)
        for (const [x, y] of line) expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true)
      }
      const [minX, minY, maxX, maxY] = map.bounds
      const padX = (maxX - minX) * 0.01
      const padY = (maxY - minY) * 0.01
      for (const [x, y] of map.fusedLine) {
        expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true)
        expect(x).toBeGreaterThanOrEqual(minX - padX)
        expect(x).toBeLessThanOrEqual(maxX + padX)
        expect(y).toBeGreaterThanOrEqual(minY - padY)
        expect(y).toBeLessThanOrEqual(maxY + padY)
      }
    }
    expect(fusedTotal).toBeLessThan(MAX_TOTAL_FUSED_POINTS)
  })
})
