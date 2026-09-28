import { describe, expect, it } from 'vitest'
import { StateAggregator } from './StateAggregator'

function lapDataPacket(playerTotal: number, playerLapDistance: number, rivals: Array<{
  index: number; total: number; lapDistance: number; delta: number; position: number; lap: number
}>, playerPosition = 0, playerDelta = 0) {
  const carCount = Math.max(2, ...rivals.map(r => r.index + 1))
  const players = new Array(carCount).fill(null).map(() => ({
    m_carPosition: playerPosition, m_currentLapNum: 3, m_lapDistance: 0, m_totalDistance: 0,
    m_deltaToCarInFrontInMS: 0, m_pitStatus: 0, m_numPitStops: 0, m_penalties: 0,
    m_lastLapTimeInMS: 90000, m_currentLapTimeInMS: 30000, m_gridPosition: 1,
    m_resultStatus: 1, m_driverStatus: 4, m_currentLapInvalid: 0, m_sector: 0,
    m_pitStopTimerInMS: 0
  }))
  players[0] = { ...players[0], m_totalDistance: playerTotal, m_lapDistance: playerLapDistance,
    m_deltaToCarInFrontInMS: playerDelta }
  for (const r of rivals) {
    players[r.index] = { ...players[0], m_totalDistance: r.total, m_lapDistance: r.lapDistance,
      m_deltaToCarInFrontInMS: r.delta, m_carPosition: r.position, m_currentLapNum: r.lap }
  }
  return {
    m_header: { m_playerCarIndex: 0, m_sessionUID: 1n, m_frameIdentifier: 1, m_overallFrameIdentifier: 1 },
    m_lapData: players
  }
}

function sessionPacket(trackLength: number) {
  return {
    m_header: { m_sessionUID: 1n, m_playerCarIndex: 0, m_frameIdentifier: 1, m_overallFrameIdentifier: 1,
      m_packetFormat: 2025, m_gameYear: 25 },
    m_sessionType: 10, m_trackId: 29, m_totalLaps: 25, m_trackLength: trackLength,
    m_safetyCarStatus: 0, m_numRedFlagPeriods: 0, m_pitSpeedLimit: 80, m_sessionTimeLeft: 3000
  }
}

function telemetryPacket(speeds: Record<number, number>) {
  return {
    m_header: { m_playerCarIndex: 0, m_sessionUID: 1n, m_frameIdentifier: 1 },
    m_carTelemetryData: Object.values(speeds).map(kmh => ({
      m_speed: kmh, m_gear: 6, m_engineRPM: 11000, m_engineTemperature: 100, m_throttle: 1,
      m_brake: 0, m_revLightsPercent: 50, m_drs: 0,
      m_tyresSurfaceTemperature: [90, 90, 90, 90], m_tyresInnerTemperature: [100, 100, 100, 100],
      m_brakesTemperature: [400, 400, 400, 400]
    }))
  }
}

describe('gap and separation precision', () => {
  it('derives lap-aware physical separation from total distance', () => {
    const agg = new StateAggregator()
    agg.onSession(sessionPacket(6175) as never)
    agg.onLapData(lapDataPacket(100000, 5000, [
      { index: 1, total: 100000 + 180, lapDistance: 5180, delta: 1500, position: 2, lap: 3 },
      { index: 2, total: 100000 - 120, lapDistance: 4880, delta: 1500, position: 3, lap: 3 }
    ]) as never)
    expect(agg.getState().rivals[1].separationFromPlayerM).toBe(180)
    expect(agg.getState().rivals[2].separationFromPlayerM).toBe(-120)
  })

  it('keeps a whole-lap race difference distinct from nearby circuit traffic', () => {
    const agg = new StateAggregator()
    agg.onSession(sessionPacket(5000) as never)
    agg.onLapData(lapDataPacket(100000, 1000, [
      { index: 1, total: 105100, lapDistance: 1100, delta: 1500, position: 1, lap: 4 }
    ], 2, 1500) as never)
    expect(agg.getState().rivals[1].separationFromPlayerM).toBe(5100)
    expect(agg.getState().rivals[1].trackRelativeSeparationM).toBe(100)
    expect(agg.getState().rivals[1].gapToPlayerS).toBeNull()
  })

  it('validates each timing link against that adjacent pair rather than the player', () => {
    const agg = new StateAggregator()
    agg.onSession(sessionPacket(5000) as never)
    agg.onCarTelemetry(telemetryPacket({ 0: 200, 1: 200, 2: 200 }) as never)
    agg.onLapData(lapDataPacket(100000, 1000, [
      { index: 1, total: 100300, lapDistance: 1300, delta: 0, position: 1, lap: 3 },
      { index: 2, total: 100250, lapDistance: 1250, delta: 700, position: 2, lap: 3 }
    ], 3, 4000) as never)
    expect(agg.getState().rivals[2].gapToPlayerS).toBe(4)
    expect(agg.getState().rivals[1].gapToPlayerS).toBeCloseTo(4.7)
  })

  it('rejects a sub-second timing delta that is physically impossible', () => {
    const agg = new StateAggregator()
    agg.onSession(sessionPacket(6175) as never)
    // The car ahead is 400m away at ~200km/h: 0.07s is a line-crossing glitch, not a gap.
    agg.onLapData(lapDataPacket(100000, 5000, [
      { index: 1, total: 100000 + 400, lapDistance: 5400, delta: 70, position: 2, lap: 3 }
    ]) as never)
    agg.onCarTelemetry(telemetryPacket({ 0: 200, 1: 200 }) as never)
    agg.onLapData(lapDataPacket(100000, 5000, [
      { index: 1, total: 100000 + 400, lapDistance: 5400, delta: 70, position: 2, lap: 3 }
    ]) as never)
    expect(agg.getState().rivals[1].gapToPlayerS).toBeNull()
    expect(agg.getState().rivals[1].separationFromPlayerM).toBe(400)
  })

  it('keeps a believable gap when the physical separation permits it', () => {
    const agg = new StateAggregator()
    agg.onSession(sessionPacket(6175) as never)
    agg.onCarTelemetry(telemetryPacket({ 0: 200, 1: 200 }) as never)
    // 80m at ~200km/h is ~1.4s, so this delta is physically believable and must survive.
    // The rival runs P2, behind the player, with less cumulative race distance.
    agg.onLapData(lapDataPacket(100000, 5000, [
      { index: 1, total: 100000 - 80, lapDistance: 4920, delta: 1400, position: 2, lap: 3 }
    ], 1) as never)
    expect(agg.getState().player.position).toBe(1)
    expect(agg.getState().rivals[1].separationFromPlayerM).toBe(-80)
    expect(agg.getState().rivals[1].gapToPlayerS).toBeCloseTo(-1.4, 2)
  })

  it('rejects timing links when race order contradicts physical progress', () => {
    const agg = new StateAggregator()
    agg.onSession(sessionPacket(5000) as never)
    agg.onLapData(lapDataPacket(100000, 1000, [
      { index: 1, total: 100080, lapDistance: 1080, delta: 1400, position: 2, lap: 3 }
    ], 1) as never)
    expect(agg.getState().rivals[1].gapToPlayerS).toBeNull()
  })

  it('does not derive physical traffic from an out-of-range UDP lap distance', () => {
    const agg = new StateAggregator()
    agg.onSession(sessionPacket(5000) as never)
    agg.onLapData(lapDataPacket(100000, 1000, [
      { index: 1, total: 100100, lapDistance: 1e9, delta: 1500, position: 1, lap: 3 }
    ], 2, 1500) as never)
    expect(agg.getState().rivals[1].separationFromPlayerM).toBe(100)
    expect(agg.getState().rivals[1].trackRelativeSeparationM).toBeNull()
  })
})
