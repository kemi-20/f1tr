import { describe, it, expect } from 'vitest'
import { fmtLapTime, fmtGap, fmtPct, compoundLabel, tempScale } from '../src/shared/util/format'

describe('format helpers', () => {
  it('formats lap times', () => {
    expect(fmtLapTime(94812)).toBe('1:34.812')
    expect(fmtLapTime(null)).toBe('--')
    expect(fmtLapTime(0)).toBe('--')
  })

  it('formats gaps', () => {
    expect(fmtGap(1.234)).toBe('+1.234')
    expect(fmtGap(-0.5)).toBe('-0.500')
    expect(fmtGap(null)).toBe('--')
    expect(fmtGap(95)).toMatch(/\d+:\d/)
  })

  it('formats percentages', () => {
    expect(fmtPct(0.5)).toBe('50%')
    expect(fmtPct(null)).toBe('--')
  })

  it('labels compounds', () => {
    expect(compoundLabel('soft')).toBe('S')
    expect(compoundLabel('medium')).toBe('M')
    expect(compoundLabel('unknown')).toBe('?')
  })

  it('maps temperature to a heat scale', () => {
    expect(tempScale(70)).toBe(0)
    expect(tempScale(120)).toBe(1)
    expect(tempScale(95)).toBeGreaterThan(0.4)
    expect(tempScale(95)).toBeLessThan(0.6)
    expect(tempScale(null)).toBe(0.5)
  })
})
