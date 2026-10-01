import type { RaceState } from '@shared/types/state'
import { validCircuitDistance, getTrackLayout, trackLengthDisagrees, sectorAt } from '@shared/util/trackLayout'
import { sampleAge } from './SpatialAwareness'

const WHEELS = ['fl', 'fr', 'rl', 'rr'] as const
const BINS = 16
type Reading = { surface: number[]; core: number[]; throttle: number; brake: number; speed: number }
const mean = (values: number[]) => values.reduce((sum, n) => sum + n, 0) / values.length
const baseline = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 4)]

/** Bounded, comparable lap evidence; heat correlation is not proof of a driving fault. */
export function tyreThermalReport(state: RaceState, history: readonly RaceState[], now = Date.now()) {
  const p = state.player, length = state.session.trackLengthM
  const laps = new Map<number, Map<number, Reading[]>>()
  let later: RaceState | undefined
  const seen = new Set<number>()
  // Work backwards: never carry evidence across a stop, rollback or discontinuity.
  for (const s of history.slice(-600).reverse()) {
    const q = s.player
    const age = sampleAge(q.carTelemetryUpdatedAt, now)
    const lapAge = sampleAge(q.lapDataUpdatedAt, now)
    const temperatures = [...WHEELS.map(w => q.tyres.surfaceTempC[w]), ...WHEELS.map(w => q.tyres.innerTempC[w])]
    if (s.session.sessionUID !== state.session.sessionUID || s.session.trackId !== state.session.trackId ||
      s.session.trackLengthM !== length ||
      s.packetFormat !== state.packetFormat || q.carIndex !== p.carIndex ||
      s.flashbackActive || q.pitStatus !== 0 || !q.onTrack || q.currentLapInvalid ||
      s.session.isSafetyCar || s.session.isVirtualSafetyCar || s.session.isRedFlag ||
      q.tyres.compound !== p.tyres.compound || q.pitStopCount !== p.pitStopCount ||
      q.tyres.rawCompoundId !== p.tyres.rawCompoundId || s.weather.isRaining !== state.weather.isRaining ||
      q.lap - q.tyres.ageLaps !== p.lap - p.tyres.ageLaps ||
      Math.abs(s.weather.trackTempC - state.weather.trackTempC) > 3 ||
      Math.floor(s.weather.rainPercentage / 10) !== Math.floor(state.weather.rainPercentage / 10) ||
      age == null || age > 300000 || lapAge == null || lapAge > 300000 ||
      Math.abs(q.carTelemetryUpdatedAt! - q.lapDataUpdatedAt!) > 750 ||
      !validCircuitDistance(q.distanceFromStartM, length) ||
      temperatures.some(t => !Number.isFinite(t) || t <= 0 || t > 250) ||
      !Number.isFinite(q.speedKmh) || q.speedKmh < 40 || q.speedKmh > 400 ||
      !Number.isFinite(q.throttle) || q.throttle < 0 || q.throttle > 1 ||
      !Number.isFinite(q.brake) || q.brake < 0 || q.brake > 1) break
    if (later) {
      const dt = (later.player.lapDataUpdatedAt! - q.lapDataUpdatedAt!) / 1000
      const progress = (later.player.lap - q.lap) * length + later.player.distanceFromStartM! - q.distanceFromStartM!
      if (s.session.overallFrameIdentifier > later.session.overallFrameIdentifier || dt < 0 || dt > 3 ||
        progress < -5 || progress > 120 * dt + 20) break
    }
    later = s
    if (seen.has(q.carTelemetryUpdatedAt!)) continue
    seen.add(q.carTelemetryUpdatedAt!)
    const bin = Math.min(BINS - 1, Math.floor(q.distanceFromStartM! / length * BINS))
    const bins = laps.get(q.lap) ?? new Map<number, Reading[]>()
    const values = bins.get(bin) ?? []
    values.push({ surface: WHEELS.map(w => q.tyres.surfaceTempC[w]), core: WHEELS.map(w => q.tyres.innerTempC[w]),
      throttle: q.throttle, brake: q.brake, speed: q.speedKmh })
    bins.set(bin, values)
    laps.set(q.lap, bins)
  }
  const comparable = [...laps].filter(([lap, bins]) => lap < p.lap && bins.size >= 12)
    .map(([lap, bins]) => {
      const all = [...bins.values()].flat()
      return { lap, bins, surfaceBase: WHEELS.map((_, i) => baseline(all.map(r => r.surface[i]))),
        coreBase: WHEELS.map((_, i) => baseline(all.map(r => r.core[i]))) }
    })
  const layout = getTrackLayout(state.session.trackId)
  const mapped = layout && trackLengthDisagrees(length, layout) === false
  const segments = Array.from({ length: BINS }, (_, bin) => {
    const evidence = comparable.flatMap(lap => {
      const values = lap.bins.get(bin)
      if (!values || values.length < 2) return []
      const surface = WHEELS.map((_, i) => mean(values.map(r => r.surface[i])))
      const core = WHEELS.map((_, i) => mean(values.map(r => r.core[i])))
      const heatWheels = WHEELS.filter((_, i) => surface[i] - lap.surfaceBase[i] >= 12 && core[i] - lap.coreBase[i] >= 3)
      return [{ lap: lap.lap, samples: values.length, surfaceC: surface, coreC: core, heatWheels,
        throttle: mean(values.map(r => r.throttle)), brake: mean(values.map(r => r.brake)),
        speedKmh: mean(values.map(r => r.speed)) }]
    })
    const repeated = WHEELS.filter(w => evidence.filter(e => e.heatWheels.includes(w)).length >= 2)
    const front = repeated.some(w => w === 'fl' || w === 'fr')
    const rear = repeated.some(w => w === 'rl' || w === 'rr')
    return { startM: Math.round(bin / BINS * length), endM: Math.round((bin + 1) / BINS * length),
      sector: mapped ? `S${sectorAt((bin + 0.5) / BINS * length, layout) + 1}` : null,
      repeatedHeatWheels: repeated, evidence,
      adjustment: front && rear ? 'Reduce sustained load in this segment; preserve exit traction.'
        : front ? 'Try a cleaner entry and less steering scrub; check pace effect next lap.'
        : rear ? 'Try progressive throttle and, if traction is limited, a short shift; check pace effect next lap.' : null }
  }).filter(s => s.evidence.length >= 2)
  const latestAge = sampleAge(p.carTelemetryUpdatedAt, now)
  const fresh = !state.flashbackActive && p.onTrack && p.pitStatus === 0 && latestAge != null && latestAge <= 2500
  return { available: fresh && comparable.length >= 2, telemetryAgeMs: latestAge, wheelOrder: WHEELS,
    completedComparableLaps: comparable.map(l => l.lap), segments: fresh ? segments : [],
    method: 'Last 5 minutes, at most 600 samples; 16 distance segments, >=12 covered segments per completed lap and >=2 samples per reported segment. Repeated relative heat requires surface >=12C and core >=3C above that lap wheel lower quartile on >=2 laps. Heuristic correlation, NOT an absolute overheating limit or proven corner cause.',
    guidance: 'No surveyed turn numbers. Heat can lag the causal corner. Use sector/metres, controls and geometry; propose a small test, not a fabricated fault. In recovery segments gradually restore normal push only after core trend recovers; low surface temperature alone is not permission to push harder. No lap-time benefit is proven by this report.' }
}
