import type { RaceState } from '@shared/types/state'
import type { TriggerFiring, TriggerConfig } from '@shared/types/triggers'
import type { Priority } from '@shared/types/audio'
import { Cooldown } from './Cooldown'
import { logger } from '../logging/Logger'
import { lapsToFlag, raceFuelMargin } from '@shared/util/raceDistance'
import { holdQualifyingRadio, isTimedRunSession, qualifyingYieldGeometry } from '@shared/util/lapPhase'
import { validCircuitDistance } from '@shared/util/trackLayout'
import { sessionKind } from '@shared/util/sessionKind'
import { estimateClosing, type DistanceSample } from '../engineer/ClosingEstimate'
import { relativePosition } from '../engineer/SpatialAwareness'

/**
 * TriggerEngine — evaluates rule conditions each tick + on events, applies
 * cooldown/hysteresis/suppression, and emits TriggerFiring objects that drive
 * the EngineerService (and downstream TTS audio preemption).
 *
 * Rules fall into three kinds:
 *   - threshold: edge-triggered via hysteresis (fires only on upward crossing)
 *   - event:     fires on a discrete occurrence (e.g. SC deployed, packet 3 event)
 *   - heartbeat: a slow floor so the engineer still "checks in" during quiet periods
 */
export class TriggerEngine {
  private cooldown: Cooldown
  private lastHeartbeatMs = 0
  // hysteresis state
  private tyreWearLevel = 0 // highest level currently "live" (0/1/2/3)
  private tyreHotActive = false
  private tyreColdActive = false
  private defendActive = false
  private attackActive = false
  private rainImminentActive = false
  private fuelLowActive = false
  private positionAtLapStart: number | null = null
  private lastLap = 0
  private lastTyreAgeLaps = -1
  private lastTyreCompound = ''
  private flashbackUntilMs = 0
  private sessionUID = ''
  private reviewLap = 0
  private approachingCars = new Map<number, DistanceSample[]>()
  private onFiring: (f: TriggerFiring) => void

  constructor(
    private config: TriggerConfig,
    onFiring: (f: TriggerFiring) => void
  ) {
    this.cooldown = new Cooldown(config)
    this.onFiring = onFiring
  }

  /** Hot-reload config (from UI settings changes). Resets cooldown state so the new
   *  threshold values apply immediately instead of being held back by old timestamps. */
 setConfig(config: TriggerConfig): void {
  this.config = config
  this.cooldown.setConfig(config)
    // defensive: ensure tyre wear thresholds are sorted ascending so
    // the loop in evalTyreWear assigns correct levels
    if (config.tyreWearLevels) {
      config.tyreWearLevels = [...config.tyreWearLevels].sort((a, b) => a - b)
    }
   // reset hysteresis flags so new thresholds take effect immediately
    this.tyreWearLevel = 0
    this.tyreHotActive = false
    this.tyreColdActive = false
    this.defendActive = false
    this.attackActive = false
    this.rainImminentActive = false
    this.fuelLowActive = false
    this.positionAtLapStart = null
    this.lastLap = 0
    this.lastTyreAgeLaps = -1
    this.lastTyreCompound = ''
    this.lastHeartbeatMs = Date.now()
    this.approachingCars.clear()
  }

  /** Called when the aggregator has updated state (throttled, e.g. once per tick). */
  evaluate(state: RaceState): void {
    if (this.sessionUID !== state.session.sessionUID) {
      this.sessionUID = state.session.sessionUID
      this.setConfig(this.config)
      this.reviewLap = state.player.lap
    }
    if (this.inFlashback()) return

    this.evalQualifyingTraffic(state)
    this.evalTyreWear(state)
    this.evalTyreTemp(state)
    this.evalDefendAttack(state)
    this.evalLowFuel(state)
    this.evalRain(state)
    this.evalPositionChange(state)
    this.evalLapReview(state)
    this.evalHeartbeat(state)
  }

  /** Called when a discrete event packet arrives (safety car, fastest lap, penalty...). */
  onEvent(state: RaceState, ev: { type: string; carIndex?: number; text: string }): void {
    if (this.inFlashback()) return
    switch (ev.type) {
      case 'safetyCar':
        if (sessionKind(state.session) === 'qualifying') break
        this.tryFire(state, 'safety_car', 'critical', 'sc_active', `Safety Car: ${ev.text}`)
        break
      case 'vsc':
        if (sessionKind(state.session) === 'qualifying') break
        this.tryFire(state, 'vsc', 'critical', 'vsc_active', `Virtual Safety Car: ${ev.text}`)
        break
      case 'redFlag':
        this.tryFire(state, 'red_flag', 'critical', 'red_flag', `Red flag: ${ev.text}`)
        break
      case 'fastestLap':
        this.tryFire(state, 'fastest_lap', 'normal', 'fastest_lap', ev.text)
        break
      case 'yellowFlag':
        if (sessionKind(state.session) === 'qualifying') {
          this.tryFire(state, ev.type, 'normal', ev.type,
            `${ev.text}. Game qualifying: yellow alone does not require slowing down. Do not invent SC/VSC or a delta; warn about avoidance only with actual traffic/incident evidence.`)
          break
        }
        this.tryFire(state, ev.type, 'critical', ev.type, ev.text)
        break
      case 'blueFlag':
      case 'greenFlag':
        this.tryFire(state, ev.type, ev.type === 'greenFlag' ? 'high' : 'critical', ev.type, ev.text)
        break
      case 'pitEntered':
      case 'pitExited':
      case 'damage':
      case 'collision':
        if (ev.carIndex === state.player.carIndex) this.tryFire(state, ev.type, 'high', ev.type, ev.text)
        break
      case 'penalty':
        if (ev.carIndex === state.player.carIndex) {
          this.tryFire(state, 'penalty', 'normal', 'penalty', `Penalty: ${ev.text}`)
        }
        break
      case 'warning':
        if (ev.carIndex === state.player.carIndex) {
          this.tryFire(state, 'warning', 'normal', 'warning', ev.text)
        }
        break
      default:
        break
    }
  }

  /** Detect flashback window (overallFrameIdentifier regression) — suppress triggers briefly. */
  private inFlashback(): boolean {
    return Date.now() < this.flashbackUntilMs
  }

  isFlashbackActive(): boolean {
    return this.inFlashback()
  }

  /** Called externally when a flashback is detected (frame id regressed). */
  noteFlashback(): void {
    this.approachingCars.clear()
    this.reviewLap = 0
    this.flashbackUntilMs = Date.now() + 3000
    // reset all edge states so we don't double-fire on the resumed timeline
    this.tyreWearLevel = 0
    this.tyreHotActive = false
    this.tyreColdActive = false
    this.defendActive = false
    this.attackActive = false
    this.rainImminentActive = false
    this.fuelLowActive = false
    this.positionAtLapStart = null
    this.lastLap = 0
    this.lastTyreAgeLaps = -1
    this.lastTyreCompound = ''
    this.lastHeartbeatMs = Date.now()
    logger.info('flashback detected — triggers suppressed for 3s, states reset')
  }

  // ───────────────────────── threshold rules ─────────────────────────

  private evalTyreWear(state: RaceState): void {
    const tyres = state.player.tyres
    // A new set re-arms the thresholds. Tyre age going backwards (or a compound change)
    // is the reliable signal — wear alone isn't, because a scrubbed set can go on with
    // 25% wear and would otherwise never produce the 50/70/90% calls again.
    if (tyres.ageLaps < this.lastTyreAgeLaps || tyres.compound !== this.lastTyreCompound) {
      this.tyreWearLevel = 0
    }
    this.lastTyreAgeLaps = tyres.ageLaps
    this.lastTyreCompound = tyres.compound

    const wear = Math.max(
      tyres.wear.rl,
      tyres.wear.rr,
      tyres.wear.fl,
      tyres.wear.fr
    )
    const levels = this.config.tyreWearLevels // e.g. [50,70,90]
    let newLevel = 0
    for (let i = 0; i < levels.length; i++) {
      if (wear >= levels[i]) newLevel = i + 1
    }
    // hysteresis: only fire when crossing UP to a higher level than currently live
    if (newLevel > this.tyreWearLevel && newLevel > 0) {
      const idx = Math.min(newLevel - 1, levels.length - 1)
      const threshold = levels[idx]
      const prio: Priority = newLevel >= 3 ? 'high' : newLevel === 2 ? 'normal' : 'low'
      const fired = this.tryFire(
        state,
        `tyre_wear_${threshold}`,
        prio,
        `tyre_wear_${threshold}`,
        `Tyre wear reached ${Math.round(wear)}% (threshold ${threshold}%)`
      )
      // Only latch the level once the call actually went out — otherwise a cooldown
      // rejection would silently swallow this threshold for the rest of the stint.
      if (fired) this.tyreWearLevel = Math.max(this.tyreWearLevel, newLevel)
    }
    // fallback re-arm if wear drops a lot without an age/compound change
    if (wear < 20) this.tyreWearLevel = 0
  }

  private evalTyreTemp(state: RaceState): void {
    // Tyre operating window is based on INNER/core temperature, not surface temperature.
    const innerMax = Math.max(
      state.player.tyres.innerTempC.rl,
      state.player.tyres.innerTempC.rr,
      state.player.tyres.innerTempC.fl,
      state.player.tyres.innerTempC.fr
    )
    const innerMin = minPositive(
      state.player.tyres.innerTempC.rl,
      state.player.tyres.innerTempC.rr,
      state.player.tyres.innerTempC.fl,
      state.player.tyres.innerTempC.fr
    )
    if (!this.tyreHotActive && innerMax > this.config.tyreHotC) {
      if (this.tryFire(state, 'tyre_hot', 'normal', 'tyre_hot', `Tyre inner/core temperature high (${Math.round(innerMax)}°C)`)) {
        this.tyreHotActive = true
      }
    } else if (this.tyreHotActive && innerMax < this.config.tyreHotC - 5) {
      this.tyreHotActive = false
    }
    if (!this.tyreColdActive && innerMin != null && innerMin < this.config.tyreColdC) {
      if (this.tryFire(state, 'tyre_cold', 'normal', 'tyre_cold', `Tyre inner/core temperature low (${Math.round(innerMin)}°C)`)) {
        this.tyreColdActive = true
      }
    } else if (this.tyreColdActive && innerMin != null && innerMin > this.config.tyreColdC + 5) {
      this.tyreColdActive = false
    }
  }

  private evalDefendAttack(state: RaceState): void {
    if (!isRaceSession(state) || state.player.pitStatus !== 0 || state.session.isSafetyCar ||
      state.session.isVirtualSafetyCar || state.session.isRedFlag || ['yellow', 'red', 'blue'].includes(state.session.trackFlag)) {
      this.defendActive = false
      this.attackActive = false
      return
    }

    const playerPos = state.player.position
    const ahead = Object.values(state.rivals).find((r) => r.position === playerPos - 1 && r.status === 'running' && r.pitStatus === 0)
    const behind = Object.values(state.rivals).find((r) => r.position === playerPos + 1 && r.status === 'running' && r.pitStatus === 0)
    // defending: car behind close (their gap to the car in front = gap to us)
    const behindGap = behind ? relativePosition(state, behind).raceTimingGapToPlayerS : null
    if (behind && behindGap != null && behindGap < 0) {
      const gap = -behindGap
      if (!this.defendActive && gap < this.config.defendGapS && gap > 0) {
        const fired = this.tryFire(
          state,
          'defend_warning',
          'high',
          'defend_warning',
          `${behind.name || 'car behind'} within ${gap.toFixed(2)}s`
        )
        if (fired) this.defendActive = true
      } else if (this.defendActive && gap > this.config.defendGapS + 0.3) {
        this.defendActive = false
      }
    } else if (this.defendActive) {
      // car behind disappeared (retired/pit) — reset
      this.defendActive = false
    }
    // attacking: use the ahead car's deltaToCarBehindS (gap that the trailing car
    // has to the car ahead — i.e. the player's gap to the car in front)
    const attackGap = ahead ? relativePosition(state, ahead).raceTimingGapToPlayerS : null
    if (attackGap != null && attackGap > 0) {
      if (!this.attackActive && attackGap < this.config.attackGapS) {
        const fired = this.tryFire(
          state,
          'attack_opportunity',
          'normal',
          'attack_opportunity',
          `${ahead?.name || 'car ahead'} within ${attackGap.toFixed(2)}s`
        )
        if (fired) this.attackActive = true
      } else if (this.attackActive && attackGap > this.config.attackGapS + 0.3) {
        this.attackActive = false
      }
    } else if (this.attackActive) {
      this.attackActive = false
    }
  }

  private evalLowFuel(state: RaceState): void {
    const fuel = state.player.fuelRemainingKg
    if (fuel == null || fuel <= 0) return
    const toFlag = lapsToFlag(state)
    const margin = raceFuelMargin(state)
    if (toFlag === 0) { this.fuelLowActive = false; return }
    if (toFlag != null && margin != null) {
      if (toFlag > 0) {
        if (margin >= -0.15) { this.fuelLowActive = false; return }
        if (!this.fuelLowActive) {
          if (this.tryFire(state, 'low_fuel', 'high', 'low_fuel', `Fuel estimate short by ${Math.abs(margin).toFixed(2)} laps`)) {
            this.fuelLowActive = true
          }
        }
        return
      }
    }
    // Without a race projection, a mass threshold is only a request to inspect
    // consumption, never evidence that the car cannot reach the flag.
    if (!this.fuelLowActive && fuel < this.config.lowFuelKg) {
      if (this.tryFire(state, 'low_fuel', 'high', 'low_fuel', `Fuel mass ${fuel.toFixed(1)}kg; finish margin unavailable. Check actual laps left and measured consumption; do not request saving from mass alone.`)) {
        this.fuelLowActive = true
      }
    } else if (this.fuelLowActive && fuel > this.config.lowFuelKg + 2) {
      this.fuelLowActive = false
    }
  }

  private evalRain(state: RaceState): void {
    const rainPct = state.weather.rainPercentage
    if (!this.rainImminentActive && rainPct >= this.config.rainImminentPct) {
      if (this.tryFire(state, 'rain_imminent', 'high', 'rain_imminent', `Rain imminent (${Math.round(rainPct)}%)`)) {
        this.rainImminentActive = true
      }
    } else if (this.rainImminentActive && rainPct < this.config.rainImminentPct - 10) {
      this.rainImminentActive = false
    }
  }

  private evalPositionChange(state: RaceState): void {
    const pos = state.player.position
    const lap = state.player.lap
    if (this.positionAtLapStart === null) {
      // first observation — record the baseline, nothing to compare yet
      this.positionAtLapStart = pos
      this.lastLap = lap
      return
    }
    if (lap !== this.lastLap) {
      // Compare against the position held at the START of the lap that just ended.
      // (Comparing the tick before the line with the tick after it measured ~0.5s,
      // not a lap, so real position changes were missed and jitter was reported.)
      const delta = this.positionAtLapStart - pos // positive = gained places
      if (delta !== 0 && Math.abs(delta) >= this.config.positionChangeDelta) {
        this.tryFire(
          state,
          delta > 0 ? 'position_gain' : 'position_loss',
          'normal',
          delta > 0 ? 'position_gain' : 'position_loss',
          delta > 0 ? `Gained ${delta} place(s)` : `Lost ${Math.abs(delta)} place(s)`
        )
      }
      this.positionAtLapStart = pos
    }
    this.lastLap = lap
  }

  private evalHeartbeat(state: RaceState): void {
    const now = Date.now()
    const due = now - this.lastHeartbeatMs >= this.config.heartbeatIntervalS * 1000
    // Quiet check-ins are time based only. Lap-boundary heartbeats made the engineer
    // talk too often in normal races; real radio should stay quiet unless useful.
    if (state.player.lap <= 1) return
    if (due) {
      // Only re-arm the interval once the check-in actually went out, so a cooldown
      // rejection is retried on a later tick instead of skipping the whole interval.
      if (this.tryFire(state, 'heartbeat', 'low', 'heartbeat', 'Scheduled check-in')) {
        this.lastHeartbeatMs = now
      }
    }
  }

  // ───────────────────────── dispatch ─────────────────────────

  private evalQualifyingTraffic(state: RaceState): void {
    const now = Date.now()
    const p = state.player
    const length = state.session.trackLengthM
    if (!isTimedRunSession(state) || !['out', 'cooling', 'in'].includes(p.lapPhase ?? '') ||
        p.pitStatus !== 0 || !p.onTrack || !p.lapDataUpdatedAt || now < p.lapDataUpdatedAt || now - p.lapDataUpdatedAt > 2500 ||
        state.session.isRedFlag || state.session.isSafetyCar || state.session.isVirtualSafetyCar ||
        !validCircuitDistance(p.distanceFromStartM, length)) {
      this.approachingCars.clear()
      return
    }
    const seen = new Set<number>()
    const threats: { car: number; distance: number; eta: number }[] = []
    for (const r of Object.values(state.rivals)) {
      if (r.carIndex === p.carIndex) continue
      const geometry = qualifyingYieldGeometry(state, r, now)
      // The trigger stage additionally needs synchronised LapData before deriving a rate.
      if (!geometry || Math.abs((r.lapDataUpdatedAt ?? 0) - (p.lapDataUpdatedAt ?? 0)) > 750) continue
      const distance = geometry.distanceM
      seen.add(r.carIndex)
      const ts = p.lapDataUpdatedAt!
      const samples = (this.approachingCars.get(r.carIndex) ?? []).filter(sample => ts - sample.ts <= 3000 && sample.ts <= ts)
      if (samples.length && ts - samples[samples.length - 1].ts < 500) continue
      samples.push({ distance, ts })
      this.approachingCars.set(r.carIndex, samples.slice(-7))
      const motion = estimateClosing(samples)
      if (motion.closingMps != null && motion.closingMps >= 5 && motion.catchEstimateS != null && motion.catchEstimateS <= 12) {
        threats.push({ car: r.carIndex, distance, eta: motion.catchEstimateS })
      }
    }
    for (const id of this.approachingCars.keys()) if (!seen.has(id)) this.approachingCars.delete(id)
    const threat = threats.sort((a, b) => a.eta - b.eta)[0]
    if (threat) {
      const r = state.rivals[threat.car]
      this.tryFire(state, `qualifying_yield_${threat.car}`, 'critical', 'qualifying_yield',
        `${JSON.stringify(r.name.slice(0, 48))} is on a valid flying lap behind on track, ${Math.round(threat.distance)}m and closing; approximate catch ${Math.ceil(threat.eta)}s if rates persist. Player is ${p.lapPhase}. Warn briefly to leave room safely off the racing line, no sudden braking or unverified left/right instruction.`)
    }
  }

  private evalLapReview(state: RaceState): void {
    const lap = state.player.lap
    if (this.reviewLap > 0 && lap === this.reviewLap + 1 && state.player.pitStatus === 0) {
      this.tryFire(state, 'lap_review', 'normal', 'lap_review',
        'Lap completed. Review pace, fuel projection, tyre/energy trends, rivals and previous instruction outcome. Only call speak_radio if the next decision changes; otherwise return no text.')
    }
    this.reviewLap = lap
  }

  private tryFire(
    state: RaceState,
    ruleId: string,
    priority: Priority,
    reasonCode: string,
    reason: string
  ): boolean {
    if (holdQualifyingRadio(state, { ruleId, priority, reasonCode, reason, kind: 'threshold', ts: Date.now() })) return false
    // suppressLastLapLowPriority: on the final lap, block non-critical triggers
    if (isRaceSession(state) && this.config.suppressLastLapLowPriority && (priority === 'low' || priority === 'normal')) {
      const totalLaps = state.session.totalLaps
      if (totalLaps != null && totalLaps > 0 && state.player.lap >= totalLaps) return false
    }
    // heartbeat is rate-limited by its own interval (in evalHeartbeat) + the global gap;
    // it should NOT additionally suffer the 45s per-rule cooldown.
    if (!this.cooldown.canFire(ruleId, priority, isRaceSession(state) ? state.player.lap : 0)) return false
    this.cooldown.recordFire(ruleId, priority)
    const firing: TriggerFiring = {
      ruleId,
      kind: classifyKind(ruleId),
      priority,
      reasonCode,
      reason,
      ts: Date.now()
    }
    logger.debug(`trigger fired: ${ruleId} [${priority}] — ${reason}`)
    this.onFiring(firing)
    return true
  }
}

/** Classify a ruleId's kind: heartbeat, discrete event, or threshold (edge-hysteretic). */
function classifyKind(ruleId: string): 'heartbeat' | 'event' | 'threshold' {
  if (ruleId === 'heartbeat') return 'heartbeat'
  const EVENT_RULES = new Set([
    'safety_car',
    'vsc',
    'red_flag',
    'fastest_lap',
    'penalty',
    'warning',
    'race_winner'
  ])
  if (EVENT_RULES.has(ruleId)) return 'event'
  return 'threshold'
}

function minPositive(...values: number[]): number | null {
  const filtered = values.filter((v) => Number.isFinite(v) && v > 0)
  return filtered.length ? Math.min(...filtered) : null
}

function isRaceSession(state: RaceState): boolean {
  return sessionKind(state.session) === 'race'
}
