import { describe, expect, it } from 'vitest'
import { emptyRaceState } from '../state/defaults'
import type { RaceState, RivalState } from '@shared/types/state'
import { relativeMotion, relativePosition } from './SpatialAwareness'
import { readTrackLayout } from './TrackLayoutReport'
import { TelemetryHistory } from './TelemetryHistory'
import { executeTelemetryTool } from './TelemetryHarness'

function sample(ts = 10_000, playerM = 1000, rivalM = 900): RaceState {
  const s = emptyRaceState()
  s.lastPacketMs = ts
  Object.assign(s.session, { sessionUID: 'one', overallFrameIdentifier: ts, sessionType: 15,
    trackId: 29, trackLengthM: 6175 })
  Object.assign(s.player, { carIndex: 0, onTrack: true, pitStatus: 0, lap: 3, distanceFromStartM: playerM,
    totalDistanceM: 12_350 + playerM, bestLapTimeS: 94, lapDataUpdatedAt: ts })
  s.rivals[1] = { carIndex: 1, name: 'Rival', status: 'running', position: 2, lap: 3, pitStatus: 0,
    distanceFromStartM: rivalM, totalDistanceM: 12_350 + rivalM, bestLapTimeS: 93.6,
    gapToPlayerS: -12, lapDataUpdatedAt: ts, lapPhase: 'flying', currentLapInvalid: false } as RivalState
  return s
}

describe('independent spatial and timing evidence', () => {
  it.each([1, 4, 5, 8, 9, 10, 14])('keeps best-lap delta separate from physical separation in session %i', type => {
    const s = sample()
    s.session.sessionType = type
    const result = relativePosition(s, s.rivals[1], 10_000)
    expect(result.bestLapDeltaToPlayerS).toBeCloseTo(-0.4)
    expect(result.raceTimingGapToPlayerS).toBeNull()
    expect(result.rankingDisplayDeltaS).toBeCloseTo(-0.4)
    expect(result.trackRelativeSeparationM).toBe(-100)
    expect(result.forwardCircuitDistanceM).toBe(6075)
    expect(result.backwardCircuitDistanceM).toBe(100)
  })

  it('preserves classification gap and UI sign while a lapped car is physically ahead', () => {
    const s = sample(10_000, 6100, 25)
    s.rivals[1].lap = 2
    s.rivals[1].totalDistanceM = 6200
    const result = relativePosition(s, s.rivals[1], 10_000)
    expect(result).toMatchObject({ trackRelativeSeparationM: 100, lapDifference: -1,
      raceTimingGapToPlayerS: -12, rankingDisplayDeltaS: 12, nearestDirection: 'ahead' })
    expect(result.raceDistanceSeparationM).toBe(-12_250)
  })

  it.each(['stale', 'future', 'asynchronous', 'pit', 'garage', 'missing', 'invalid', 'flashback'])('rejects %s physical evidence', reason => {
    const s = sample()
    if (reason === 'stale') s.rivals[1].lapDataUpdatedAt = 7000
    if (reason === 'future') s.rivals[1].lapDataUpdatedAt = 10001
    if (reason === 'asynchronous') s.rivals[1].lapDataUpdatedAt = 9000
    if (reason === 'pit') s.rivals[1].pitStatus = 1
    if (reason === 'garage') s.player.onTrack = false
    if (reason === 'missing') s.player.distanceFromStartM = null
    if (reason === 'invalid') s.rivals[1].distanceFromStartM = 1e12
    if (reason === 'flashback') s.flashbackActive = true
    expect(relativePosition(s, s.rivals[1], 10_000).shortestArcDistanceM).toBeNull()
  })

  it('does not replace a missing best lap with zero or the leader', () => {
    const s = sample()
    s.player.bestLapTimeS = null
    expect(relativePosition(s, s.rivals[1], 10_000).bestLapDeltaToPlayerS).toBeNull()
  })

  it('marks exactly half a lap as directionally ambiguous', () => {
    const s = sample(10_000, 0, 6175 / 2)
    expect(relativePosition(s, s.rivals[1], 10_000).nearestDirection).toBe('equidistant')
  })
})

describe('relative motion evidence', () => {
  const closing = () => [sample(9000, 1000, 800), sample(9500, 1010, 850), sample(10000, 1020, 900)]
  it('uses several samples for closing and labels ETA as an estimate', () => {
    expect(relativeMotion(closing(), 1, 10000)).toMatchObject({ closingMps: 80, catchEstimateS: 1.5, sampleCount: 3 })
  })
  it('handles a legitimate start-line crossing without confusing whole laps', () => {
    const states = [sample(9000, 6160, 6035), sample(9500, 5, 6085), sample(10000, 25, 6135)]
    expect(relativeMotion(states, 1, 10000)).toMatchObject({ closingMps: 60, sampleCount: 3 })
  })
  it.each(['pass', 'teleport', 'pit', 'frame', 'session', 'stale', 'oneSample', 'stoppedClosing'])('withholds ETA after %s', reason => {
    const states = closing()
    const last = states[2]
    if (reason === 'pass') last.rivals[1].distanceFromStartM = 1030
    if (reason === 'teleport') last.player.distanceFromStartM = 3020
    if (reason === 'pit') last.rivals[1].pitStatus = 1
    if (reason === 'frame') last.session.overallFrameIdentifier = 1
    if (reason === 'session') last.session.sessionUID = 'two'
    if (reason === 'stoppedClosing') last.rivals[1].distanceFromStartM = 860
    const result = relativeMotion(reason === 'oneSample' ? [last] : states, 1, reason === 'stale' ? 15000 : 10000)
    expect(result.catchEstimateS).toBeNull()
  })
})

describe('map query boundary and calibration', () => {
  it('exposes full-loop JSON geometry with resolution and coordinates', () => {
    const result = readTrackLayout(sample(), { section: 'geometry' }, 10000)
    expect(result).toMatchObject({ mapAvailable: true, geometry: { pointCount: 160, axes: ['worldX', 'worldZ'], closed: true } })
    expect(JSON.stringify(result).length).toBeLessThan(59000)
  })
  it('uses session metres for physical arcs and withholds zones on map-length mismatch', () => {
    const s = sample(10000, 4900, 100)
    s.session.trackLengthM = 5000
    const result = readTrackLayout(s, { section: 'positions' }, 10000)
    expect(result).toMatchObject({ lengthMismatch: true, positions: {
      player: { sector: null, metresToPitEntry: null }, rivals: [{ trackRelativeSeparationM: 200 }] } })
  })
  it('still supplies physical and timing evidence without a static track asset', () => {
    const s = sample()
    s.session.trackId = 999
    expect(readTrackLayout(s, { section: 'positions' }, 10000)).toMatchObject({ mapAvailable: false,
      positions: { rivals: [{ trackRelativeSeparationM: -100 }] } })
  })
  it('does not reuse old Motion coordinates when only LapData is fresh', () => {
    const s = sample()
    s.trackPositions = [{ carIndex: 0, lapDistancePct: 0.2, speedKmh: 200, isPlayer: true,
      worldX: 42, worldZ: 10, motionUpdatedAt: 6000 }]
    expect(readTrackLayout(s, { section: 'positions' }, 10000)).toMatchObject({ positions: { player: { worldPosition: null } } })
  })
  it.each([{ section: '../../secret' }, { section: 'geometry', path: 'C:/secret' }, { section: ['geometry'] },
    { section: 'positions', carIndex: '__proto__' }])('rejects unexpected model arguments %j', args => {
    expect(executeTelemetryTool(new TelemetryHistory(), 'get_track_layout', JSON.stringify(args))).toMatch(/^Invalid/)
  })
})
