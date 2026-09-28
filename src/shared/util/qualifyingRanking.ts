import type { RivalState } from '../types/state'

const PRACTICE_SESSION_TYPES = new Set([1, 2, 3, 4, 11])
const QUALIFYING_SESSION_TYPES = new Set([5, 6, 7, 8, 9, 12])
const MAX_VALID_LAP_TIME_S = 600

type LapTimeRival = Pick<RivalState, 'carIndex' | 'position' | 'bestLapTimeS'>

export interface BestLapRankedRival<T extends LapTimeRival> {
  rival: T
  rank: number | null
  deltaS: number | null
}

export function isQualifyingOrPracticeSession(sessionType: number, sessionTypeLabel: string): boolean {
  if (PRACTICE_SESSION_TYPES.has(sessionType) || QUALIFYING_SESSION_TYPES.has(sessionType)) return true
  if (Number.isInteger(sessionType) && sessionType >= 0 && sessionType <= 16) return false

  return /^(?:practice|p[123]|short p|qualifying|q[123]|short q|osq)$/i.test(sessionTypeLabel.trim())
}

export function rankRivalsByBestLap<T extends LapTimeRival>(
  rivals: readonly T[],
  playerCarIndex: number,
  playerBestLapTimeS: number | null
): BestLapRankedRival<T>[] {
  const ordered = rivals
    .map((rival) => ({ rival, lapTimeS: validLapTime(rival.bestLapTimeS) }))
    .sort((a, b) => {
      if (a.lapTimeS != null && b.lapTimeS != null) {
        return a.lapTimeS - b.lapTimeS || a.rival.position - b.rival.position || a.rival.carIndex - b.rival.carIndex
      }
      if (a.lapTimeS != null) return -1
      if (b.lapTimeS != null) return 1
      return a.rival.position - b.rival.position || a.rival.carIndex - b.rival.carIndex
    })

  const playerRival = ordered.find(({ rival }) => rival.carIndex === playerCarIndex)
  const playerLap = validLapTime(playerBestLapTimeS) ?? playerRival?.lapTimeS ?? null
  const referenceLap = playerLap ?? ordered.find(({ lapTimeS }) => lapTimeS != null)?.lapTimeS ?? null
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
