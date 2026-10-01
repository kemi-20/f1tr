import type { RaceState } from '@shared/types/state'
import { forwardDistance, validCircuitDistance, wrapDistance } from '@shared/util/trackLayout'
import { sampleAge } from './SpatialAwareness'

const BINS = 32
type Point = { ts: number; distance: number; frame: number; lap: number }
type Profile = { previous?: Point; bins: number[][]; updatedAt: number }

/** Bounded racing-route observations; sampled speed ranges are not confidence bounds. */
export class CircuitPace {
  private key = ''
  private cars = new Map<number, Profile>()

  reset(): void { this.key = ''; this.cars.clear() }

  observe(state: RaceState, now: number): void {
    const s = state.session, length = s.trackLengthM
    const key = JSON.stringify([s.sessionUID, s.sessionType, s.trackId, length, state.weather.weatherCode])
    if (this.key !== key) { this.reset(); this.key = key }
    if (state.flashbackActive || s.trackFlag !== 'green' || s.isSafetyCar || s.isVirtualSafetyCar ||
        s.isRedFlag || !Number.isFinite(length) || length <= 0) { this.cars.clear(); return }
    const cars = [state.player, ...Object.values(state.rivals).filter(r => r.carIndex !== state.player.carIndex)]
    for (const car of cars.slice(0, 24)) {
      const age = sampleAge(car.lapDataUpdatedAt, now)
      if (!Number.isInteger(car.carIndex) || car.carIndex < 0 || car.carIndex > 23) continue
      if (car.pitStatus !== 0 || car.currentLapInvalid ||
          ['out', 'in', 'cooling', 'garage'].includes(car.lapPhase ?? '') ||
          ('onTrack' in car ? !car.onTrack : car.status !== 'running') ||
          age == null || age > 2500 || !validCircuitDistance(car.distanceFromStartM, length)) {
        this.cars.delete(car.carIndex); continue
      }
      let profile = this.cars.get(car.carIndex)
      if (!profile) {
        profile = { bins: Array.from({ length: BINS }, () => []), updatedAt: now }
        this.cars.set(car.carIndex, profile)
      }
      const point: Point = { ts: car.lapDataUpdatedAt!, distance: wrapDistance(car.distanceFromStartM!, length),
        frame: s.overallFrameIdentifier, lap: car.lap }
      const prev = profile.previous
      if (prev?.ts === point.ts) continue
      profile.previous = point
      if (!prev) continue
      const dt = (point.ts - prev.ts) / 1000
      const advance = forwardDistance(prev.distance, point.distance, length)
      if (dt < 0.1 || dt > 2 || point.frame < prev.frame || point.lap < prev.lap ||
          point.lap > prev.lap + 1 || advance < 2 || advance > Math.min(120 * dt, length / BINS)) {
        profile.bins = Array.from({ length: BINS }, () => [])
        continue
      }
      const bin = Math.floor(wrapDistance(prev.distance + advance / 2, length) / length * BINS)
      profile.bins[bin].push(advance / dt)
      profile.bins[bin] = profile.bins[bin].slice(-8)
      profile.updatedAt = now
    }
  }

  project(carIndex: number, distance: number, length: number, minS: number, maxS: number, now: number) {
    const profile = this.cars.get(carIndex)
    if (!profile || now - profile.updatedAt > 2500 || now < profile.updatedAt ||
        profile.bins.some(bin => bin.length < 3)) return null
    const travel = (seconds: number, fast: boolean): number | null => {
      let d = wrapDistance(distance, length), remaining = seconds, moved = 0
      const width = length / BINS
      // Finite horizon and minimum segment width bound the work, even for unusual tracks.
      for (let i = 0; i < 10_000 && remaining > 0; i++) {
        const bin = Math.min(BINS - 1, Math.floor(d / width))
        const values = profile.bins[bin]
        const speed = fast ? Math.max(...values) * 1.1 : Math.min(...values) * 0.9
        const segment = Math.min(length - d, (bin + 1) * width - d)
        const step = Math.min(segment, speed * remaining)
        moved += step
        remaining -= step / speed
        d += step
        if (d >= length - 1e-6) d = 0
        else if (segment - step < 1e-6) d = (bin + 1) * width
      }
      return remaining > 1e-6 ? null : moved
    }
    const low = travel(minS, false), high = travel(maxS, true)
    return low == null || high == null ? null : { low, high, bins: BINS,
      minimumSamplesPerBin: Math.min(...profile.bins.map(bin => bin.length)),
      model: 'observed segment speed range with +/-10% sensitivity, not a confidence bound' }
  }
}
