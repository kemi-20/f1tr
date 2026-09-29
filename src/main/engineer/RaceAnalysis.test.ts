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
  state.session.sessionType = 15
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

  it('uses a timed run plan for full and short practice', () => {
    for (const [type, label] of [[1, 'full practice P1'], [4, 'short practice']] as const) {
      const state = sample(3, 20)
      state.session.sessionType = type
      state.session.sessionTimeLeftS = 900
      const report = new RaceAnalysis().report(state, 100_000)
      expect(report).toContain(label)
      expect(report).toContain('900s remaining')
      expect(report).not.toContain('laps to flag')
      expect(report).not.toContain('pit-loss observation')
    }
  })

  it('does not impose the dry compound obligation on a sprint or five-lap race', () => {
    const short = sample(2, 5)
    short.session.isSprintRace = false
    expect(new RaceAnalysis().report(short, 100_000)).toContain('Very short 3/5-lap race')
    const sprint = sample(2, 20)
    sprint.session.isSprintRace = true
    expect(new RaceAnalysis().report(sprint, 100_000)).toContain('Confirmed sprint race')
  })

  it('plans the dry two-compound obligation only for a confirmed Grand Prix', () => {
    const grandPrix = sample(2, 20)
    grandPrix.session.isSprintRace = false
    expect(new RaceAnalysis().report(grandPrix, 100_000)).toContain('Dry Grand Prix: plan to use at least two different slick compounds')

    grandPrix.session.isSprintRace = null
    expect(new RaceAnalysis().report(grandPrix, 100_000)).toContain('Two-compound obligation not established')
  })

  it('recognizes a passed box call as likely disagreement and clears it after a stop', () => {
    const analysis = new RaceAnalysis()
    const call = sample(5)
    analysis.noteRadio(call, 'BOX THIS LAP. Mediums ready.')
    expect(analysis.report(call, 100_000)).not.toContain('likely strategy objection')
    const continued = sample(6)
    expect(analysis.report(continued, 100_000)).toContain('likely strategy objection')
    continued.player.pitStopCount = 1
    analysis.observe(continued, 100_000)
    expect(analysis.report(continued, 100_000)).not.toContain('likely strategy objection')
  })
})
