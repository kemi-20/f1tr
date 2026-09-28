import { describe, expect, it } from 'vitest'
import { teamColorForCar, teamColorForCarOrNull } from './teamMeta'

describe('team color fallback', () => {
  it('uses the theme fallback when no usable team telemetry exists', () => {
    expect(teamColorForCarOrNull('', '')).toBeNull()
    expect(teamColorForCar('999', '')).toBe('#E6EDF6')
  })

  it('uses a valid telemetry color for an unmapped team', () => {
    expect(teamColorForCarOrNull('999', '#123abc')).toBe('#123abc')
  })

  it('prefers a known team mapping', () => {
    expect(teamColorForCarOrNull('8', '')).toBe('#FF8000')
  })
})
