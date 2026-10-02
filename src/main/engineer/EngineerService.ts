import { nanoid } from 'nanoid'
import { Sender } from '../ipc/sender'
import { DigestBuilder } from './DigestBuilder'
import { RaceAnalysis } from './RaceAnalysis'
import { TelemetryHistory } from './TelemetryHistory'
import { getEngineerSkill } from './EngineerSkillLibrary'
import type { TriggerFiring } from '@shared/types/triggers'
import type { RaceState } from '@shared/types/state'
import { ENGINEER_TTS_DIRECTIONS, type LanguageMode } from '@shared/constants/voices'
import { logger } from '../logging/Logger'
import { holdQualifyingRadio, qualifyingYieldStillRelevant } from '@shared/util/lapPhase'
import { relativeMotion } from './SpatialAwareness'

/**
 * EngineerService — orchestrates digest -> DSH turn -> UI streaming and radio speech.
 *
 * The DSH backend owns conversation state and compaction, so this service only has to
 * build the digest and route the model's output: manual prose to the chat, and
 * speak_radio tool calls to the audio pipeline. Automatic triggers never surface prose.
 */
export class EngineerService {
  private digestBuilder = new DigestBuilder()
  readonly analysis = new RaceAnalysis()
  readonly telemetryHistory = new TelemetryHistory()
  private llm: EngineerBackend | null = null
  private language: LanguageMode = 'zh'
  private voice = '冰糖'
  private direction = ENGINEER_TTS_DIRECTIONS.zh
  private styleDirection = ENGINEER_TTS_DIRECTIONS.zh
  private customDirection: string | null = null
  private inFlight: Promise<void> | null = null
  private activePriority: TriggerFiring['priority'] | null = null
  private activeManual = false
  private interruptedByCritical = false
  private pending: { state: RaceState; firing: TriggerFiring } | null = null
  private pendingManual: { state: RaceState; firing: TriggerFiring } | null = null
  private onSpeak: (text: string, firing: TriggerFiring, voice: string, direction: string) => void = () => {}
  private onInterrupt: () => void = () => {}
  private lastToolRadio = ''
  private latestState: (() => RaceState) | null = null
  private lastRadioFiring: TriggerFiring | null = null

  setStateProvider(provider: () => RaceState): void { this.latestState = provider }

  observeRadioState(state: RaceState): void {
    if (this.lastRadioFiring && (holdQualifyingRadio(state, this.lastRadioFiring) ||
        !this.trafficStillRelevant(state, this.lastRadioFiring))) {
      this.onInterrupt()
      this.lastRadioFiring = null
    }
  }

  private trafficStillRelevant(state: RaceState, firing: TriggerFiring): boolean {
    if (!qualifyingYieldStillRelevant(state, firing)) return false
    if (firing.reasonCode !== 'qualifying_yield') return true
    const ts = state.player.lapDataUpdatedAt ?? 0
    const states = this.telemetryHistory.recentPositionStates().filter(s =>
      (s.player.lapDataUpdatedAt ?? 0) <= ts - 100)
    const motion = relativeMotion([...states, state], Number(firing.ruleId.replace(/^qualifying_yield_/, '')))
    return motion.closingMps != null && motion.closingMps >= 5 &&
      motion.catchEstimateS != null && motion.catchEstimateS <= 12
  }

  /** The private DSH backend is injected here; null means no model is configured. */
  setBackend(b: EngineerBackend | null): void {
    this.llm = b
  }

  setLanguage(mode: LanguageMode): void {
    if (this.language === mode) return
    this.language = mode
    logger.info(`engineer language mode -> ${mode}`)
  }

  setEngineerStyle(style: string): void {
    this.styleDirection = getEngineerSkill(style).ttsDirection
    this.direction = this.customDirection ?? this.styleDirection
  }

  setVoice(voice: string, direction: string): void {
    this.voice = voice
    this.customDirection = direction && !Object.values(ENGINEER_TTS_DIRECTIONS).includes(direction) ? direction : null
    this.direction = this.customDirection ?? this.styleDirection
  }

  /** Set the callback that speaks radio accepted through speak_radio. */
  setSpeakHandler(cb: (text: string, firing: TriggerFiring, voice: string, direction: string) => void): void {
    this.onSpeak = cb
  }

  setInterruptHandler(cb: () => void): void { this.onInterrupt = cb }

  /** The DSH radio tool is the sole speech entry point. */
  acceptRadio(text: string, firing: TriggerFiring): void {
    const current = this.latestState?.()
    if (current && holdQualifyingRadio(current, firing)) throw new Error('Radio held: driver is on a qualifying flying lap or phase is uncertain. Remain silent; reconsider after the push lap.')
    if (current && !this.trafficStillRelevant(current, firing)) throw new Error('Traffic warning expired or fresh relative motion no longer confirms an approaching car. Remain silent.')
    this.lastRadioFiring = firing
    this.lastToolRadio = text
    if (current) this.analysis.noteRadio(current, text)
    Sender.send('engineer:status', { status: 'idle' })
    Sender.send('engineer:advice', {
      id: nanoid(10), text, firing: { code: firing.reasonCode, priority: firing.priority }, ts: Date.now()
    })
    this.onSpeak(text, firing, this.voice, this.direction)
  }

  /**
   * Entry from the trigger engine / manual Ask. Serializes advice calls so we never
   * fire two overlapping LLM streams. If a new (higher-or-equal priority) firing arrives
   * while one is in flight, it replaces the pending one (last-wins coalescing).
   */
  enqueue(state: RaceState, firing: TriggerFiring): void {
    // if nothing in flight, run immediately; otherwise stash as pending (coalesce)
    if (!this.inFlight) {
      void this.run(state, firing)
    } else {
      if (firing.reasonCode === 'manual') {
        this.pendingManual = { state, firing }
        // Manual prompts coalesce, but cannot interrupt or displace critical radio.
        if (this.activePriority === 'critical' || this.pending?.firing.priority === 'critical') return
        this.llm?.cancel?.()
        this.onInterrupt()
        return
      }
      if (this.pending && !this.priorityGte(firing.priority, this.pending.firing.priority)) return
      this.pending = { state, firing }
      if (firing.priority === 'critical' ||
          (firing.priority === 'high' && !this.activeManual && this.activePriority !== 'critical' && this.activePriority !== 'high')) {
        this.interruptedByCritical = this.activeManual && firing.priority === 'critical'
        this.llm?.cancel?.()
        this.onInterrupt()
      }
    }
  }

  private priorityGte(a: TriggerFiring['priority'], b: TriggerFiring['priority']): boolean {
    const rank: Record<TriggerFiring['priority'], number> = { critical: 4, high: 3, normal: 2, low: 1 }
    return rank[a] >= rank[b]
  }

  private async run(state: RaceState, firing: TriggerFiring): Promise<void> {
    this.activePriority = firing.priority
    this.activeManual = firing.reasonCode === 'manual'
    this.interruptedByCritical = false
    this.inFlight = this.advise(state, firing)
    try {
      await this.inFlight
    } finally {
      this.inFlight = null
      this.activePriority = null
      this.activeManual = false
      const next = this.pending?.firing.priority === 'critical' ? this.pending : this.pendingManual ?? this.pending
      if (next) {
        if (next === this.pending) this.pending = null
        else this.pendingManual = null
        void this.run(next.state, next.firing)
      }
    }
  }

  /** Abort any in-flight work (Stop button / high-priority preempt). */
  cancel(): void {
    this.pending = null
    this.pendingManual = null
    this.llm?.cancel?.()
    this.onInterrupt()
  }

  /**
   * Produce advice for the current state + trigger.
   * Streams tokens to the renderer via 'engineer:text', then commits the full message.
   * Throws on cancel/abort (caught by run()); never commits a truncated message.
   */
  async advise(state: RaceState, firing: TriggerFiring): Promise<void> {
    if (holdQualifyingRadio(this.latestState?.() ?? state, firing)) return
    this.lastToolRadio = ''
    const id = nanoid(10)
    const digestText = this.digestBuilder.toText(this.digestBuilder.build(state, firing)) + '\n' + this.analysis.report(state) +
      '\nTELEMETRY TOOLS inventory: ' + this.telemetryHistory.inventory()

    Sender.send('engineer:status', { status: 'thinking' })
    // Automatic triggers never surface prose: only a speak_radio tool call produces radio.
    const emitDelta = (delta: string): void => {
      if (firing.reasonCode === 'manual' && !this.lastToolRadio) Sender.send('engineer:text', { id, delta })
    }

    try {
      if (!this.llm) {
        if (firing.reasonCode === 'manual') {
          throw new Error(this.language === 'en'
            ? 'AI engineer is not connected. Configure and test the model connection before requesting analysis.'
            : 'AI 工程师尚未连接，请在设置中配置并测试模型连接，当前无法进行比赛分析。')
        }
        Sender.send('engineer:status', { status: 'idle' })
        return
      }
      const cleanText = (await this.llm.generate(digestText, firing, emitDelta)).trim()
      if (this.lastToolRadio) {
        Sender.send('engineer:status', { status: 'idle' })
        return
      }
      if (firing.reasonCode !== 'manual') {
        Sender.send('engineer:status', { status: 'idle' })
        return
      }
      if (!cleanText) {
        throw new Error('模型结束了思考，但没有返回回答或成功调用无线电工具，请重试。')
      }

      Sender.send('engineer:advice', {
        id,
        text: cleanText,
        firing: { code: firing.reasonCode, priority: firing.priority },
        ts: Date.now()
      })
      Sender.send('engineer:status', { status: 'idle' })
      logger.info(`engineer advice [${firing.reasonCode}]: ${cleanText.slice(0, 80)}`)
    } catch (err) {
      if (this.isAbort(err)) {
        logger.info('engineer advice aborted')
        Sender.send('engineer:status', this.interruptedByCritical
          ? { status: 'error', message: '本次提问被紧急比赛提醒打断，请稍后重新提问。' }
          : { status: 'idle' })
        return
      }
      const message = (err as Error)?.message ?? String(err)
      logger.error('engineer advice failed:', message)
      Sender.send('engineer:status', { status: 'error', message: message.slice(0, 500) })
    }
  }

  private isAbort(err: unknown): boolean {
    return err instanceof Error && err.name === 'AbortError'
  }
}

/** Backend interface implemented by the private DSH runtime. */
export interface EngineerBackend {
  cancel?(): void
  generate(
    digestText: string,
    firing: TriggerFiring,
    onDelta: (delta: string) => void
  ): Promise<string>
}

/** Construct a manual trigger firing (for the Ask Engineer button). */
export function manualFiring(prompt?: string): TriggerFiring {
  return {
    ruleId: 'manual',
    kind: 'manual',
    priority: 'normal',
    reasonCode: 'manual',
    reason: prompt || 'Driver is asking for an update.',
    ts: Date.now()
  }
}
