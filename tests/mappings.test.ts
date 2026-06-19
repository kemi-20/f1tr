import { describe, it, expect } from 'vitest'
import { mapCompound, decodeSafetyCar, sessionTypeLabel } from '../src/main/state/mappings'

describe('mappings', () => {
  it('maps tyre compound ids to labels', () => {
    expect(mapCompound(16)).toBe('soft')
    expect(mapCompound(17)).toBe('medium')
    expect(mapCompound(18)).toBe('hard')
    expect(mapCompound(7)).toBe('inter')
    expect(mapCompound(8)).toBe('wet')
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
