import { describe, it, expect } from 'vitest'
import { mapCompound, decodeSafetyCar, sessionTypeLabel } from '../src/main/state/mappings'

describe('mappings', () => {
  it('maps dry C-compounds using the current race allocation', () => {
    // Australia: C3/C4/C5 = hard/medium/soft.
    expect(mapCompound(18, 0)).toBe('hard')
    expect(mapCompound(17, 0)).toBe('medium')
    expect(mapCompound(16, 0)).toBe('soft')

    // Bahrain/Japan/Qatar: C1/C2/C3 = hard/medium/soft.
    expect(mapCompound(20, 3)).toBe('hard')
    expect(mapCompound(19, 3)).toBe('medium')
    expect(mapCompound(18, 3)).toBe('soft')

    // Monaco/Imola/Canada/Baku: C4/C5/C6 = hard/medium/soft.
    expect(mapCompound(17, 5)).toBe('hard')
    expect(mapCompound(16, 5)).toBe('medium')
    expect(mapCompound(22, 5)).toBe('soft')

    // Mexico skips C3: C2/C4/C5 = hard/medium/soft.
    expect(mapCompound(19, 19)).toBe('hard')
    expect(mapCompound(17, 19)).toBe('medium')
    expect(mapCompound(16, 19)).toBe('soft')
  })

  it('maps wet and fallback compound ids', () => {
    expect(mapCompound(7)).toBe('inter')
    expect(mapCompound(8)).toBe('wet')
    expect(mapCompound(18)).toBe('medium')
    expect(mapCompound(999)).toBe('unknown')
  })

  it('decodes safety car status', () => {
    expect(decodeSafetyCar(0)).toEqual({ sc: false, vsc: false, red: false })
    expect(decodeSafetyCar(1)).toEqual({ sc: true, vsc: false, red: false })
    expect(decodeSafetyCar(2)).toEqual({ sc: false, vsc: true, red: false })
  })

  it('labels session types', () => {
    expect(sessionTypeLabel(13)).toBe('Race')
    expect(sessionTypeLabel(1)).toBe('P1')
    expect(sessionTypeLabel(99)).toMatch(/Session/)
  })
})
