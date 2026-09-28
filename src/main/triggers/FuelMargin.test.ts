import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '@shared/index'
import type { TriggerConfig, TriggerFiring } from '@shared/index'
import { emptyRaceState } from '../state/defaults'
import { TriggerEngine } from './TriggerEngine'

function evaluateFuelMargin(configure: (state: ReturnType<typeof emptyRaceState>) => void): TriggerFiring[] {
  const firings: TriggerFiring[] = []
  const config: TriggerConfig = {
    ...DEFAULT_CONFIG.triggers,
    lowFuelKg: 5,
    globalMinGapS: 0,
    heartbeatIntervalS: 60_000
  }
  const engine = new TriggerEngine(config, firing => firings.push(firing))
  const state = emptyRaceState()
  state.session.sessionUID = 'fuel-margin-test'
  state.session.totalLaps = 5
  state.player.lap = 2
  state.player.lapDistancePct = 0.25
  configure(state)
  engine.evaluate(state)
  return firings.filter(firing => firing.reasonCode === 'low_fuel')
}

describe('TriggerEngine fuel margin', () => {
  it('does not subtract remaining race distance from a positive race surplus', () => {
    const firings = evaluateFuelMargin(state => {
      state.session.sessionType = 13
      state.session.sessionTypeLabel = 'Race'
      state.player.fuelRemainingKg = 1
      state.player.fuelRemainingLaps = 2
    })

    expect(firings).toHaveLength(0)
  })

  it('warns for a signed race deficit even when fuel mass exceeds the generic threshold', () => {
    const firings = evaluateFuelMargin(state => {
      state.session.sessionType = 15
      state.player.fuelRemainingKg = 8
      state.player.fuelRemainingLaps = -0.5
    })

    expect(firings).toHaveLength(1)
    expect(firings[0].reason).toContain('0.50 laps')
  })

  it('does not interpret practice fuelRemainingLaps as race margin', () => {
    const firings = evaluateFuelMargin(state => {
      state.session.sessionType = 5
      state.session.sessionTypeLabel = 'Practice'
      state.player.fuelRemainingKg = 8
      state.player.fuelRemainingLaps = -20
    })

    expect(firings).toHaveLength(0)
  })
})
