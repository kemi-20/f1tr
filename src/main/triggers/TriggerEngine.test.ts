import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TriggerEngine } from './TriggerEngine'
import { DEFAULT_CONFIG } from '@shared/index'
import type { TriggerConfig, TriggerFiring } from '@shared/index'
import type { RaceState } from '@shared/types/state'
import { emptyRaceState } from '../state/defaults'

function makeEngine(cfg?: Partial<TriggerConfig>): { engine: TriggerEngine; firings: TriggerFiring[] } {
  const firings: TriggerFiring[] = []
  const config: TriggerConfig = {
    ...DEFAULT_CONFIG.triggers,
    globalMinGapS: 0,
    heartbeatIntervalS: 9999,
    perRuleCooldownS: {},
    ...cfg
  }
  const engine = new TriggerEngine(config, (f) => firings.push(f))
  return { engine, firings }
}

function setWear(state: RaceState, wear: number): void {
  state.player.tyres.wear = { rl: wear, rr: wear, fl: wear, fr: wear }
}

describe('TriggerEngine — cooldown vs hysteresis', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
  })
  afterEach(() => vi.useRealTimers())

  it('re-fires a threshold that the global cooldown blocked instead of latching it', () => {
    // Regression: the active flag used to be set BEFORE the cooldown check, so an
    // over-temperature that arrived during the global gap was swallowed for the rest
    // of the stint (same bug class for cold tyres, fuel, rain and defend/attack).
    const { engine, firings } = makeEngine({ globalMinGapS: 20, tyreHotC: 115, tyreColdC: 75 })
    const state = emptyRaceState()
    state.player.lap = 5

    state.player.tyres.innerTempC = { rl: 70, rr: 80, fl: 80, fr: 80 }
    engine.evaluate(state)
    expect(firings.map((f) => f.reasonCode)).toContain('tyre_cold')

    // now hot, but the global gap is still held by the cold call
    state.player.tyres.innerTempC = { rl: 122, rr: 110, fl: 110, fr: 110 }
    engine.evaluate(state)
    expect(firings.map((f) => f.reasonCode)).not.toContain('tyre_hot')

    vi.advanceTimersByTime(21_000)
    engine.evaluate(state)
    expect(firings.map((f) => f.reasonCode)).toContain('tyre_hot')
  })

  it('re-fires low fuel that was blocked by the global cooldown', () => {
    const { engine, firings } = makeEngine({ globalMinGapS: 30, lowFuelKg: 5 })
    const state = emptyRaceState()
    state.player.lap = 5
    state.session.totalLaps = 0 // no projection → fall back to the kg threshold

    state.player.tyres.innerTempC = { rl: 70, rr: 80, fl: 80, fr: 80 }
    engine.evaluate(state) // arms the global gap with a cold-tyre call

    state.player.fuelRemainingKg = 3
    engine.evaluate(state)
    expect(firings.map((f) => f.reasonCode)).not.toContain('low_fuel')

    vi.advanceTimersByTime(31_000)
    engine.evaluate(state)
    expect(firings.map((f) => f.reasonCode)).toContain('low_fuel')
  })

  it('does not latch a threshold suppressed on the final lap', () => {
    const { engine, firings } = makeEngine({ suppressLastLapLowPriority: true })
    const state = emptyRaceState()
    state.session.sessionType = 15
    state.session.totalLaps = 10
    state.player.lap = 10
    state.player.tyres.innerTempC = { rl: 130, rr: 130, fl: 130, fr: 130 }
    engine.evaluate(state)
    expect(firings).toHaveLength(0)
  })
})

describe('TriggerEngine — tyre wear level tracking', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
  })
  afterEach(() => vi.useRealTimers())

  it('re-arms after a used set goes on (age resets while wear is still above 20%)', () => {
    const { engine, firings } = makeEngine()
    const state = emptyRaceState()
    state.player.lap = 5
    state.player.tyres.compound = 'medium'
    state.player.tyres.ageLaps = 12
    setWear(state, 55)
    engine.evaluate(state)
    expect(firings.filter((f) => f.reasonCode === 'tyre_wear_50')).toHaveLength(1)

    // pit stop: a scrubbed set goes on — age resets but wear is already 30%
    vi.advanceTimersByTime(120_000)
    state.player.tyres.ageLaps = 1
    setWear(state, 30)
    engine.evaluate(state)
    expect(firings.filter((f) => f.reasonCode === 'tyre_wear_50')).toHaveLength(1)

    state.player.tyres.ageLaps = 2
    setWear(state, 52)
    engine.evaluate(state)
    expect(firings.filter((f) => f.reasonCode === 'tyre_wear_50')).toHaveLength(2)
  })
})

describe('TriggerEngine — position changes', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
  })
  afterEach(() => vi.useRealTimers())

  it('measures the net change over a lap, not the last half second before the line', () => {
    const { engine, firings } = makeEngine({ positionChangeDelta: 2 })
    const state = emptyRaceState()
    state.session.sessionType = 15
    state.session.sessionTypeLabel = 'Race'
    state.player.lap = 5
    state.player.position = 5
    engine.evaluate(state) // baseline

    state.player.position = 4
    engine.evaluate(state) // mid-lap gain — must not be reported yet
    expect(positionFirings(firings)).toHaveLength(0)

    state.player.lap = 6
    engine.evaluate(state) // gained 1 over the lap — below the delta of 2
    expect(positionFirings(firings)).toHaveLength(0)

    state.player.position = 2
    state.player.lap = 7
    engine.evaluate(state) // gained 2 over the lap
    expect(firings.map((f) => f.reasonCode)).toContain('position_gain')
  })

  it('re-baselines after flashback without reporting a fictitious position loss', () => {
    const { engine, firings } = makeEngine({ positionChangeDelta: 2 })
    const state = emptyRaceState()
    state.session.sessionUID = 'race-session'
    state.session.sessionType = 15
    state.session.sessionTypeLabel = 'Race'
    state.player.lap = 12
    state.player.position = 5
    state.player.tyres.innerTempC = { rl: 90, rr: 90, fl: 90, fr: 90 }
    engine.evaluate(state)

    engine.noteFlashback()
    vi.advanceTimersByTime(3_001)
    state.player.position = 8
    engine.evaluate(state)

    expect(positionFirings(firings)).toHaveLength(0)
  })
})

/** Position rules only — lap_review/heartbeat fire independently of the lap delta. */
function positionFirings(firings: TriggerFiring[]): TriggerFiring[] {
  return firings.filter((f) => f.reasonCode === 'position_gain' || f.reasonCode === 'position_loss')
}

describe('TriggerEngine — heartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
  })
  afterEach(() => vi.useRealTimers())

  it('retries the check-in after a cooldown block instead of skipping the interval', () => {
    const { engine, firings } = makeEngine({ heartbeatIntervalS: 30, globalMinGapS: 40 })
    const state = emptyRaceState()
    state.player.lap = 5

    state.player.tyres.innerTempC = { rl: 70, rr: 80, fl: 80, fr: 80 }
    engine.evaluate(state) // cold-tyre call holds the global gap until t0+40s
    vi.advanceTimersByTime(31_000)
    engine.evaluate(state)
    expect(firings.filter((f) => f.reasonCode === 'heartbeat')).toHaveLength(0)

    // the check-in was deferred, not consumed: it goes out as soon as the gap opens
    vi.advanceTimersByTime(10_000)
    engine.evaluate(state)
    expect(firings.filter((f) => f.reasonCode === 'heartbeat')).toHaveLength(1)
  })
})
