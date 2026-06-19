import { describe, it, expect } from 'vitest'
import { DigestBuilder } from '../src/main/engineer/DigestBuilder'
import { emptyRaceState } from '../src/main/state/defaults'
import type { TriggerFiring } from '../src/shared/types/triggers'
import type { RaceState } from '../src/shared/types/state'

function makeState(): RaceState {
  const s = emptyRaceState()
  s.session.trackName = 'Suzuka'
  s.session.sessionTypeLabel = 'Race'
  s.session.currentLap = 12
  s.session.totalLaps = 53
  s.session.sessionTimeLeftS = 2640
  s.weather.airTempC = 24
  s.weather.trackTempC = 31
  s.weather.rainPercentage = 8
  s.player.position = 4
  s.player.lastLapTimeS = 94.812
  s.player.bestLapTimeS = 94.201
  s.player.fuelRemainingKg = 8.3
  s.player.pitStopCount = 1
  s.player.ersPercent = 0.62
  s.player.drsAllowed = true
  s.player.tyres.compound = 'medium'
  s.player.tyres.ageLaps = 9
  s.player.tyres.wear = { rl: 58, rr: 55, fl: 60, fr: 57 }
  s.player.tyres.surfaceTempC = { rl: 102, rr: 99, fl: 104, fr: 98 }
  s.player.damage.frontLeftWing = 0.12
  s.player.damage.frontRightWing = 0.18
  s.rivals[3] = {
    carIndex: 3, name: 'SAINZ', team: '1', raceNumber: 55, carClass: 0,
    position: 3, gridPosition: 3, lap: 12, lapDistancePct: 0.5,
    bestLapTimeS: 94.0, lastLapTimeS: 94.9, currentLapTimeS: 40,
    deltaToCarInFrontS: 1.2, deltaToCarBehindS: null, gapToPlayerS: 1.2,
    pitStopCount: 1, pitStatus: 0, penaltiesS: 0, tyreCompound: 'medium',
    resultStatus: 2, status: 'running', relationToPlayer: 'ahead'
  }
  s.rivals[5] = {
    carIndex: 5, name: 'NORRIS', team: '4', raceNumber: 4, carClass: 0,
    position: 5, gridPosition: 5, lap: 12, lapDistancePct: 0.49,
    bestLapTimeS: 94.5, lastLapTimeS: 94.7, currentLapTimeS: 40,
    deltaToCarInFrontS: 0.4, deltaToCarBehindS: null, gapToPlayerS: -0.4,
    pitStopCount: 1, pitStatus: 0, penaltiesS: 0, tyreCompound: 'medium',
    resultStatus: 2, status: 'running', relationToPlayer: 'behind'
  }
  return s
}

const firing: TriggerFiring = {
  ruleId: 'defend_warning',
  kind: 'threshold',
  priority: 'high',
  reasonCode: 'defend_warning',
  reason: 'car behind within 0.4s, closing',
  ts: Date.now()
}

describe('DigestBuilder', () => {
  it('builds a digest and renders compact text', () => {
    const db = new DigestBuilder()
    const state = makeState()
    const d = db.build(state, firing)
    const text = db.toText(d)

    expect(d.session.track).toBe('Suzuka')
    expect(d.player.pos).toBe('P4')
    expect(d.player.fuel).toBe('8.3kg')
    expect(d.player.tyre.compound).toBe('medium')
    expect(d.rivals.length).toBe(2) // one ahead + one behind
    expect(d.trigger.code).toBe('defend_warning')

    expect(text).toContain('RACE: Suzuka')
    expect(text).toContain('Lap 12/53')
    expect(text).toContain('PLAYER: P4')
    expect(text).toContain('medium 9L')
    expect(text).toContain('TRIGGER [high] defend_warning')
  })

  it('includes rival gap context', () => {
    const db = new DigestBuilder()
    const text = db.toText(db.build(makeState(), firing))
    expect(text).toContain('SAINZ')
    expect(text).toContain('NORRIS')
  })
})
