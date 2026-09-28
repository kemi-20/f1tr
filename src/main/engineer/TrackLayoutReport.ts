import type { RaceState } from '@shared/types/state'
import type { TrackLayout } from '@shared/util/trackLayout'
import {
  distanceToNextZone, drsZoneAt, getTrackLayout, nearestOvertakePoint, pitDistance,
  sectorAt, trackLengthDisagrees, wrapDistance
} from '@shared/util/trackLayout'

export const TRACK_LAYOUT_SECTIONS = ['summary', 'zones', 'positions', 'all']

export interface TrackLayoutArgs {
  section?: string
}

/**
 * Track reference for the engineer: calibrated circuit data in official lap metres,
 * anchored to the same coordinate space as the Motion packet.
 */
export function readTrackLayout(state: RaceState, args: TrackLayoutArgs): unknown {
  const section = typeof args.section === 'string' ? args.section : 'all'
  const layout = getTrackLayout(state.session.trackId)
  if (!layout) return { unavailable: 'no calibrated layout for this track id', trackId: state.session.trackId }

  const base = {
    track: layout.name,
    trackId: state.session.trackId,
    officialLengthM: layout.lengthM,
    sessionReportedLengthM: state.session.trackLengthM,
    lengthMismatch: trackLengthDisagrees(state.session.trackLengthM, layout),
    note: 'distanceFromStartM and trackRelativeSeparationM describe physical circuit location. totalDistanceM and raceDistanceSeparationM describe cumulative race progress, including whole laps. Race position and timing-chain gap are separate again. A zone whose end is below its start wraps the line.'
  }

  if (section === 'summary') {
    return { ...base, sectorStartsM: layout.sectorStartsM, pitEntryM: layout.pitEntryM,
      pitExitM: layout.pitExitM, pitLaneLengthM: layout.pitLaneLengthM }
  }

  if (section === 'zones') {
    return { ...base, drsZones: layout.drsZones, activeAeroFullZones: layout.activeAeroFullZones,
      activeAeroPartialZones: layout.activeAeroPartialZones, overtakePointsM: layout.overtakePointsM,
      marshalZoneCount: layout.marshalZones.length }
  }

  const positions = {
    player: describeCar('PLAYER', state.player.distanceFromStartM, state.player.totalDistanceM,
      state.player.lap, state.player.speedKmh, layout),
    rivals: Object.values(state.rivals)
      .filter(r => r.carIndex !== state.player.carIndex && validLapDistance(r.distanceFromStartM, layout.lengthM))
      .map(r => ({
        ...describeCar(r.name || r.driverCode || `car${r.carIndex}`, r.distanceFromStartM,
          r.totalDistanceM, r.lap, state.trackPositions.find(p => p.carIndex === r.carIndex)?.speedKmh ?? 0, layout),
        carIndex: r.carIndex,
        racePosition: r.position,
        pitStatus: r.pitStatus,
        lapPhase: r.lapPhase ?? null,
        lapDifference: r.lap - state.player.lap,
        raceDistanceSeparationM: r.separationFromPlayerM != null ? Math.round(r.separationFromPlayerM) : null,
        trackRelativeSeparationM: r.trackRelativeSeparationM != null ? Math.round(r.trackRelativeSeparationM) : null
      }))
  }
  if (section === 'positions') return { ...base, positions }

  return {
    ...base,
    sectorStartsM: layout.sectorStartsM,
    pitEntryM: layout.pitEntryM,
    pitExitM: layout.pitExitM,
    drsZones: layout.drsZones,
    overtakePointsM: layout.overtakePointsM,
    positions
  }
}

function describeCar(name: string, distanceM: number | null, totalM: number | null,
  lap: number, speedKmh: number, layout: TrackLayout) {
  if (distanceM == null) return { name, distanceFromStartM: null, note: 'position unavailable' }
  if (!validLapDistance(distanceM, layout.lengthM)) {
    return { name, distanceFromStartM: null, note: 'invalid lap distance' }
  }
  const d = wrapDistance(distanceM, layout.lengthM)
  return {
    name,
    distanceFromStartM: Math.round(d),
    lap,
    totalDistanceM: totalM != null ? Math.round(totalM) : null,
    sector: `S${sectorAt(d, layout) + 1}`,
    lapPercent: Math.round((d / layout.lengthM) * 100),
    drsZone: drsZoneAt(d, layout),
    metresToNextDrsZone: distanceToNextZone(d, layout.drsZones, layout.lengthM),
    metresToPitEntry: pitDistance(d, layout),
    nearestOvertakePointM: nearestOvertakePoint(d, layout),
    speedKmh: speedKmh > 0 ? Math.round(speedKmh) : null,
    speedMPerS: speedKmh > 20 ? Math.round((speedKmh / 3.6) * 10) / 10 : null
  }
}

function validLapDistance(distanceM: number | null, lengthM: number): distanceM is number {
  return distanceM != null && Number.isFinite(distanceM) &&
    distanceM >= -lengthM && distanceM <= lengthM * 2
}
