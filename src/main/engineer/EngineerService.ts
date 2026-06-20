import { nanoid } from 'nanoid'
import { Sender } from '../ipc/sender'
import { DigestBuilder } from './DigestBuilder'
import { StubAdvice } from './StubAdvice'
import { ConversationMemory } from './ConversationMemory'
import { getEngineerSkill } from './EngineerSkillLibrary'
import type { TriggerFiring } from '@shared/types/triggers'
import type { RaceState } from '@shared/types/state'
import type { LanguageMode } from '@shared/constants/voices'
import { logger } from '../logging/Logger'

/**
 * EngineerService — orchestrates digest -> advice -> UI streaming + (later) TTS enqueue.
 *
 * In P2 this uses StubAdvice (no LLM). P3 swaps in the real LlmClient while keeping
 * the same digest/IPC contract. The manual "Ask Engineer" path reuses the digest so the
 * model always sees the current race picture.
 */
export class EngineerService {
  private digestBuilder = new DigestBuilder()
  private stub = new StubAdvice()
  private llm: EngineerBackend | null = null
  readonly memory = new ConversationMemory()
  private language: LanguageMode = 'zh'
  private voice = '冰糖'
  private direction = '冷静果断的 F1 赛车工程师语气'
  private inFlight: Promise<void> | null = null
  private pending: { state: RaceState; firing: TriggerFiring } | null = null
  private onSpeak: (text: string, firing: TriggerFiring, voice: string, direction: string) => void = () => {}
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

  get currentLanguage(): LanguageMode {
    return this.language
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
      // only replace pending if the new firing is higher-or-equal priority
      if (this.pending && !this.priorityGte(firing.priority, this.pending.firing.priority)) {
        return // existing pending is higher priority — keep it
      }
      this.pending = { state, firing }
    }
  }

  private priorityGte(a: TriggerFiring['priority'], b: TriggerFiring['priority']): boolean {
    const rank: Record<TriggerFiring['priority'], number> = { critical: 4, high: 3, normal: 2, low: 1 }
    return rank[a] >= rank[b]
  }

  private async run(state: RaceState, firing: TriggerFiring): Promise<void> {
    this.inFlight = this.advise(state, firing)
    try {
      await this.inFlight
    } finally {
      this.inFlight = null
      if (this.pending) {
        const next = this.pending
        this.pending = null
        void this.run(next.state, next.firing)
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
  async advise(state: RaceState, firing: TriggerFiring, manualPrompt?: string): Promise<void> {
    const id = nanoid(10)
    const digest = this.digestBuilder.build(state, firing)
    const digestText = this.digestBuilder.toText(digest)

    // ensure the session prime (cached baseline) is built / current before any LLM call
    this.memory.primeIfNeeded(state)

    Sender.send('engineer:status', { status: 'thinking' })
    const emitDelta = createDeltaEmitter(firing, (delta) => {
      Sender.send('engineer:text', { id, delta })
    })

    try {
      const rawText = this.llm
        ? await this.llm.generate(digest, digestText, firing, manualPrompt, emitDelta)
        : this.simulateStream(this.stub.generate(digest), emitDelta)
      const text = cleanAutoTriggerAcknowledgement(rawText, firing)

      // Parse 【NOW】/【HOLD】 prefix: AI judges speak-immediately vs hold-for-straight
      const isNow = /^【NOW】/i.test(text)
      const isHold = /^【HOLD】/i.test(text)
      const cleanText = text.replace(/^【(NOW|HOLD)】/i, '').trim()
      // speak if NOW, or if no prefix + critical; HOLD skips TTS
      const shouldSpeak = isNow || (!isHold && firing.priority === 'critical')

      Sender.send('engineer:advice', {
        id,
        text: cleanText,
        firing: { code: firing.reasonCode, priority: firing.priority },
        ts: Date.now()
      })
      Sender.send('engineer:status', { status: shouldSpeak ? 'speaking' : 'idle' })
      logger.info(`engineer advice [${firing.reasonCode}] speak=${shouldSpeak}: ${cleanText.slice(0, 80)}`)
      if (cleanText && shouldSpeak) this.onSpeak(cleanText, firing, this.voice, this.direction)
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
      logger.error('engineer advice failed:', (err as Error)?.message ?? err)
      Sender.send('engineer:status', { status: 'error' })
      this.clearIdleTimer()
      this.idleTimer = setTimeout(() => Sender.send('engineer:status', { status: 'idle' }), 4000)
    }
  }

  private isAbort(err: unknown): boolean {
    return err instanceof Error && (err.name === 'AbortError' || /abort/i.test(err.message))
  }

  /** For the stub path, stream tokens to mimic the LLM (local, synchronous chunking). */
  private simulateStream(text: string, onDelta: (d: string) => void): string {
    for (const t of text.split(/(\s+)/)) if (t) onDelta(t)
    return text
  }
}

/** Backend interface — stub implements it inline, LlmClient implements it in P3. */
export interface EngineerBackend {
  generate(
    digest: ReturnType<DigestBuilder['build']>,
    digestText: string,
    firing: TriggerFiring,
    manualPrompt: string | undefined,
    onDelta: (delta: string) => void
  ): Promise<string>
}

/** Construct a manual trigger firing (for the Ask Engineer button). */
export function manualFiring(prompt?: string): TriggerFiring {
  return {
    ruleId: 'manual',
    kind: 'event',
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
