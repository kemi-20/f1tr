import type { LapPhase } from '@shared/types/state'

interface Sample { distance: number; time: number }
interface Run {
  context?: string
  lap: number
  phase: LapPhase
  samples: Sample[]
  reference: Sample[]
  referenceTime: number
  clean: boolean
  slowSince: number | null
  lastTime: number
}
interface Input {
  car: number; lap: number; distance: number; time: number; status: number | undefined
  pit: number; invalid: boolean; lastLap: number | null; neutralised: boolean
  context?: string
}

/** Compare the same track section with an observed valid push lap, never corner speed alone. */
export class LapPhaseTracker {
  private cars = new Map<number, Run>()

  reset(): void { this.cars.clear() }

  observe(input: Input): { phase: LapPhase; evidence: string } {
    const { car, lap, distance, time, status, pit, invalid, lastLap, neutralised } = input
    if (!Number.isInteger(car) || car < 0 || car > 23 || !Number.isFinite(time) || time < 0 ||
        !Number.isFinite(distance) || distance < 0 || distance > 1) return { phase: 'unknown', evidence: 'Missing lap telemetry' }
    let run = this.cars.get(car)
    if (run && (input.context !== run.context || lap < run.lap || (lap === run.lap && time < run.lastTime - 1))) run = undefined
    if (!run || lap !== run.lap) {
      let reference = run?.reference ?? []
      let referenceTime = run?.referenceTime ?? Infinity
      if (run && lap === run.lap + 1 && run.clean && run.samples[0]?.distance < 0.03 &&
          run.samples.at(-1)!.distance > 0.95 && lastLap != null && lastLap > 0 && lastLap < referenceTime) {
        reference = [{ distance: 0, time: 0 }, ...run.samples, { distance: 1, time: lastLap }]
        referenceTime = lastLap
      }
      run = { lap, context: input.context, phase: 'unknown', samples: [], reference, referenceTime,
        clean: distance < 0.03, slowSince: null, lastTime: time }
      this.cars.set(car, run)
    }
    run.lastTime = time
    let phase: LapPhase = status === 0 ? 'garage' : pit !== 0 || status === 2 ? 'in' :
      status === 3 ? 'out' : status === 1 ? 'flying' : 'unknown'
    let evidence = `Game driverStatus=${status ?? 'unavailable'}; pitStatus=${pit}`
    const last = run.samples.at(-1)
    if (!last || distance - last.distance >= 0.005) run.samples.push({ distance, time })
    if (run.samples.length > 202) run.samples.shift()
    if (!neutralised && pit === 0 && (status === 1 || status === 4)) {
      const before = [...run.samples].reverse().find(sample => time - sample.time >= 8)
      const t0 = before && interpolate(run.reference, before.distance)
      const t1 = interpolate(run.reference, distance)
      // Eight seconds of comparable section pace and four seconds of persistence
      // avoid classifying a single braking event or brief traffic as a cooldown.
      const slow = before && t0 != null && t1 != null && t1 > t0 &&
        time - before.time > (t1 - t0) * 1.45 + 2
      run.slowSince = slow ? run.slowSince ?? time : null
      if (run.phase === 'cooling' || (run.slowSince != null && time - run.slowSince >= 4)) {
        phase = 'cooling'
        evidence = 'Inferred slow/aborted lap: sustained loss against same sections of an observed valid flying lap; intent unconfirmed'
      }
    }
    if (invalid || neutralised || phase !== 'flying') run.clean = false
    run.phase = phase
    return { phase, evidence }
  }
}

function interpolate(samples: Sample[], distance: number): number | null {
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i]
    if (a.distance <= distance && b.distance >= distance && b.distance > a.distance) {
      return a.time + (b.time - a.time) * (distance - a.distance) / (b.distance - a.distance)
    }
  }
  return null
}
