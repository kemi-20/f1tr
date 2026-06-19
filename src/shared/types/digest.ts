import type { Priority } from './audio'

/**
 * Digest — the compact, lossy projection of RaceState sent to the LLM.
 * Designed for ~120-300 tokens. This is what makes "all the data" usable cheaply.
 */
export interface Digest {
  ts: number
  session: {
    track: string
    type: string
    lap: string
    timeLeft?: string
    sc: 'none' | 'vsc' | 'sc' | 'red'
  }
  weather: {
    airC: number
    trackC: number
    rainPct: number
    wet: number
    expected: string
  }
  player: {
    pos: string
    gapAhead?: string
    gapBehind?: string
    lastLap: string
    bestLap: string
    fuel: string
    pits: number
    ers: string
    drs: string
    tyre: { compound: string; age: string; wear: string; surfaceT: string; blister: string }
    dmg: { wingL: string; wingR: string }
  }
  rivals: {
    pos: number
    name: string
    tyre: string
    gap: string
    pits: number
    pen?: string
    note?: string
  }[]
  events: string[]
  trigger: { code: string; reason: string; priority: Priority }
}
