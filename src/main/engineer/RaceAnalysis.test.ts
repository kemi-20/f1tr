import { describe, expect, it } from 'vitest'
import { emptyRaceState } from '../state/defaults'
import { RaceAnalysis } from './RaceAnalysis'
import type { RaceState } from '@shared/types/state'

const baseWear = { rl: 10, rr: 20, fl: 30, fr: 40 }
const wearRate = { rl: 1, rr: 1.5, fl: 0.5, fr: 2 }

function sample(lap: number, totalLaps = 20, lapDistancePct = 0): RaceState {
  const state = emptyRaceState()
  state.lastPacketMs = 100_000
  state.session.sessionUID = 'race-one'
  state.session.overallFrameIdentifier = lap * 100
  state.session.sessionType = 13
  state.session.sessionTypeLabel = 'Race'
  state.session.totalLaps = totalLaps
  state.weather.weatherCode = 0
  state.player.lap = lap
  state.player.lapDistancePct = lapDistancePct
  state.player.lastLapTimeS = 90 + lap / 10
  state.player.fuelRemainingKg = 30 - lap * 1.2
  state.player.tyres.compound = 'medium'
  state.player.tyres.ageLaps = lap
  state.player.tyres.wear = {
    rl: baseWear.rl + (lap - 1) * wearRate.rl,
    rr: baseWear.rr + (lap - 1) * wearRate.rr,
    fl: baseWear.fl + (lap - 1) * wearRate.fl,
    fr: baseWear.fr + (lap - 1) * wearRate.fr
  }
  return state
}

function observeLaps(analysis: RaceAnalysis, throughLap: number, totalLaps: number): RaceState {
  let current = sample(1, totalLaps)
  analysis.observe(current, 100_000)
  for (let lap = 2; lap <= throughLap; lap++) {
    current = sample(lap, totalLaps, lap === throughLap ? 0.25 : 0)
    analysis.observe(current, 100_000)
  }
  return current
}

describe('RaceAnalysis strategy evidence', () => {
  it.each([5, 20, 57])('projects each tyre over the actual remaining laps in a %i-lap race', (totalLaps) => {
    const analysis = new RaceAnalysis()
    const current = observeLaps(analysis, 5, totalLaps)
    const remaining = totalLaps - current.player.lap + 1 - current.player.lapDistancePct
    const report = analysis.report(current, 100_000)

    expect(report).toContain(`${remaining.toFixed(2)} laps to flag`)
    expect(report).toContain('over 3 comparable laps; no-stop linear finish projection')
    for (const corner of ['rl', 'rr', 'fl', 'fr'] as const) {
      const wear = current.player.tyres.wear[corner]
      const projected = wear + wearRate[corner] * remaining
      expect(report).toContain(
        `${corner.toUpperCase()} wear: ${wear.toFixed(1)}% now, +${wearRate[corner].toFixed(2)}pp/lap over 3 comparable laps; no-stop linear finish projection ${projected.toFixed(1)}%.`
      )
    }
  })

  it('uses only the remaining fraction on the final lap', () => {
    const analysis = new RaceAnalysis()
    observeLaps(analysis, 5, 5)
    const finalLap = sample(5, 5, 0.75)
    const report = analysis.report(finalLap, 100_000)

    expect(report).toContain('0.25 laps to flag')
    expect(report).toContain('RL wear: 14.0% now, +1.00pp/lap over 3 comparable laps; no-stop linear finish projection 14.3%.')
  })

  it('drops history across an invalid lap and does not let NaN wear poison later estimates', () => {
    const analysis = new RaceAnalysis()
    observeLaps(analysis, 5, 20)

    const invalid = sample(6, 20)
    invalid.player.currentLapInvalid = true
    analysis.observe(invalid, 100_000)
    expect(analysis.report(invalid, 100_000)).not.toContain('Historical fuel cross-check:')

    const nanWear = sample(7, 20)
    nanWear.player.tyres.wear.rl = Number.NaN
    analysis.observe(nanWear, 100_000)
    for (let lap = 8; lap <= 11; lap++) analysis.observe(sample(lap, 20), 100_000)

    const report = analysis.report(sample(11, 20), 100_000)
    expect(report).toContain('over 3 comparable laps; no-stop linear finish projection')
    expect(report).not.toContain('NaN')
  })

  it('clears learned rates after stale telemetry or flashback reset', () => {
    for (const resetKind of ['stale', 'flashback'] as const) {
      const analysis = new RaceAnalysis()
      observeLaps(analysis, 5, 20)

      const resetState = sample(6, 20)
      if (resetKind === 'stale') resetState.lastPacketMs = 94_999
      else resetState.flashbackActive = true
      analysis.observe(resetState, 100_000)

      const fresh = sample(6, 20)
      expect(analysis.report(fresh, 100_000)).toContain('Comparable observed laps: not enough yet.')
      expect(analysis.report(fresh, 100_000)).not.toContain('Historical fuel cross-check:')
    }
  })

  it('asks for the concrete strategy records instead of treating unchecked inputs as unavailable', () => {
    const report = new RaceAnalysis().report(sample(3, 20), 100_000)
    expect(report).toContain('query session packet 1 for pit window/rejoin/rules')
    expect(report).toContain('player tyre sets packet 12')
    expect(report).toContain('session history packet 11')
    expect(report).toContain('Do not label these unavailable until checked.')
  })
})
