import { TRACK_LAYOUTS, type TrackLayout, type TrackLayoutZone } from '../constants/trackLayout'

export type { TrackLayout, TrackLayoutZone }

export function getTrackLayout(trackId: number): TrackLayout | null {
  return TRACK_LAYOUTS[trackId] ?? null
}

/** Normalise a distance into [0, length). */
export function wrapDistance(metres: number, length: number): number {
  if (!(length > 0) || !Number.isFinite(metres)) return 0
  return ((metres % length) + length) % length
}

/** Forward distance from `from` to `to` travelling in the racing direction. */
export function forwardDistance(from: number, to: number, length: number): number {
  return wrapDistance(to - from, length)
}

export function validCircuitDistance(value: number | null, length: number): value is number {
  return value != null && Number.isFinite(value) && Number.isFinite(length) && length > 0 &&
    value >= -length && value <= length * 2
}

export function sectorAt(metres: number, layout: TrackLayout): 0 | 1 | 2 {
  const d = wrapDistance(metres, layout.lengthM)
  return d < layout.sectorStartsM[1] ? 0 : d < layout.sectorStartsM[2] ? 1 : 2
}

function insideZone(zone: TrackLayoutZone, metres: number): boolean {
  return zone.endM >= zone.startM
    ? metres >= zone.startM && metres <= zone.endM
    : metres >= zone.startM || metres <= zone.endM
}

export function drsZoneAt(metres: number, layout: TrackLayout): number | null {
  const d = wrapDistance(metres, layout.lengthM)
  const index = layout.drsZones.findIndex(zone => insideZone(zone, d))
  return index >= 0 ? index + 1 : null
}

export function pitDistance(metres: number, layout: TrackLayout): number | null {
  if (layout.pitEntryM == null) return null
  return forwardDistance(wrapDistance(metres, layout.lengthM), layout.pitEntryM, layout.lengthM)
}

/** True when the calibrated layout disagrees with the length the game reported. */
export function trackLengthDisagrees(sessionLengthM: number, layout: TrackLayout): boolean {
  if (!(sessionLengthM > 0) || !(layout.lengthM > 0)) return false
  return Math.abs(sessionLengthM - layout.lengthM) / layout.lengthM > 0.01
}
