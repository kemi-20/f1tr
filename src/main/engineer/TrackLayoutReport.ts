import type { RaceState } from '@shared/types/state'
import { getTrackLayout, sectorAt, drsZoneAt, pitDistance, trackLengthDisagrees, wrapDistance } from '@shared/util/trackLayout'
import { sessionKind } from '@shared/util/sessionKind'
import { relativeMotion, relativePosition, sampleAge, validCircuitDistance } from './SpatialAwareness'
import { pitRejoinTraffic, type RejoinScenario } from './PitRejoin'

export const TRACK_LAYOUT_SECTIONS = ['summary', 'zones', 'geometry', 'positions', 'rejoin', 'all']
export interface TrackLayoutArgs extends RejoinScenario { section?: string }

/** Static map geometry and live telemetry have separate sources and freshness. */
export function readTrackLayout(state: RaceState, args: TrackLayoutArgs, now = Date.now(), history: readonly RaceState[] = []) {
  const section = args.section ?? 'all'
  if (section === 'rejoin') return { queriedAt: now, result: pitRejoinTraffic(state, args, now) }
  const layout = getTrackLayout(state.session.trackId)
  const mismatch = layout ? trackLengthDisagrees(state.session.trackLengthM, layout) : null
  const base = {
    track: layout?.name ?? state.session.trackName,
    trackId: state.session.trackId,
    sessionKind: sessionKind(state.session),
    sessionUID: state.session.sessionUID,
    frame: state.session.overallFrameIdentifier,
    queriedAt: now,
    telemetryAgeMs: sampleAge(state.lastPacketMs, now),
    officialLengthM: layout?.lengthM ?? null,
    sessionReportedLengthM: state.session.trackLengthM,
    lengthMismatch: mismatch,
    referenceLengthDifferenceM: layout ? state.session.trackLengthM - layout.lengthM : null,
    zoneMappingAccuracy: 'Approximate reference: length differences up to 1% are tolerated, not exact calibration. Locations near zone boundaries may be ambiguous; use live game flags for availability.',
    mapAvailable: layout != null,
    definitions: {
      physical: 'LapData metres on the SESSION racing loop. Forward/backward are both paths; shortest signed arc: positive=nearest ahead, negative=nearest behind. Not a time gap, travel direction or closing speed. Pit/garage/stale pairs are not comparable.',
      timing: 'raceTimingGapToPlayerS: positive=rival leads, negative=rival trails; null outside races or when chain unavailable. bestLapDeltaToPlayerS: rival best minus player best, negative=faster; independent of track location. rankingDisplayDeltaS uses the UI sign: negative=ahead/faster.',
      reference: 'Best-lap comparison requires a recorded player best. No time is null, not zero. Position 1 on a practice timing sheet is not the car physically ahead.',
      geometry: 'Static reference derived from bundled track JSON, not live telemetry. Ordered world X/Z polyline covers the full loop at reduced resolution. No surveyed corner numbers or road width. Never infer side-by-side clearance from it. Live LapData remains the physical-distance source even if map calibration disagrees.'
    }
  }
  const summary = { sectorStartsM: layout?.sectorStartsM ?? null, pitEntryM: layout?.pitEntryM ?? null,
    pitExitM: layout?.pitExitM ?? null, pitLaneLengthM: layout?.pitLaneLengthM ?? null }
  const zones = { drsZones: layout?.drsZones ?? [], activeAeroFullZones: layout?.activeAeroFullZones ?? [],
    activeAeroPartialZones: layout?.activeAeroPartialZones ?? [], overtakePointsM: layout?.overtakePointsM ?? [],
    marshalZones: layout?.marshalZones ?? [] }
  const geometry = layout ? { source: 'bundled track JSON, uniformly resampled full circuit',
    axes: ['worldX', 'worldZ'], pointCount: layout.line.length, line: layout.line,
    metresPerWorldUnit: layout.metresPerUnit,
    nominalSampleSpacingM: layout.lengthM / (layout.line.length - 1),
    closed: true, startFinishPoint: layout.line[0] } : null
  if (section === 'summary') return { ...base, ...summary }
  if (section === 'zones') return { ...base, ...zones }
  if (section === 'geometry') return { ...base, geometry }

  const describe = (carIndex: number, distanceM: number | null, ts: number | undefined, pitStatus: number) => {
    const age = sampleAge(ts, now)
    const fresh = !state.flashbackActive && age != null && age <= 2500
    const valid = fresh && validCircuitDistance(distanceM, state.session.trackLengthM)
    const d = valid ? wrapDistance(distanceM, state.session.trackLengthM) : null
    const point = state.trackPositions.find(p => p.carIndex === carIndex)
    const motionAge = sampleAge(point?.motionUpdatedAt, now)
    const motionFresh = !state.flashbackActive && motionAge != null && motionAge <= 2500
    const speedAge = sampleAge(point?.speedUpdatedAt, now)
    const mapped = d != null && layout && mismatch === false && pitStatus === 0
    return { carIndex, distanceFromStartM: d, lapDataAgeMs: age,
      worldPosition: motionFresh && Number.isFinite(point?.worldX) && Number.isFinite(point?.worldZ)
        ? { x: point!.worldX, y: point!.worldY ?? null, z: point!.worldZ } : null,
      motionAgeMs: motionAge,
      speedKmh: !state.flashbackActive && speedAge != null && speedAge <= 2500 &&
        Number.isFinite(point?.speedKmh) ? point!.speedKmh : null,
      speedAgeMs: speedAge,
      sector: mapped ? `S${sectorAt(d, layout) + 1}` : null,
      drsZone: mapped ? drsZoneAt(d, layout) : null,
      metresToPitEntry: mapped ? pitDistance(d, layout) : null,
      metresToStartFinish: d == null ? null : (state.session.trackLengthM - d) % state.session.trackLengthM }
  }
  const p = state.player
  const positions = {
    player: { ...describe(p.carIndex, p.distanceFromStartM, p.lapDataUpdatedAt, p.pitStatus),
      lap: p.lap, racePosition: p.position > 0 ? p.position : null, onTrack: p.onTrack && p.pitStatus === 0,
      totalDistanceM: p.totalDistanceM, pitStatus: p.pitStatus, lapPhase: p.lapPhase ?? 'unknown',
      lapPhaseEvidence: p.lapPhaseEvidence ?? null, currentLapInvalid: p.currentLapInvalid ?? null,
      bestLapTimeS: p.bestLapTimeS },
    rivals: Object.values(state.rivals).filter(r => r.carIndex !== p.carIndex).slice(0, 24).map(r => ({
      ...relativePosition(state, r, now),
      ...describe(r.carIndex, r.distanceFromStartM, r.lapDataUpdatedAt, r.pitStatus),
      totalDistanceM: r.totalDistanceM, lap: r.lap, pitStatus: r.pitStatus,
      lastLapTimeS: r.lastLapTimeS, currentLapTimeS: r.currentLapTimeS,
      motion: relativeMotion(history, r.carIndex, now)
    }))
  }
  if (section === 'positions') return { ...base, positions }
  return { ...base, ...summary, ...zones, geometry, positions }
}
