import type { TriggerConfig } from '@shared/index'

/**
 * Cooldown — enforces per-rule and global minimum gaps, plus first-lap suppression.
 * Tracks the last-fire time per ruleId and a global next-allowed time.
 */
export class Cooldown {
  private byRule = new Map<string, number>() // ruleId -> next allowed ms
  private globalNext = 0
  private lastPriority: 'critical' | 'high' | 'normal' | 'low' = 'normal'

  constructor(private config: TriggerConfig) {}

  /** True if a rule may fire now (respects per-rule + global + first-lap suppression). */
  canFire(ruleId: string, priority: 'critical' | 'high' | 'normal' | 'low', currentLap: number): boolean {
    const now = Date.now()
    // first-lap suppression: only critical allowed (covers "don't talk during the start")
    if (this.config.suppressFirstLap && currentLap === 1 && priority !== 'critical') return false
    const ruleNext = this.byRule.get(ruleId) ?? 0
    return now >= ruleNext && now >= this.globalNext
  }

  /** Record that a rule fired; sets its cooldown + the global gap. */
  recordFire(ruleId: string, priority: 'critical' | 'high' | 'normal' | 'low'): void {
    const now = Date.now()
    // heartbeat is paced only by its own interval + the global gap (no 45s per-rule lock)
    if (ruleId !== 'heartbeat') {
      this.byRule.set(ruleId, now + this.ruleCooldownMs(ruleId))
    }
    this.globalNext = now + this.config.globalMinGapS * 1000
    this.lastPriority = priority
  }

  get currentPriority(): 'critical' | 'high' | 'normal' | 'low' {
    return this.lastPriority
  }

  /** Per-rule cooldown: explicit override > default-by-priority. */
  private ruleCooldownMs(ruleId: string): number {
    const explicit = this.config.perRuleCooldownS[ruleId]
    if (explicit != null) return explicit * 1000
    return DEFAULT_COOLDOWN_MS
  }
}

/** Default cooldown applied when a rule has no explicit override (ms). */
const DEFAULT_COOLDOWN_MS = 45 * 1000
