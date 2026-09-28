import { describe, expect, it } from 'vitest'
import { LapPhaseTracker } from './LapPhaseTracker'

type Observation = Parameters<LapPhaseTracker['observe']>[0]
type PhaseResult = ReturnType<LapPhaseTracker['observe']>
type LapPhase = PhaseResult['phase']

function observation(overrides: Partial<Observation> = {}): Observation {
  return {
    car: 1,
    lap: 1,
    distance: 0,
    time: 0,
    status: 1,
    pit: 0,
    invalid: false,
    lastLap: null,
    neutralised: false,
    ...overrides
  }
}

function learnReferenceLap(tracker: LapPhaseTracker, car = 1, context?: string): void {
  for (let i = 0; i <= 20; i++) {
    tracker.observe(observation({ car, context, distance: i / 20, time: i * 4.5 }))
  }
  tracker.observe(observation({ car, context, lap: 2, distance: 0, time: 0, lastLap: 90 }))
}

describe('LapPhaseTracker', () => {
  it.each([
    { label: 'garage', status: 0, pit: 0, expected: 'garage' },
    { label: 'out lap', status: 3, pit: 0, expected: 'out' },
    { label: 'flying lap', status: 1, pit: 0, expected: 'flying' },
    { label: 'in lap', status: 2, pit: 0, expected: 'in' },
    { label: 'pit lane', status: 1, pit: 1, expected: 'in' },
    { label: 'unrecognized status', status: 4, pit: 0, expected: 'unknown' },
    { label: 'missing status', status: undefined, pit: 0, expected: 'unknown' }
  ])('maps $label telemetry without a learned profile', ({ status, pit, expected }) => {
    const tracker = new LapPhaseTracker()

    expect(tracker.observe(observation({ status, pit })).phase).toBe(expected)
  })

  it('infers cooling only after sustained loss against a clean learned lap', () => {
    const tracker = new LapPhaseTracker()
    learnReferenceLap(tracker)

    const early = tracker.observe(observation({ car: 1, lap: 2, distance: 0.01, time: 2 }))
    expect(early.phase).toBe('flying')

    const results: PhaseResult[] = []
    for (let i = 2; i <= 6; i++) {
      results.push(tracker.observe(observation({
        car: 1,
        lap: 2,
        distance: i * 0.01,
        time: i * 2
      })))
    }

    expect(results.slice(0, 2).every((result) => result.phase === 'flying')).toBe(true)
    expect(results.at(-1)?.phase).toBe('cooling')
    expect(results.at(-1)?.evidence).toContain('same sections of an observed valid flying lap')
  })

  it('discards a dry reference when weather and compound context changes', () => {
    const tracker = new LapPhaseTracker()
    learnReferenceLap(tracker, 1, 'dry:soft')

    const results: PhaseResult[] = [tracker.observe(observation({
      car: 1,
      lap: 2,
      distance: 0.01,
      time: 2,
      context: 'wet:soft'
    }))]
    for (let i = 2; i <= 6; i++) {
      results.push(tracker.observe(observation({
        car: 1,
        lap: 2,
        distance: i * 0.01,
        time: i * 2,
        context: 'wet:soft'
      })))
    }

    expect(results.every((result) => result.phase === 'flying')).toBe(true)
  })

  it('does not turn a single corner slowdown into cooling', () => {
    const tracker = new LapPhaseTracker()
    learnReferenceLap(tracker)

    const phases: LapPhase[] = []
    let time = 0
    for (let i = 1; i <= 60; i++) {
      time += 0.9 + (i === 30 ? 3 : 0)
      phases.push(tracker.observe(observation({
        car: 1,
        lap: 2,
        distance: i * 0.01,
        time
      })).phase)
    }

    expect(phases).not.toContain('cooling')
    expect(phases.at(-1)).toBe('flying')
  })

  it('does not infer cooling from invalid telemetry or learn an invalid lap as its reference', () => {
    const tracker = new LapPhaseTracker()
    for (let i = 0; i <= 20; i++) {
      tracker.observe(observation({
        distance: i / 20,
        time: i * 4.5,
        invalid: i === 10
      }))
    }

    const invalidLap = tracker.observe(observation({
      lap: 2,
      distance: 0,
      time: 0,
      lastLap: 90,
      invalid: true
    }))
    expect(invalidLap.phase).toBe('flying')

    const phases: LapPhase[] = []
    for (let i = 1; i <= 10; i++) {
      phases.push(tracker.observe(observation({
        lap: 2,
        distance: i * 0.01,
        time: i * 2,
        invalid: true
      })).phase)
    }
    expect(phases).not.toContain('cooling')
  })

  it('clears learned and inferred state after a lap-time rollback', () => {
    const tracker = new LapPhaseTracker()
    learnReferenceLap(tracker)
    for (let i = 1; i <= 6; i++) {
      tracker.observe(observation({ car: 1, lap: 2, distance: i * 0.01, time: i * 2 }))
    }

    expect(tracker.observe(observation({ car: 1, lap: 2, distance: 0.5, time: 0 })).phase).toBe('flying')

    const afterRollback: LapPhase[] = []
    for (let i = 1; i <= 10; i++) {
      afterRollback.push(tracker.observe(observation({
        car: 1,
        lap: 2,
        distance: 0.5 + i * 0.01,
        time: i * 2
      })).phase)
    }
    expect(afterRollback).not.toContain('cooling')
  })

  it('isolates learned profiles by car and can reset all profile history', () => {
    const tracker = new LapPhaseTracker()
    learnReferenceLap(tracker, 1)

    const otherCar: LapPhase[] = []
    for (let i = 1; i <= 8; i++) {
      otherCar.push(tracker.observe(observation({
        car: 2,
        lap: 1,
        distance: i * 0.01,
        time: i * 2
      })).phase)
    }
    expect(otherCar).not.toContain('cooling')

    tracker.reset()
    expect(tracker.observe(observation({ car: 1, lap: 2, distance: 0.5, time: 20 })).phase).toBe('flying')
  })
})
