import type { RaceState } from '@shared/types/state'
import { lapsToFlag } from '@shared/util/raceDistance'
import { sessionKind } from '@shared/util/sessionKind'
import { sampleAge } from './SpatialAwareness'

type Range = [number, number]
type Scenario = { label: string; evidence: string; stopAfterLaps: number | null;
  currentPaceS: Range; newPaceS?: Range; pitLossS?: Range; warmupLossS?: Range;
  trafficLossS: Range; rulesSatisfied: boolean | null }
type Plan = { plan: string; evidence: string; reconsiderWhen: string; reviewLap: number;
  recordedAt: number; frame: number; lap: number }

function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected an argument object')
  return input as Record<string, unknown>
}
function keys(a: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(a).some(k => !allowed.includes(k))) throw new Error('Unknown strategy argument')
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) {
    throw new Error('Invalid strategy text')
  }
  return value.trim()
}
function range(value: unknown, min: number, max: number): Range {
  if (!Array.isArray(value) || value.length !== 2 || value.some(v => typeof v !== 'number' || !Number.isFinite(v)) ||
      value[0] < min || value[1] < value[0] || value[1] > max) throw new Error('Invalid strategy range')
  return [value[0], value[1]]
}

/** Arithmetic on explicit model assumptions, never an automatic BOX command or calibrated model. */
export function compareStrategies(state: RaceState, input: unknown, now: number) {
  const a = record(input)
  keys(a, ['scenarios'])
  if (!Array.isArray(a.scenarios) || a.scenarios.length < 2 || a.scenarios.length > 3) throw new Error('Supply 2-3 scenarios')
  const remaining = lapsToFlag(state)
  const age = sampleAge(state.lastPacketMs, now)
  if (sessionKind(state.session) !== 'race' || state.flashbackActive || age == null || age > 2500 ||
      remaining == null || remaining <= 0) return { available: false, reason: 'Fresh race distance required' }
  const scenarios: Scenario[] = a.scenarios.map(raw => {
    const s = record(raw)
    keys(s, ['label', 'evidence', 'stopAfterLaps', 'currentPaceS', 'newPaceS', 'pitLossS', 'warmupLossS', 'trafficLossS', 'rulesSatisfied'])
    const delay = s.stopAfterLaps
    if (delay !== null && (typeof delay !== 'number' || !Number.isFinite(delay) || delay < 0 || delay >= remaining)) {
      throw new Error('Stop delay must be null (stay out) or within remaining race distance')
    }
    if (s.rulesSatisfied !== null && typeof s.rulesSatisfied !== 'boolean') throw new Error('rulesSatisfied must be true, false or null')
    if (delay === null && ['newPaceS', 'pitLossS', 'warmupLossS'].some(k => k in s)) throw new Error('Stay-out scenario cannot include stop costs')
    return { label: text(s.label, 40), evidence: text(s.evidence, 160), stopAfterLaps: delay,
      currentPaceS: range(s.currentPaceS, 20, 600), trafficLossS: range(s.trafficLossS, 0, 600),
      rulesSatisfied: s.rulesSatisfied,
      ...(delay === null ? {} : { newPaceS: range(s.newPaceS, 20, 600),
        pitLossS: range(s.pitLossS, 0, 120), warmupLossS: range(s.warmupLossS, 0, 120) }) }
  })
  if (new Set(scenarios.map(s => s.label)).size !== scenarios.length) throw new Error('Scenario labels must be unique')
  const results = scenarios.map(s => {
    const before = s.stopAfterLaps ?? remaining, after = remaining - before
    const total = ([0, 1] as const).map(i => s.currentPaceS[i] * before + (s.newPaceS?.[i] ?? 0) * after +
      (s.pitLossS?.[i] ?? 0) + (s.warmupLossS?.[i] ?? 0) + s.trafficLossS[i]) as Range
    return { ...s, totalRemainingTimeS: total }
  })
  const eligible = results.filter(s => s.rulesSatisfied === true)
  const winner = eligible.find(s => results.every(other => other === s || other.rulesSatisfied === false ||
    (other.rulesSatisfied === true && s.totalRemainingTimeS[1] < other.totalRemainingTimeS[0])))
  return { available: true, remainingLaps: remaining, regime: state.session.isSafetyCar ? 'SC' : state.session.isVirtualSafetyCar ? 'VSC' : state.session.trackFlag,
    scenarios: results, robustWinnerUnderAssumptions: winner?.label ?? null,
    limitations: 'All pace/cost ranges and rule declarations are MODEL-SUPPLIED assumptions, not measured or validated facts. Constant pace per stint; no degradation curve. Include actual service ONCE in net pit loss, warm-up and traffic ONCE as additional costs. Ordinary EA F1 stops do not clear accumulated time penalties: do NOT add them to pit service. Account for them separately ONCE in final classification, not as an advantage of stopping. A separately confirmed stop-go obligation is distinct. Different flag regimes need different evidence. Unknown rules prevent a robust winner. Verify tyre inventory, compound obligation, neutralisation and live exit traffic before committing.' }
}

/** Session-scoped model plan memory, never persisted to disk or promoted into instructions. */
export class StrategyJournal {
  private key = ''
  private entries: Plan[] = []
  reset(): void { this.key = ''; this.entries = [] }
  execute(state: RaceState, input: unknown, now: number) {
    const a = record(input)
    keys(a, ['action', 'plan', 'evidence', 'reconsiderWhen', 'reviewLap'])
    if (!['get', 'set', 'clear'].includes(String(a.action))) throw new Error('Invalid plan action')
    const key = JSON.stringify([state.session.sessionUID, state.session.sessionType, state.session.trackId])
    if (key !== this.key || state.flashbackActive || state.session.overallFrameIdentifier < (this.entries.at(-1)?.frame ?? 0)) {
      this.reset(); this.key = key
    }
    if (a.action !== 'set' && Object.keys(a).some(k => k !== 'action')) throw new Error('Only set accepts plan fields')
    if (a.action === 'clear') this.entries = []
    if (a.action === 'set') {
      const age = sampleAge(state.lastPacketMs, now)
      if (age == null || age > 2500 || state.flashbackActive) throw new Error('Fresh telemetry required to record a plan')
      if (typeof a.reviewLap !== 'number' || !Number.isInteger(a.reviewLap) || a.reviewLap < state.player.lap ||
          a.reviewLap > (sessionKind(state.session) === 'race' ? state.session.totalLaps ?? state.player.lap + 100 : state.player.lap + 100)) throw new Error('Invalid plan review lap')
      const entry: Plan = { plan: text(a.plan, 240), evidence: text(a.evidence, 240),
        reconsiderWhen: text(a.reconsiderWhen, 240), reviewLap: a.reviewLap,
        recordedAt: now, frame: state.session.overallFrameIdentifier, lap: state.player.lap }
      this.entries = [...this.entries, entry].slice(-8)
    }
    return { source: 'model-authored untrusted plan notes, not a driver instruction or verified strategy',
      sessionUID: state.session.sessionUID, current: this.entries.at(-1) ?? null, revisions: [...this.entries],
      reviewDue: this.entries.length > 0 && state.player.lap >= this.entries.at(-1)!.reviewLap }
  }
}
