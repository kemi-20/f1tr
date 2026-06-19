import { TRACK_PATHS } from './track-paths'

/** Compact F1 25 track reference for the SVG map. IDs are the REAL F1 25 m_trackId values
 *  (sparse, not sequential) verified from the Codemasters spec appendix. */
export interface TrackDef {
  id: number
  name: string
  country: string
  laps: number
  lengthKm: number
  /** SVG path string (viewBox 0 0 100 100) */
  path: string
  /** DRS detection zones as lap-distance % ranges */
  drsZones: [number, number][]
  /** Sector boundaries as lap-distance % */
  sectors: [number, number]
}

const TRACK_META: Record<number, { name: string; country: string; laps: number }> = {
  0: { name: 'Melbourne', country: 'Australia', laps: 58 },
  2: { name: 'Shanghai', country: 'China', laps: 56 },
  3: { name: 'Sakhir', country: 'Bahrain', laps: 57 },
  4: { name: 'Catalunya', country: 'Spain', laps: 66 },
  5: { name: 'Monaco', country: 'Monaco', laps: 78 },
  6: { name: 'Montreal', country: 'Canada', laps: 70 },
  7: { name: 'Silverstone', country: 'UK', laps: 52 },
  9: { name: 'Hungaroring', country: 'Hungary', laps: 70 },
  10: { name: 'Spa', country: 'Belgium', laps: 44 },
  11: { name: 'Monza', country: 'Italy', laps: 53 },
  12: { name: 'Singapore', country: 'Singapore', laps: 62 },
  13: { name: 'Suzuka', country: 'Japan', laps: 53 },
  14: { name: 'Yas Marina', country: 'Abu Dhabi', laps: 58 },
  15: { name: 'Austin', country: 'USA', laps: 56 },
  16: { name: 'Interlagos', country: 'Brazil', laps: 71 },
  17: { name: 'Red Bull Ring', country: 'Austria', laps: 71 },
  19: { name: 'Mexico City', country: 'Mexico', laps: 71 },
  20: { name: 'Baku', country: 'Azerbaijan', laps: 51 },
  26: { name: 'Zandvoort', country: 'Netherlands', laps: 72 },
  27: { name: 'Imola', country: 'Italy', laps: 63 },
  29: { name: 'Jeddah', country: 'Saudi Arabia', laps: 50 },
  30: { name: 'Miami', country: 'USA', laps: 57 },
  31: { name: 'Las Vegas', country: 'USA', laps: 50 },
  32: { name: 'Losail', country: 'Qatar', laps: 57 },
  42: { name: 'Madrid', country: 'Spain', laps: 66 }
}

export const TRACKS: Record<number, TrackDef> = Object.fromEntries(
  Object.entries(TRACK_PATHS).map(([id, path]) => {
    const tid = Number(id)
    const meta = TRACK_META[tid] ?? { name: `Track ${tid}`, country: '', laps: 50 }
    return [tid, {
      id: tid,
      name: meta.name,
      country: meta.country,
      laps: meta.laps,
      lengthKm: 0,
      path,
      drsZones: [[0.05, 0.1], [0.6, 0.65]],
      sectors: [0.33, 0.66]
    }]
  })
)

export function getTrack(id: number): TrackDef | null {
  return TRACKS[id] ?? null
}
