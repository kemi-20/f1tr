import { nanoid } from 'nanoid'
import { Sender } from '../ipc/sender'
import { DigestBuilder } from './DigestBuilder'
import { RaceAnalysis } from './RaceAnalysis'
import { TelemetryHistory } from './TelemetryHistory'
import { ConversationMemory } from './ConversationMemory'
import { getEngineerSkill } from './EngineerSkillLibrary'
import type { TriggerFiring } from '@shared/types/triggers'
import type { RaceState } from '@shared/types/state'
import type { LanguageMode } from '@shared/constants/voices'
import { logger } from '../logging/Logger'

/**
 * EngineerService — orchestrates digest -> advice -> UI streaming + (later) TTS enqueue.
 *
 * In P2 this uses StubAdvice (no LLM). P3 swaps in the real DSH backend while keeping
 * the same digest/IPC contract. The manual "Ask Engineer" path reuses the digest so the
 * model always sees the current race picture.
 */
export class EngineerService {
  private digestBuilder = new DigestBuilder()
  readonly analysis = new RaceAnalysis()
  readonly telemetryHistory = new TelemetryHistory()
  private llm: EngineerBackend | null = null
  readonly memory = new ConversationMemory()
  private language: LanguageMode = 'zh'
  private voice = '冰糖'
  private direction = '冷静果断的 F1 赛车工程师语气'
  private inFlight: Promise<void> | null = null
  private activePriority: TriggerFiring['priority'] | null = null
  private pending: { state: RaceState; firing: TriggerFiring; audioBase64?: string } | null = null
  private onSpeak: (text: string, firing: TriggerFiring, voice: string, direction: string) => void = () => {}
  private onInterrupt: () => void = () => {}
  private lastToolRadio = ''
  private idleTimer: NodeJS.Timeout | null = null

  /** P3 injects the real LLM backend here; null = stub mode. */
  setBackend(b: EngineerBackend | null): void {
    this.llm = b
  }

  setLanguage(mode: LanguageMode): void {
    this.language = mode
    this.memory.setLanguage(mode)
  }

  setEngineerStyle(style: string): void {
    this.memory.setEngineerStyle(style)
    // The skill's #0 section is the MiMo TTS voice-style direction.
    this.direction = getEngineerSkill(style).ttsDirection
  }

  setMemoryTurns(maxTurns: number): void {
    this.memory.setMaxTurns(maxTurns)
  }

  setVoice(voice: string, direction: string): void {
    this.voice = voice
    this.direction = direction
  }

  /** Set the callback that speaks completed advice (wired to the AudioPipeline in P5). */
  setSpeakHandler(cb: (text: string, firing: TriggerFiring, voice: string, direction: string) => void): void {
    this.onSpeak = cb
  }

  setInterruptHandler(cb: () => void): void { this.onInterrupt = cb }

  /** The DSH radio tool is the sole speech entry point. */
  acceptRadio(text: string, firing: TriggerFiring): void {
    this.lastToolRadio = text
    Sender.send('engineer:status', { status: 'idle' })
    Sender.send('engineer:advice', {
      id: nanoid(10), text, firing: { code: firing.reasonCode, priority: firing.priority }, ts: Date.now()
    })
    Sender.send('engineer:status', { status: 'speaking' })
    this.onSpeak(text, firing, this.voice, this.direction)
  }

  get currentLanguage(): LanguageMode {
    return this.language
  }

  /**
   * Entry from the trigger engine / manual Ask. Serializes advice calls so we never
   * fire two overlapping LLM streams. If a new (higher-or-equal priority) firing arrives
   * while one is in flight, it replaces the pending one (last-wins coalescing).
   */
  enqueue(state: RaceState, firing: TriggerFiring, audioBase64?: string): void {
    // if nothing in flight, run immediately; otherwise stash as pending (coalesce)
    if (!this.inFlight) {
      void this.run(state, firing, audioBase64)
    } else {
      if (firing.reasonCode === 'manual' || firing.priority === 'critical' ||
          (firing.priority === 'high' && this.activePriority !== 'critical' && this.activePriority !== 'high')) {
        this.llm?.cancel?.()
        this.onInterrupt()
      }
      // only replace pending if the new firing is higher-or-equal priority
      if (this.pending && !this.priorityGte(firing.priority, this.pending.firing.priority)) {
        return // existing pending is higher priority — keep it
      }
      this.pending = { state, firing, audioBase64 }
    }
  }

  private priorityGte(a: TriggerFiring['priority'], b: TriggerFiring['priority']): boolean {
    const rank: Record<TriggerFiring['priority'], number> = { critical: 4, high: 3, normal: 2, low: 1 }
    return rank[a] >= rank[b]
  }

  private async run(state: RaceState, firing: TriggerFiring, audioBase64?: string): Promise<void> {
    this.activePriority = firing.priority
    this.inFlight = this.advise(state, firing, undefined, audioBase64)
    try {
      await this.inFlight
    } finally {
      this.inFlight = null
      this.activePriority = null
      if (this.pending) {
        const next = this.pending
        this.pending = null
        void this.run(next.state, next.firing, next.audioBase64)
      }
    }
  }

  /** Abort any in-flight work (Stop button / high-priority preempt). */
  cancel(): void {
    this.pending = null
    this.clearIdleTimer()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const llm = this.llm as any
    llm?.cancel?.()
    this.onInterrupt()
  }

  /** Clear the idle-settle timer to prevent a stale 'idle' status firing during a new request. */
  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
  }

  /** True if a real LLM backend is wired (vs stub advice). */
  hasBackend(): boolean {
    return this.llm != null
  }

  /**
   * Produce advice for the current state + trigger.
   * Streams tokens to the renderer via 'engineer:text', then commits the full message.
   * Throws on cancel/abort (caught by run()); never commits a truncated message.
   */
  async advise(state: RaceState, firing: TriggerFiring, manualPrompt?: string, audioBase64?: string): Promise<void> {
    this.lastToolRadio = ''
    const id = nanoid(10)
    const digest = this.digestBuilder.build(state, firing)
    const digestText = this.digestBuilder.toText(digest) + '\n' + this.analysis.report(state) +
      '\nTELEMETRY TOOLS inventory: ' + this.telemetryHistory.inventory()

    // ensure the session prime (cached baseline) is built / current before any LLM call
    this.memory.primeIfNeeded(state)

    this.clearIdleTimer()
    Sender.send('engineer:status', { status: 'thinking' })
    const emitDelta = createDeltaEmitter(firing, (delta) => {
      if (!this.lastToolRadio) Sender.send('engineer:text', { id, delta })
    })

    try {
      const rawText = this.llm
        ? await this.llm.generate(digest, digestText, firing, manualPrompt, emitDelta, audioBase64)
        : this.simulateStream(firing.reasonCode === 'manual'
          ? this.language === 'en' ? '【NOW】AI engineer is not connected. Configure and test the model connection before requesting analysis.'
            : '【NOW】AI 工程师尚未连接，请在设置中配置并测试模型连接，当前无法进行比赛分析。'
          : '【HOLD】', emitDelta)
      const text = cleanAutoTriggerAcknowledgement(rawText, firing)

      const cleanText = text.replace(/^【(NOW|HOLD)】/i, '').trim()
      if (this.lastToolRadio) {
        this.clearIdleTimer()
        this.idleTimer = setTimeout(() => Sender.send('engineer:status', { status: 'idle' }), 6000)
        return
      }
      // Skip sending empty advice (e.g. model returned only a tool call with no text)
      if (!cleanText) {
        Sender.send('engineer:status', { status: 'idle' })
        this.clearIdleTimer()
        return
      }

      Sender.send('engineer:advice', {
        id,
        text: cleanText,
        firing: { code: firing.reasonCode, priority: firing.priority },
        ts: Date.now()
      })
      Sender.send('engineer:status', { status: 'idle' })
      logger.info(`engineer advice [${firing.reasonCode}]: ${cleanText.slice(0, 80)}`)
      // settle to idle after the (approx) speaking window; clear any previous timer first
      this.clearIdleTimer()
      this.idleTimer = setTimeout(() => Sender.send('engineer:status', { status: 'idle' }), 6000)
    } catch (err) {
      if (this.isAbort(err)) {
        logger.info('engineer advice aborted')
        this.clearIdleTimer()
        Sender.send('engineer:status', { status: 'idle' })
        return
      }
      const message = (err as Error)?.message ?? String(err)
      logger.error('engineer advice failed:', message)
      Sender.send('engineer:status', { status: 'error', message: message.slice(0, 500) })
      this.clearIdleTimer()
    }
  }

  private isAbort(err: unknown): boolean {
    return err instanceof Error && err.name === 'AbortError'
  }

  /** For the stub path, stream tokens to mimic the LLM (local, synchronous chunking). */
  private simulateStream(text: string, onDelta: (d: string) => void): string {
    for (const t of text.split(/(\s+)/)) if (t) onDelta(t)
    return text
  }
}

/** Backend interface — stub implements it inline, DshBackend implements it in P3. */
export interface EngineerBackend {
  cancel?(): void
  generate(
    digest: ReturnType<DigestBuilder['build']>,
    digestText: string,
    firing: TriggerFiring,
    manualPrompt: string | undefined,
    onDelta: (delta: string) => void,
    audioBase64?: string
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

function cleanAutoTriggerAcknowledgement(text: string, firing: TriggerFiring): string {
  if (firing.reasonCode === 'manual') return text
  return stripAutoAcknowledgement(text)
}

function stripAutoAcknowledgement(text: string): string {
  return text
    .replace(/^\s*(copy|copied|received|roger|ok|okay)[,.，。!\s-]*/i, '')
    .replace(/^\s*(收到|明白|了解|好的|好)[，。,.！!\s-]*/u, '')
}

function createDeltaEmitter(firing: TriggerFiring, emit: (delta: string) => void): (delta: string) => void {
  if (firing.reasonCode === 'manual') return emit
  let pending = ''
  let decided = false
  return (delta: string): void => {
    if (decided) {
      emit(delta)
      return
    }
    pending += delta
    const stripped = stripAutoAcknowledgement(pending)
    if (stripped !== pending) {
      decided = true
      if (stripped) emit(stripped)
      return
    }
    if (mightStillBecomeAcknowledgement(pending)) return
    decided = true
    emit(pending)
  }
}

function mightStillBecomeAcknowledgement(text: string): boolean {
  const s = text.trimStart().toLowerCase()
  if (!s) return true
  const candidates = ['copy', 'copied', 'received', 'roger', 'ok', 'okay', '收到', '明白', '了解', '好的', '好']
  return candidates.some((word) => word.startsWith(s))
}
