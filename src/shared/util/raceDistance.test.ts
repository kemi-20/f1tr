import { describe, expect, it } from 'vitest'
import { emptyRaceState } from '../../main/state/defaults'
import { lapsToFlag, raceFuelMargin } from './raceDistance'

function raceState(totalLaps: number | null, lap: number, lapDistancePct = 0) {
  const state = emptyRaceState()
  state.session.totalLaps = totalLaps
  state.session.sessionType = 13
  state.session.sessionTypeLabel = 'Race'
  state.player.lap = lap
  state.player.lapDistancePct = lapDistancePct
  return state
}

describe('lapsToFlag', () => {
  it.each([
    { total: 5, lap: 1, pct: 0, expected: 5 },
    { total: 20, lap: 4, pct: 0.25, expected: 16.75 },
    { total: 57, lap: 57, pct: 0.5, expected: 0.5 },
    { total: 5, lap: 5, pct: 0.75, expected: 0.25 },
    { total: 5, lap: 6, pct: 0, expected: 0 }
  ])('uses this race distance: $total laps, lap $lap at $pct', ({ total, lap, pct, expected }) => {
    expect(lapsToFlag(raceState(total, lap, pct))).toBe(expected)
  })

  it.each([
    raceState(null, 1),
    raceState(0, 1),
    raceState(-1, 1),
    raceState(5.5, 1),
    raceState(256, 1),
    raceState(5, 0),
    raceState(5, -1),
    raceState(5, 1.5),
    raceState(5, 7),
    raceState(5, 1, -0.01),
    raceState(5, 1, 1.01),
    raceState(5, 1, Number.NaN),
    raceState(5, 1, Number.POSITIVE_INFINITY)
  ])('rejects invalid total, lap, or fractional progress', (state) => {
    expect(lapsToFlag(state)).toBeNull()
  })
})

describe('raceFuelMargin', () => {
  it.each([13, 14, 15])('accepts race session type %i as signed margin', (sessionType) => {
    const state = raceState(20, 5)
    state.session.sessionType = sessionType
    state.session.sessionTypeLabel = 'Unknown'
    state.player.fuelRemainingLaps = -1.25
    expect(raceFuelMargin(state)).toBe(-1.25)
  })

  it('accepts a Race label case-insensitively and preserves a positive surplus', () => {
    const state = raceState(20, 5)
    state.session.sessionType = 5
    state.session.sessionTypeLabel = 'rAcE'
    state.player.fuelRemainingLaps = 2
    expect(raceFuelMargin(state)).toBe(2)
  })

  it.each(['Practice', 'Qualifying', '', 'Race Weekend'])('does not infer race margin from label %j', (label) => {
    const state = raceState(20, 5)
    state.session.sessionType = 5
    state.session.sessionTypeLabel = label
    state.player.fuelRemainingLaps = -4
    expect(raceFuelMargin(state)).toBeNull()
  })

  it.each([null, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects unavailable or non-finite fuel margin %s',
    (margin) => {
      const state = raceState(20, 5)
      state.player.fuelRemainingLaps = margin
      expect(raceFuelMargin(state)).toBeNull()
    }
  )

  it('preserves a zero margin as a valid race reading', () => {
    const state = raceState(20, 5)
    state.player.fuelRemainingLaps = 0
    expect(raceFuelMargin(state)).toBe(0)
  })
})
