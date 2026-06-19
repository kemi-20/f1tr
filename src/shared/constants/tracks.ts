/** Compact F1 25 track reference for the SVG map. */
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

/**
 * Minimal subset of 2025 calendar tracks with hand-authored SVG path approximations.
 * Unknown trackId falls back to a linear "ribbon" representation in the UI.
 */
export const TRACKS: Record<number, TrackDef> = {
  0: {
    id: 0,
    name: 'Melbourne',
    country: 'Australia',
    laps: 58,
    lengthKm: 5.278,
    path: 'M20,80 C30,70 40,75 45,65 C50,55 40,50 45,40 C50,30 65,30 70,40 C75,50 60,55 70,65 C80,75 85,70 85,55 C85,40 75,25 60,25 C45,25 25,35 20,50 Z',
    drsZones: [[0.0, 0.05], [0.5, 0.56]],
    sectors: [0.36, 0.7]
  },
  4: {
    id: 4,
    name: 'Suzuka',
    country: 'Japan',
    laps: 53,
    lengthKm: 5.807,
    path: 'M30,25 C45,20 60,22 68,32 C74,40 70,50 62,52 C54,54 52,46 46,48 C40,50 42,60 35,62 C25,65 18,55 22,45 C25,38 28,30 30,25 Z',
    drsZones: [[0.08, 0.13], [0.62, 0.68]],
    sectors: [0.33, 0.68]
  },
  7: {
    id: 7,
    name: 'Monaco',
    country: 'Monaco',
    laps: 78,
    lengthKm: 3.337,
    path: 'M25,30 C40,25 60,28 70,35 C80,42 82,55 75,65 C68,73 50,72 40,66 C30,60 20,50 20,40 C20,35 22,32 25,30 Z',
    drsZones: [[0.0, 0.05]],
    sectors: [0.4, 0.75]
  },
  9: {
    id: 9,
    name: 'Silverstone',
    country: 'Great Britain',
    laps: 52,
    lengthKm: 5.891,
    path: 'M25,75 C20,60 25,45 35,40 C45,35 50,45 55,40 C60,35 70,35 75,45 C80,55 78,70 65,75 C55,79 35,82 25,75 Z',
    drsZones: [[0.4, 0.46], [0.78, 0.85]],
    sectors: [0.3, 0.62]
  }
}

export function getTrack(id: number): TrackDef | null {
  return TRACKS[id] ?? null
}
