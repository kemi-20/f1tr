import { describe, expect, it } from 'vitest'
import { emptyRaceState } from '../state/defaults'
import { readTrackLayout } from './TrackLayoutReport'
import type { RivalState } from '@shared/types/state'

describe('track layout position report', () => {
  it('exposes physical proximity separately from race progress and lap count', () => {
    const state = emptyRaceState()
    state.session.trackId = 29
    state.session.trackLengthM = 6175
    Object.assign(state.player, { carIndex: 0, lap: 4, distanceFromStartM: 1000,
      totalDistanceM: 19525, speedKmh: 200, onTrack: true, lapDataUpdatedAt: Date.now() })
    state.rivals[1] = {
      carIndex: 1, name: 'Rival', lap: 5, position: 1, pitStatus: 0,
      distanceFromStartM: 1100, totalDistanceM: 25800,
      separationFromPlayerM: 6275, trackRelativeSeparationM: 100, status: 'running', lapDataUpdatedAt: Date.now()
    } as RivalState
    const result = readTrackLayout(state, { section: 'positions' }) as {
      positions: { rivals: Array<{ lapDifference: number; raceDistanceSeparationM: number;
        trackRelativeSeparationM: number; distanceFromStartM: number;
        forwardCircuitDistanceM: number; backwardCircuitDistanceM: number }> }
    }
    expect(result.positions.rivals[0]).toMatchObject({ lapDifference: 1,
      raceDistanceSeparationM: 6275, trackRelativeSeparationM: 100, distanceFromStartM: 1100,
      forwardCircuitDistanceM: 100, backwardCircuitDistanceM: 6075 })
  })
})
