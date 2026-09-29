import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG } from '@shared/index'
import type { TriggerConfig, TriggerFiring } from '@shared/index'
import type { RaceState } from '@shared/types/state'
import { holdQualifyingRadio, qualifyingYieldStillRelevant } from '@shared/util/lapPhase'
import { emptyRaceState } from '../state/defaults'
import { TriggerEngine } from './TriggerEngine'

const START_TIME = 1_000_000
type Rival = RaceState['rivals'][number]
type YieldInvalidation = (state: RaceState, firing: TriggerFiring) => void

const yieldInvalidations: Array<[string, YieldInvalidation]> = [
  ['the rival has passed', (state) => { state.rivals[1].distanceFromStartM = 150 }],
  ['the rival entered the pits', (state) => { state.rivals[1].pitStatus = 1 }],
  ['the rival telemetry is stale', (state) => { state.rivals[1].lapDataUpdatedAt = START_TIME - 2_501 }],
  ['the player telemetry is stale', (state) => { state.player.lapDataUpdatedAt = START_TIME - 2_501 }],
  ['the warning is older than twelve seconds', (_state, firing) => { firing.ts -= 12_001 }],
  ['the player starts a push lap', (state) => { state.player.lapPhase = 'flying' }]
]

const invalidRivals: Array<[string, Partial<Rival>]> = [
  ['invalid flying lap', { currentLapInvalid: true }],
  ['pit lane', { pitStatus: 1 }],
  ['stale rival telemetry', { lapDataUpdatedAt: START_TIME - 2_501 }],
  ['ahead on track', { lapDistancePct: 0.05 }]
]

function makeEngine(): { engine: TriggerEngine; firings: TriggerFiring[] } {
  const firings: TriggerFiring[] = []
  const config: TriggerConfig = {
    ...DEFAULT_CONFIG.triggers,
    globalMinGapS: 0,
    heartbeatIntervalS: 9999,
    perRuleCooldownS: {}
  }
  return { engine: new TriggerEngine(config, (firing) => firings.push(firing)), firings }
}

function qualifyingState(phase: 'out' | 'in' | 'cooling' | 'flying' | 'unknown' = 'out'): RaceState {
  const state = emptyRaceState()
  state.session.sessionType = 5
  state.session.sessionTypeLabel = 'Short Qualifying'
  state.session.sessionUID = 'qualifying-session'
  state.session.trackLengthM = 5000
  state.player.carIndex = 0
  state.player.lap = 3
  state.player.lapDistancePct = 0.02
  state.player.distanceFromStartM = 100
  state.player.lapPhase = phase
  state.player.lapDataUpdatedAt = Date.now()
  state.player.onTrack = true
  state.player.pitStatus = 0
  state.player.tyres.innerTempC = { rl: 90, rr: 90, fl: 90, fr: 90 }
  return state
}

function addRival(state: RaceState, overrides: Partial<Rival> = {}): void {
  state.rivals[1] = {
    carIndex: 1,
    name: 'A. Rival',
    team: 'Team',
    raceNumber: 2,
    distanceFromStartM: null,
    totalDistanceM: null,
    separationFromPlayerM: null,
    trackRelativeSeparationM: null,
    carClass: 0,
    position: 2,
    gridPosition: 2,
    lap: 3,
    lapDistancePct: 0.96,
    bestLapTimeS: null,
    lastLapTimeS: null,
    currentLapTimeS: 20,
    deltaToCarInFrontS: null,
    deltaToCarBehindS: null,
    gapToPlayerS: null,
    pitStopCount: 0,
    pitStatus: 0,
    penaltiesS: 0,
    tyreCompound: 'soft',
    tyreWearAvg: null,
    resultStatus: 0,
    status: 'running',
    relationToPlayer: 'behind',
    lapPhase: 'flying',
    currentLapInvalid: false,
    lapDataUpdatedAt: Date.now(),
    ...overrides
  }
  state.rivals[1].distanceFromStartM = state.rivals[1].lapDistancePct * state.session.trackLengthM
}

function refreshTelemetry(state: RaceState, rivalDistance = state.rivals[1]?.lapDistancePct): void {
  const now = Date.now()
  state.player.lapDataUpdatedAt = now
  state.player.distanceFromStartM = state.player.lapDistancePct * state.session.trackLengthM
  if (state.rivals[1]) {
    state.rivals[1].lapDataUpdatedAt = now
    if (rivalDistance != null) state.rivals[1].lapDistancePct = rivalDistance
    state.rivals[1].distanceFromStartM = state.rivals[1].lapDistancePct * state.session.trackLengthM
  }
}

function expectWarnings(firings: TriggerFiring[]): TriggerFiring[] {
  return firings.filter((firing) => firing.reasonCode === 'qualifying_yield')
}

describe('qualifying radio gate', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(START_TIME)
  })
  afterEach(() => vi.useRealTimers())

  it.each(['flying', 'unknown'] as const)('holds noncritical calls during a %s phase', (phase) => {
    const state = qualifyingState(phase)
    const firing: TriggerFiring = {
      ruleId: 'test', kind: 'threshold', priority: 'normal',
      reasonCode: 'test', reason: 'test', ts: Date.now()
    }

    expect(holdQualifyingRadio(state, firing)).toBe(true)
  })

  it.each(['out', 'cooling', 'in'] as const)('allows noncritical calls during the qualifying %s phase', (phase) => {
    const state = qualifyingState(phase)
    const firing: TriggerFiring = {
      ruleId: 'test', kind: 'threshold', priority: 'normal',
      reasonCode: 'test', reason: 'test', ts: Date.now()
    }

    expect(holdQualifyingRadio(state, firing)).toBe(false)
  })

  it('allows manual and critical calls despite an unknown phase', () => {
    const state = qualifyingState('unknown')
    const noncritical: TriggerFiring = {
      ruleId: 'test', kind: 'threshold', priority: 'normal',
      reasonCode: 'test', reason: 'test', ts: Date.now()
    }

    expect(holdQualifyingRadio(state, noncritical)).toBe(true)
    expect(holdQualifyingRadio(state, { ...noncritical, reasonCode: 'manual', kind: 'manual' })).toBe(false)
    expect(holdQualifyingRadio(state, { ...noncritical, priority: 'critical' })).toBe(false)
  })
})

describe('qualifying yield playback recheck', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(START_TIME)
  })
  afterEach(() => vi.useRealTimers())

  it('keeps a fresh warning relevant while the rival remains behind and approaching', () => {
    const state = qualifyingState('out')
    addRival(state)
    const firing: TriggerFiring = {
      ruleId: 'qualifying_yield_1', kind: 'threshold', priority: 'critical',
      reasonCode: 'qualifying_yield', reason: 'approaching rival', ts: Date.now()
    }

    expect(qualifyingYieldStillRelevant(state, firing)).toBe(true)
  })

  it.each(yieldInvalidations)('rejects playback when %s', (_description, change) => {
    const state = qualifyingState('cooling')
    addRival(state)
    const firing: TriggerFiring = {
      ruleId: 'qualifying_yield_1', kind: 'threshold', priority: 'critical',
      reasonCode: 'qualifying_yield', reason: 'approaching rival', ts: Date.now()
    }

    change(state, firing)
    expect(qualifyingYieldStillRelevant(state, firing)).toBe(false)
  })
})

describe('qualifying traffic warnings', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(START_TIME)
  })
  afterEach(() => vi.useRealTimers())

  it.each(['out', 'in', 'cooling'] as const)(
    "warns about a valid flying rival approaching from behind across the start/finish in the player's %s phase",
    (phase) => {
      const { engine, firings } = makeEngine()
      const state = qualifyingState(phase)
      addRival(state, { lapDistancePct: 0.96 })

      engine.evaluate(state) // 300m behind; establish the approach sample
      vi.advanceTimersByTime(1_000)
      refreshTelemetry(state, 0.97) // 250m behind; closing at 50m/s
      engine.evaluate(state)

      const warnings = expectWarnings(firings)
      expect(warnings).toHaveLength(1)
      expect(warnings[0].priority).toBe('critical')
      expect(warnings[0].reason).toContain('valid flying lap behind on track')
      expect(warnings[0].reason).toContain(`Player is ${phase}`)
    }
  )

  it.each(invalidRivals)('does not warn for a rival that is %s', (label, rivalOverrides) => {
    const { engine, firings } = makeEngine()
    const state = qualifyingState('out')
    addRival(state, rivalOverrides)

    engine.evaluate(state)
    vi.advanceTimersByTime(1_000)
    state.player.lapDataUpdatedAt = Date.now()
    if (label !== 'stale rival telemetry') {
      state.rivals[1].lapDataUpdatedAt = Date.now()
    }
    engine.evaluate(state)

    expect(expectWarnings(firings)).toHaveLength(0)
  })

  it('does not warn from stale player telemetry and requires a fresh approach after recovery', () => {
    const { engine, firings } = makeEngine()
    const state = qualifyingState('cooling')
    addRival(state)

    engine.evaluate(state)
    vi.advanceTimersByTime(1_000)
    refreshTelemetry(state, 0.97)
    state.player.lapDataUpdatedAt = Date.now() - 2_501
    engine.evaluate(state) // stale player sample clears approach history
    expect(expectWarnings(firings)).toHaveLength(0)

    vi.advanceTimersByTime(1_000)
    refreshTelemetry(state, 0.94)
    engine.evaluate(state) // fresh data only seeds a new baseline
    expect(expectWarnings(firings)).toHaveLength(0)

    vi.advanceTimersByTime(1_000)
    refreshTelemetry(state, 0.95)
    engine.evaluate(state)
    expect(expectWarnings(firings)).toHaveLength(1)
  })

  it('does not run the qualifying traffic rule during a race session', () => {
    const { engine, firings } = makeEngine()
    const state = qualifyingState('out')
    state.session.sessionType = 15
    state.session.sessionTypeLabel = 'Race'
    addRival(state)

    engine.evaluate(state)
    vi.advanceTimersByTime(1_000)
    refreshTelemetry(state, 0.97)
    engine.evaluate(state)

    expect(expectWarnings(firings)).toHaveLength(0)
  })
})
