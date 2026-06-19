import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TriggerEngine } from '../src/main/triggers/TriggerEngine'
import { DEFAULT_CONFIG } from '@shared/index'
import type { TriggerConfig, TriggerFiring } from '@shared/index'
import type { RaceState } from '@shared/types/state'
import { emptyRaceState } from '../src/main/state/defaults'

let now = 1_000_000
function setStateWear(state: RaceState, wear: number): RaceState {
  state.player.tyres.wear = { rl: wear, rr: wear, fl: wear, fr: wear }
  return state
}
function setBehind(state: RaceState, gap: number): RaceState {
  state.player.position = 5
  state.rivals[6] = {
    carIndex: 6, name: 'RIVAL', team: '1', raceNumber: 7, carClass: 0,
    position: 6, gridPosition: 6, lap: 5, lapDistancePct: 0.5,
    bestLapTimeS: 90, lastLapTimeS: 90, currentLapTimeS: 40,
    deltaToCarInFrontS: gap, deltaToCarBehindS: null, gapToPlayerS: -gap,
    pitStopCount: 0, pitStatus: 0, penaltiesS: 0, tyreCompound: 'soft',
    resultStatus: 2, status: 'running', relationToPlayer: 'behind'
  }
  return state
}

function makeEngine(cfg?: Partial<TriggerConfig>): { engine: TriggerEngine; firings: TriggerFiring[] } {
  const firings: TriggerFiring[] = []
  const config: TriggerConfig = { ...DEFAULT_CONFIG.triggers, globalMinGapS: 0, heartbeatIntervalS: 9999, ...cfg }
  const engine = new TriggerEngine(config, (f) => firings.push(f))
  return { engine, firings }
}

describe('TriggerEngine — tyre wear', () => {
  beforeEach(() => {
    now = 1_000_000
    vi.useFakeTimers()
    vi.setSystemTime(now)
  })
  afterEach(() => vi.useRealTimers())

  it('fires once when wear crosses a threshold upward', () => {
    const { engine, firings } = makeEngine()
    const state = emptyRaceState()
    state.player.lap = 5
    setStateWear(state, 30)
    engine.evaluate(state) // below 50 -> nothing
    expect(firings).toHaveLength(0)

    setStateWear(state, 55)
    engine.evaluate(state) // crosses 50
    expect(firings).toHaveLength(1)
    expect(firings[0].reasonCode).toBe('tyre_wear_50')

    setStateWear(state, 60)
    engine.evaluate(state) // still in same band -> no re-fire (hysteresis)
    expect(firings).toHaveLength(1)
  })

  it('escalates through multiple levels', () => {
    const { engine, firings } = makeEngine({ globalMinGapS: 0, perRuleCooldownS: {} })
    const state = emptyRaceState()
    state.player.lap = 5
    setStateWear(state, 52)
    engine.evaluate(state) // 50
    setStateWear(state, 72)
    engine.evaluate(state) // 70
    setStateWear(state, 92)
    engine.evaluate(state) // 90
    expect(firings.map((f) => f.reasonCode)).toEqual(['tyre_wear_50', 'tyre_wear_70', 'tyre_wear_90'])
    expect(firings[2].priority).toBe('high')
  })

  it('re-fires after fresh tyres drop wear below 20', () => {
    const { engine, firings } = makeEngine()
    const state = emptyRaceState()
    state.player.lap = 5
    setStateWear(state, 55)
    engine.evaluate(state) // fire 50
    vi.advanceTimersByTime(60_000)
    setStateWear(state, 8) // pit stop, fresh tyres
    engine.evaluate(state)
    vi.advanceTimersByTime(60_000)
    setStateWear(state, 52)
    engine.evaluate(state) // should re-fire 50
    expect(firings.filter((f) => f.reasonCode === 'tyre_wear_50')).toHaveLength(2)
  })
})

describe('TriggerEngine — defend / attack', () => {
  beforeEach(() => {
    now = 1_000_000
    vi.useFakeTimers()
    vi.setSystemTime(now)
  })
  afterEach(() => vi.useRealTimers())

  it('fires defend_warning when car behind closes within gap', () => {
    const { engine, firings } = makeEngine()
    const state = emptyRaceState()
    state.player.lap = 5
    setBehind(state, 1.5)
    engine.evaluate(state)
    setBehind(state, 0.5) // within 0.8s
    engine.evaluate(state)
    expect(firings.some((f) => f.reasonCode === 'defend_warning')).toBe(true)
    expect(firings[0].priority).toBe('high')
  })

  it('does not re-fire defend while still close (hysteresis)', () => {
    const { engine, firings } = makeEngine()
    const state = emptyRaceState()
    state.player.lap = 5
    setBehind(state, 0.4)
    engine.evaluate(state)
    engine.evaluate(state)
    engine.evaluate(state)
    expect(firings.filter((f) => f.reasonCode === 'defend_warning')).toHaveLength(1)
  })
})

describe('TriggerEngine — cooldown & suppression', () => {
  beforeEach(() => {
    now = 1_000_000
    vi.useFakeTimers()
    vi.setSystemTime(now)
  })
  afterEach(() => vi.useRealTimers())

  it('suppresses non-critical triggers on lap 1', () => {
    const { engine, firings } = makeEngine({ suppressFirstLap: true })
    const state = emptyRaceState()
    state.player.lap = 1 // first lap
    setStateWear(state, 95)
    engine.evaluate(state)
    expect(firings).toHaveLength(0)
  })

  it('allows critical triggers on lap 1', () => {
    const { engine, firings } = makeEngine({ suppressFirstLap: true })
    const state = emptyRaceState()
    state.player.lap = 1
    engine.onEvent(state, { type: 'safetyCar', text: 'SC deployed' })
    expect(firings).toHaveLength(1)
    expect(firings[0].priority).toBe('critical')
  })

  it('enforces the global min gap between any two firings', () => {
    const { engine, firings } = makeEngine({ globalMinGapS: 10, heartbeatIntervalS: 0 })
    const state = emptyRaceState()
    state.player.lap = 5
    // two heartbeats back-to-back
    engine.evaluate(state)
    engine.evaluate(state)
    expect(firings).toHaveLength(1) // second blocked by global gap
    vi.advanceTimersByTime(11_000)
    engine.evaluate(state)
    expect(firings).toHaveLength(2)
  })
})

describe('TriggerEngine — events', () => {
  it('fires on safety car / fastest lap events', () => {
    const { engine, firings } = makeEngine()
    const state = emptyRaceState()
    state.player.lap = 5
    engine.onEvent(state, { type: 'safetyCar', text: 'SC deployed', carIndex: undefined })
    engine.onEvent(state, { type: 'fastestLap', text: 'Fastest lap', carIndex: 0 })
    expect(firings.map((f) => f.reasonCode)).toContain('sc_active')
    expect(firings.map((f) => f.reasonCode)).toContain('fastest_lap')
  })

  it('only fires penalty for the player', () => {
    const { engine, firings } = makeEngine()
    const state = emptyRaceState()
    state.player.carIndex = 0
    state.player.lap = 5
    engine.onEvent(state, { type: 'penalty', text: '5s', carIndex: 1 }) // someone else
    engine.onEvent(state, { type: 'penalty', text: '5s', carIndex: 0 }) // player
    expect(firings.filter((f) => f.reasonCode === 'penalty')).toHaveLength(1)
  })
})

describe('TriggerEngine — heartbeat', () => {
  beforeEach(() => {
    now = 1_000_000
    vi.useFakeTimers()
    vi.setSystemTime(now)
  })
  afterEach(() => vi.useRealTimers())

  it('fires a heartbeat after the interval', () => {
    const { engine, firings } = makeEngine({ heartbeatIntervalS: 30, globalMinGapS: 0 })
    const state = emptyRaceState()
    state.player.lap = 3
    engine.evaluate(state)
    expect(firings.some((f) => f.reasonCode === 'heartbeat')).toBe(true)
  })

  it('does not heartbeat on lap 1', () => {
    const { engine, firings } = makeEngine({ heartbeatIntervalS: 0, globalMinGapS: 0 })
    const state = emptyRaceState()
    state.player.lap = 1
    engine.evaluate(state)
    expect(firings.some((f) => f.reasonCode === 'heartbeat')).toBe(false)
  })
})
