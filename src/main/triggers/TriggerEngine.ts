import type { RaceState } from '@shared/types/state'
import type { TriggerFiring, TriggerConfig } from '@shared/types/triggers'
import type { Priority } from '@shared/types/audio'
import { Cooldown } from './Cooldown'
import { logger } from '../logging/Logger'

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
  private lastPosition = 0
  private lastLap = 0
  private flashbackUntilMs = 0
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
  }

  /** Called when the aggregator has updated state (throttled, e.g. once per tick). */
  evaluate(state: RaceState): void {
    if (this.inFlashback()) return

    this.evalTyreWear(state)
    this.evalTyreTemp(state)
    this.evalDefendAttack(state)
    this.evalLowFuel(state)
    this.evalRain(state)
    this.evalPositionChange(state)
    this.evalHeartbeat(state)
  }

  /** Called when a discrete event packet arrives (safety car, fastest lap, penalty...). */
  onEvent(state: RaceState, ev: { type: string; carIndex?: number; text: string }): void {
    if (this.inFlashback()) return
    switch (ev.type) {
      case 'safetyCar':
        this.tryFire(state, 'safety_car', 'critical', 'sc_active', `Safety Car: ${ev.text}`)
        break
      case 'vsc':
        this.tryFire(state, 'vsc', 'critical', 'vsc_active', `Virtual Safety Car: ${ev.text}`)
        break
      case 'redFlag':
        this.tryFire(state, 'red_flag', 'critical', 'red_flag', `Red flag: ${ev.text}`)
        break
      case 'fastestLap':
        this.tryFire(state, 'fastest_lap', 'normal', 'fastest_lap', ev.text)
        break
      case 'penalty':
        if (ev.carIndex === state.player.carIndex) {
          this.tryFire(state, 'penalty', 'normal', 'penalty', `Penalty: ${ev.text}`)
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
    this.flashbackUntilMs = Date.now() + 3000
    // reset all edge states so we don't double-fire on the resumed timeline
    this.tyreWearLevel = 0
    this.tyreHotActive = false
    this.tyreColdActive = false
    this.defendActive = false
    this.attackActive = false
    this.rainImminentActive = false
    this.fuelLowActive = false
    this.lastPosition = 0
    this.lastLap = 0
    logger.info('flashback detected — triggers suppressed for 3s, states reset')
  }

  // ───────────────────────── threshold rules ─────────────────────────

  private evalTyreWear(state: RaceState): void {
    const wear = Math.max(
      state.player.tyres.wear.rl,
      state.player.tyres.wear.rr,
      state.player.tyres.wear.fl,
      state.player.tyres.wear.fr
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
      this.tryFire(
        state,
        `tyre_wear_${threshold}`,
        prio,
        `tyre_wear_${threshold}`,
        `Tyre wear reached ${Math.round(wear)}% (threshold ${threshold}%)`
      )
    }
    // also drop the live level when wear falls well below (re-enter after a stop)
    this.tyreWearLevel = Math.max(this.tyreWearLevel, newLevel) === this.tyreWearLevel ? this.tyreWearLevel : newLevel
    // if wear dropped a lot (fresh tyres after stop), reset so we re-fire later
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
      this.tyreHotActive = true
      this.tryFire(state, 'tyre_hot', 'normal', 'tyre_hot', `Tyre inner/core temperature high (${Math.round(innerMax)}°C)`)
    } else if (this.tyreHotActive && innerMax < this.config.tyreHotC - 5) {
      this.tyreHotActive = false
    }
    if (!this.tyreColdActive && innerMin != null && innerMin < this.config.tyreColdC) {
      this.tyreColdActive = true
      this.tryFire(state, 'tyre_cold', 'normal', 'tyre_cold', `Tyre inner/core temperature low (${Math.round(innerMin)}°C)`)
    } else if (this.tyreColdActive && innerMin != null && innerMin > this.config.tyreColdC + 5) {
      this.tyreColdActive = false
    }
  }

  private evalDefendAttack(state: RaceState): void {
    const playerPos = state.player.position
    const ahead = Object.values(state.rivals).find((r) => r.position === playerPos - 1)
    const behind = Object.values(state.rivals).find((r) => r.position === playerPos + 1)
    // defending: car behind close (their gap to the car in front = gap to us)
    if (behind && behind.deltaToCarInFrontS != null) {
      const gap = behind.deltaToCarInFrontS
      if (!this.defendActive && gap < this.config.defendGapS && gap > 0) {
        this.defendActive = true
        this.tryFire(
          state,
          'defend_warning',
          'high',
          'defend_warning',
          `${behind.name || 'car behind'} within ${gap.toFixed(2)}s`
        )
      } else if (this.defendActive && gap > this.config.defendGapS + 0.3) {
        this.defendActive = false
      }
    } else if (this.defendActive) {
      // car behind disappeared (retired/pit) — reset
      this.defendActive = false
    }
    // attacking: use the ahead car's deltaToCarBehindS (gap that the trailing car
    // has to the car ahead — i.e. the player's gap to the car in front)
    const attackGap = ahead?.deltaToCarBehindS
    if (attackGap != null && attackGap > 0) {
      if (!this.attackActive && attackGap < this.config.attackGapS) {
        this.attackActive = true
        this.tryFire(
          state,
          'attack_opportunity',
          'normal',
          'attack_opportunity',
          `${ahead?.name || 'car ahead'} within ${attackGap.toFixed(2)}s`
        )
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
    // hysteresis: only fire on crossing below threshold, reset when above
    if (!this.fuelLowActive && fuel < this.config.lowFuelKg) {
      this.fuelLowActive = true
      this.tryFire(state, 'low_fuel', 'high', 'low_fuel', `Fuel low (${fuel.toFixed(1)}kg)`)
    } else if (this.fuelLowActive && fuel > this.config.lowFuelKg + 2) {
      this.fuelLowActive = false
    }
  }

  private evalRain(state: RaceState): void {
    const rainPct = state.weather.rainPercentage
    if (!this.rainImminentActive && rainPct >= this.config.rainImminentPct) {
      this.rainImminentActive = true
      this.tryFire(state, 'rain_imminent', 'high', 'rain_imminent', `Rain imminent (${Math.round(rainPct)}%)`)
    } else if (this.rainImminentActive && rainPct < this.config.rainImminentPct - 10) {
      this.rainImminentActive = false
    }
  }

  private evalPositionChange(state: RaceState): void {
    const pos = state.player.position
    const lap = state.player.lap
    if (this.lastLap !== 0 && lap === this.lastLap + 1) {
      // crossed into a new lap — compare position delta
      const delta = this.lastPosition - pos // positive = gained places
      if (Math.abs(delta) >= this.config.positionChangeDelta) {
        this.tryFire(
          state,
          delta > 0 ? 'position_gain' : 'position_loss',
          'normal',
          delta > 0 ? 'position_gain' : 'position_loss',
          delta > 0 ? `Gained ${delta} place(s)` : `Lost ${Math.abs(delta)} place(s)`
        )
      }
    }
    this.lastPosition = pos
    this.lastLap = lap
  }

  private evalHeartbeat(state: RaceState): void {
    const now = Date.now()
    const due = now - this.lastHeartbeatMs >= this.config.heartbeatIntervalS * 1000
    // Quiet check-ins are time based only. Lap-boundary heartbeats made the engineer
    // talk too often in normal races; real radio should stay quiet unless useful.
    if (state.player.lap <= 1) return
    if (due) {
      this.lastHeartbeatMs = now
      this.tryFire(state, 'heartbeat', 'low', 'heartbeat', 'Scheduled check-in')
    }
  }

  // ───────────────────────── dispatch ─────────────────────────

  private tryFire(
    state: RaceState,
    ruleId: string,
    priority: Priority,
    reasonCode: string,
    reason: string
  ): void {
    // suppressLastLapLowPriority: on the final lap, block non-critical triggers
    if (this.config.suppressLastLapLowPriority && priority !== 'critical') {
      const totalLaps = state.session.totalLaps
      if (totalLaps != null && totalLaps > 0 && state.player.lap >= totalLaps) return
    }
    // heartbeat is rate-limited by its own interval (in evalHeartbeat) + the global gap;
    // it should NOT additionally suffer the 45s per-rule cooldown.
    if (!this.cooldown.canFire(ruleId, priority, state.player.lap)) return
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
    'race_winner'
  ])
  if (EVENT_RULES.has(ruleId)) return 'event'
  return 'threshold'
}

function minPositive(...values: number[]): number | null {
  const filtered = values.filter((v) => Number.isFinite(v) && v > 0)
  return filtered.length ? Math.min(...filtered) : null
}

export { Cooldown }
export type { TriggerConfig }
