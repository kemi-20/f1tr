import type { RivalState } from '../types/state'
import { sessionKind } from './sessionKind'

const MAX_VALID_LAP_TIME_S = 600

type LapTimeRival = Pick<RivalState, 'carIndex' | 'position' | 'bestLapTimeS'>

export interface BestLapRankedRival<T extends LapTimeRival> {
  rival: T
  rank: number | null
  deltaS: number | null
}

export function isQualifyingOrPracticeSession(sessionType: number, sessionTypeLabel: string): boolean {
  return ['practice', 'qualifying'].includes(sessionKind({ sessionType, sessionTypeLabel }))
}

export function rankRivalsByBestLap<T extends LapTimeRival>(
  rivals: readonly T[],
  playerCarIndex: number,
  playerBestLapTimeS: number | null
): BestLapRankedRival<T>[] {
  const ordered = rivals
    .map((rival) => ({ rival, lapTimeS: validLapTime(rival.carIndex === playerCarIndex ? playerBestLapTimeS : rival.bestLapTimeS) }))
    .sort((a, b) => {
      if (a.lapTimeS != null && b.lapTimeS != null) {
        return a.lapTimeS - b.lapTimeS || a.rival.position - b.rival.position || a.rival.carIndex - b.rival.carIndex
      }
      if (a.lapTimeS != null) return -1
      if (b.lapTimeS != null) return 1
      return a.rival.position - b.rival.position || a.rival.carIndex - b.rival.carIndex
    })

  const referenceLap = validLapTime(playerBestLapTimeS)
  let rank = 0

  return ordered.map(({ rival, lapTimeS }) => ({
    rival,
    rank: lapTimeS == null ? null : ++rank,
    deltaS: lapTimeS == null || referenceLap == null ? null : lapTimeS - referenceLap
  }))
}

export function formatBestLapDelta(deltaS: number | null): string {
  if (deltaS == null || !Number.isFinite(deltaS) || Math.abs(deltaS) > MAX_VALID_LAP_TIME_S) return '--'
  const rounded = Number(deltaS.toFixed(2))
  const sign = rounded > 0 ? '+' : rounded < 0 ? '-' : ''
  return `${sign}${Math.abs(rounded).toFixed(2)}`
}

function validLapTime(value: number | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_VALID_LAP_TIME_S
    ? value
    : null
}
