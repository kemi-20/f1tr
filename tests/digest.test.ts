import { describe, it, expect } from 'vitest'
import { DigestBuilder } from '../src/main/engineer/DigestBuilder'
import { StateAggregator } from '../src/main/state/StateAggregator'
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
  s.player.tyres.innerTempC = { rl: 96, rr: 95, fl: 97, fr: 94 }
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

const header = {
  m_packetFormat: 2025,
  m_gameYear: 2025,
  m_sessionUID: 123n,
  m_overallFrameIdentifier: 1,
  m_playerCarIndex: 2
}

function sessionPacket(safetyCarStatus: number): Record<string, unknown> {
  return {
    m_header: header,
    m_sessionType: 13,
    m_trackId: 16,
    m_totalLaps: 71,
    m_sessionTimeLeft: 3600,
    m_sessionDuration: 5400,
    m_pitSpeedLimit: 80,
    m_trackLength: 4294,
    m_safetyCarStatus: safetyCarStatus,
    m_numRedFlagPeriods: 0,
    m_airTemperature: 24,
    m_trackTemperature: 34,
    m_trackWetness: 0,
    m_weatherForecastSamples: [{ m_rainPercentage: 5, m_weather: 0 }]
  }
}

function lap(position: number, gapToFront: number | null): Record<string, unknown> {
  return {
    m_carPosition: position,
    m_currentLapNum: 10,
    m_lapDistance: 1000,
    m_deltaToCarInFrontMSPart: gapToFront == null ? 0 : Math.round(gapToFront * 1000),
    m_deltaToCarInFrontMinutesPart: 0,
    m_numPitStops: 0,
    m_pitStatus: 0,
    m_penalties: 0,
    m_lastLapTimeInMs: 90_000,
    m_currentLapTimeInMs: 30_000,
    m_gridPosition: position,
    m_resultStatus: 2,
    m_driverStatus: 4
  }
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
    expect(text).toContain('surface temp 102/99/104/98C')
    expect(text).toContain('inner/core temp 96/95/97/94C')
    expect(text).toContain('TRIGGER [high] defend_warning')
  })

  it('includes rival gap context', () => {
    const db = new DigestBuilder()
    const text = db.toText(db.build(makeState(), firing))
    expect(text).toContain('SAINZ')
    expect(text).toContain('NORRIS')
  })
})

describe('StateAggregator gap and safety-car events', () => {
  it('does not double-count the player-to-front gap when walking cars ahead', () => {
    const agg = new StateAggregator()
    agg.onSession(sessionPacket(0) as never)
    agg.onLapData({
      m_header: header,
      m_lapData: [
        lap(1, null),
        lap(2, 1.2),
        lap(3, 0.8),
        lap(4, 0.5)
      ]
    } as never)

    expect(agg.state.rivals[2].gapToPlayerS).toBe(0)
    expect(agg.state.rivals[1].gapToPlayerS).toBeCloseTo(0.8)
    expect(agg.state.rivals[0].gapToPlayerS).toBeCloseTo(2.0)
    expect(agg.state.rivals[3].gapToPlayerS).toBeCloseTo(-0.5)
  })

  it('emits green-flag event after VSC ending status transitions to racing resumed', () => {
    const agg = new StateAggregator()
    agg.onSession(sessionPacket(2) as never)
    agg.onSession(sessionPacket(4) as never)
    agg.onSession(sessionPacket(5) as never)

    expect(agg.state.recentEvents.map((ev) => ev.text)).toContain('SC/VSC ended — green flag')
  })
})
