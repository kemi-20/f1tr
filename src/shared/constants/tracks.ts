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
    id: 0, name: 'Melbourne', country: 'Australia', laps: 58, lengthKm: 5.278,
    path: 'M50,15 C70,15 82,30 80,48 C78,62 70,70 58,72 C45,74 35,68 30,58 C25,48 28,38 38,32 C46,27 50,22 50,15 Z',
    drsZones: [[0, 0.08], [0.55, 0.62]], sectors: [0.36, 0.7]
  },
  1: {
    id: 1, name: 'Jeddah', country: 'Saudi Arabia', laps: 50, lengthKm: 6.174,
    path: 'M30,20 C45,18 60,22 70,32 C78,42 75,55 68,62 C58,70 45,68 38,60 C32,53 35,45 42,42 C50,39 55,45 60,50 C64,54 58,58 52,56',
    drsZones: [[0.05, 0.12], [0.6, 0.68]], sectors: [0.35, 0.68]
  },
  2: {
    id: 2, name: 'Bahrain', country: 'Bahrain', laps: 57, lengthKm: 5.412,
    path: 'M25,30 C40,22 60,25 72,35 C82,45 80,60 70,68 C58,75 42,72 32,62 C25,55 25,45 30,38 L25,30 Z',
    drsZones: [[0.08, 0.15], [0.55, 0.65]], sectors: [0.33, 0.66]
  },
  3: {
    id: 3, name: 'Imola', country: 'Italy', laps: 63, lengthKm: 4.909,
    path: 'M28,22 C40,20 52,25 58,35 C62,42 58,50 52,55 C45,60 38,55 35,48 C32,40 28,35 22,40 C18,45 22,52 28,55',
    drsZones: [[0.1, 0.16], [0.62, 0.7]], sectors: [0.34, 0.67]
  },
  4: {
    id: 4, name: 'Suzuka', country: 'Japan', laps: 53, lengthKm: 5.807,
    path: 'M30,25 C45,20 60,22 68,32 C74,40 70,50 62,52 C54,54 52,46 46,48 C40,50 42,60 35,62 C25,65 18,55 22,45 C25,38 28,30 30,25 Z',
    drsZones: [[0.08, 0.13], [0.62, 0.68]], sectors: [0.33, 0.68]
  },
  5: {
    id: 5, name: 'Miami', country: 'USA', laps: 57, lengthKm: 5.412,
    path: 'M22,35 C30,25 45,22 58,28 C70,34 78,45 72,58 C66,68 50,70 40,65 C30,60 28,50 35,45 C42,40 48,45 52,50',
    drsZones: [[0.06, 0.13], [0.58, 0.66]], sectors: [0.34, 0.66]
  },
  6: {
    id: 6, name: 'Monaco', country: 'Monaco', laps: 78, lengthKm: 3.337,
    path: 'M25,30 C40,25 60,28 70,35 C80,42 82,55 75,65 C68,73 50,72 40,66 C30,60 20,50 20,40 C20,35 22,32 25,30 Z',
    drsZones: [[0, 0.05]], sectors: [0.4, 0.75]
  },
  7: {
    id: 7, name: 'Montreal', country: 'Canada', laps: 70, lengthKm: 4.361,
    path: 'M25,30 C35,22 50,22 62,30 C72,38 75,55 68,65 C60,73 45,72 35,65 C28,60 22,50 25,40 Z',
    drsZones: [[0.1, 0.18], [0.6, 0.68]], sectors: [0.34, 0.66]
  },
  9: {
    id: 9, name: 'Silverstone', country: 'Great Britain', laps: 52, lengthKm: 5.891,
    path: 'M25,75 C20,60 25,45 35,40 C45,35 50,45 55,40 C60,35 70,35 75,45 C80,55 78,70 65,75 C55,79 35,82 25,75 Z',
    drsZones: [[0.4, 0.46], [0.78, 0.85]], sectors: [0.3, 0.62]
  },
  10: {
    id: 10, name: 'Spa', country: 'Belgium', laps: 44, lengthKm: 7.004,
    path: 'M20,30 C35,20 55,22 70,30 C82,40 80,55 70,65 C55,72 35,70 25,60 C18,50 18,38 20,30 Z',
    drsZones: [[0.05, 0.12], [0.7, 0.8]], sectors: [0.32, 0.65]
  },
  11: {
    id: 11, name: 'Zandvoort', country: 'Netherlands', laps: 72, lengthKm: 4.259,
    path: 'M28,20 C45,18 62,25 70,38 C76,50 72,62 62,68 C50,72 38,68 30,58 C24,50 28,40 35,38',
    drsZones: [[0.1, 0.17], [0.6, 0.68]], sectors: [0.34, 0.66]
  },
  12: {
    id: 12, name: 'Monza', country: 'Italy', laps: 53, lengthKm: 5.793,
    path: 'M22,35 C30,25 45,22 58,28 C72,35 78,50 72,62 C66,72 50,72 38,65 C28,58 25,45 22,35 Z',
    drsZones: [[0.08, 0.15], [0.75, 0.85]], sectors: [0.33, 0.66]
  },
  13: {
    id: 13, name: 'Singapore', country: 'Singapore', laps: 62, lengthKm: 4.94,
    path: 'M25,28 C38,22 55,25 65,35 C72,45 68,58 58,65 C45,70 32,65 25,55 C20,45 22,35 25,28 Z',
    drsZones: [[0.05, 0.12], [0.6, 0.68]], sectors: [0.34, 0.67]
  },
  14: {
    id: 14, name: 'Austin', country: 'USA', laps: 56, lengthKm: 5.513,
    path: 'M25,30 C38,22 55,22 68,30 C80,40 78,55 70,65 C58,72 42,70 30,60 C22,50 22,38 25,30 Z',
    drsZones: [[0.1, 0.18], [0.65, 0.73]], sectors: [0.33, 0.66]
  },
  15: {
    id: 15, name: 'Mexico City', country: 'Mexico', laps: 71, lengthKm: 4.304,
    path: 'M25,30 C38,22 55,22 68,32 C78,42 75,58 65,65 C52,70 35,65 28,55 C22,45 22,35 25,30 Z',
    drsZones: [[0.1, 0.18], [0.6, 0.68]], sectors: [0.34, 0.66]
  },
  19: {
    id: 19, name: 'Yas Marina', country: 'Abu Dhabi', laps: 58, lengthKm: 5.281,
    path: 'M25,30 C38,22 55,22 68,32 C78,42 75,58 65,65 C52,70 35,65 28,55 C22,45 22,35 25,30 Z',
    drsZones: [[0.08, 0.15], [0.7, 0.78]], sectors: [0.33, 0.66]
  }
}

export function getTrack(id: number): TrackDef | null {
  return TRACKS[id] ?? null
}
