import { describe, expect, it } from 'vitest'
import type { RivalState } from '../types/state'
import { formatBestLapDelta, isQualifyingOrPracticeSession, rankRivalsByBestLap } from './qualifyingRanking'

function rival(carIndex: number, position: number, bestLapTimeS: number | null): Pick<RivalState, 'carIndex' | 'position' | 'bestLapTimeS'> {
  return { carIndex, position, bestLapTimeS }
}

describe('isQualifyingOrPracticeSession', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14])('enables best-lap ranking for session type %i', (sessionType) => {
    expect(isQualifyingOrPracticeSession(sessionType, '')).toBe(true)
  })

  it.each([15, 16, 17, 18])('preserves non-practice, non-qualifying behavior for session type %i', (sessionType) => {
    expect(isQualifyingOrPracticeSession(sessionType, 'Practice')).toBe(false)
  })

  it.each(['P2', 'Short P', 'Qualifying', 'Q3', 'Short Q', 'OSQ'])(
    'recognizes a known session label when the numeric type is unknown: %s',
    (label) => {
      expect(isQualifyingOrPracticeSession(99, label)).toBe(true)
    }
  )
})

describe('rankRivalsByBestLap', () => {
  it('orders valid laps fastest-first and compares every lap to the valid player lap', () => {
    const result = rankRivalsByBestLap(
      [rival(3, 3, 96.2), rival(1, 1, 95), rival(2, 2, 94.4)],
      1,
      95
    )

    expect(result.map(({ rival: entry, rank }) => [entry.carIndex, rank])).toEqual([[2, 1], [1, 2], [3, 3]])
    expect(result[0].deltaS).toBeCloseTo(-0.6)
    expect(result[1].deltaS).toBe(0)
    expect(result[2].deltaS).toBeCloseTo(1.2)
  })

  it('uses the fastest valid lap as the reference when the player has no valid lap', () => {
    const result = rankRivalsByBestLap(
      [rival(2, 2, 92.75), rival(1, 1, null), rival(3, 3, 94)],
      1,
      0
    )

    expect(result.map(({ rival: entry, rank, deltaS }) => [entry.carIndex, rank, deltaS])).toEqual([
      [2, 1, 0],
      [3, 2, 1.25],
      [1, null, null]
    ])
  })

  it.each([null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 601, Number.MAX_VALUE])(
    'keeps invalid best lap %s unranked and without a delta',
    (invalidLap) => {
      const result = rankRivalsByBestLap([rival(1, 1, 90), rival(2, 2, invalidLap)], 1, 90)

      expect(result.map(({ rival: entry, rank, deltaS }) => [entry.carIndex, rank, deltaS])).toEqual([
        [1, 1, 0],
        [2, null, null]
      ])
    }
  )

  it('breaks equal-lap and unranked ties by race position, then car index', () => {
    const result = rankRivalsByBestLap(
      [rival(4, 2, null), rival(3, 2, 90), rival(2, 1, 90), rival(1, 2, null)],
      -1,
      null
    )

    expect(result.map(({ rival: entry, rank }) => [entry.carIndex, rank])).toEqual([
      [2, 1],
      [3, 2],
      [1, null],
      [4, null]
    ])
  })
})

describe('formatBestLapDelta', () => {
  it.each([
    [1.236, '+1.24'],
    [-0.456, '-0.46'],
    [0, '0.00'],
    [-0.001, '0.00']
  ])('formats %s with two decimal places', (deltaS, expected) => {
    expect(formatBestLapDelta(deltaS)).toBe(expected)
  })

  it.each([null, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_VALUE, 600.01])(
    'rejects an unavailable or unrenderable delta: %s',
    (deltaS) => {
      expect(formatBestLapDelta(deltaS)).toBe('--')
    }
  )
})
