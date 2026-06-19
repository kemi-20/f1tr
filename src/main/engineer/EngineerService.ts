import { nanoid } from 'nanoid'
import { Sender } from '../ipc/sender'
import { DigestBuilder } from './DigestBuilder'
import { StubAdvice } from './StubAdvice'
import { ConversationMemory } from './ConversationMemory'
import { getEngineerStyle } from '@shared/personas/engineer-styles'
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
    // update TTS direction to match the engineer style's voice direction
    const es = getEngineerStyle(style)
    this.direction = es.ttsDirection
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
      this.pending = { state, firing }
    }
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const llm = this.llm as any
    llm?.cancel?.()
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

    try {
      const text = this.llm
        ? await this.llm.generate(digest, digestText, firing, manualPrompt, (delta) => {
            Sender.send('engineer:text', { id, delta })
          })
        : this.simulateStream(this.stub.generate(digest), (delta) => {
            Sender.send('engineer:text', { id, delta })
          })

      // success path: commit + speak, then settle to idle so pills don't stick
      Sender.send('engineer:advice', {
        id,
        text,
        firing: { code: firing.reasonCode, priority: firing.priority },
        ts: Date.now()
      })
      Sender.send('engineer:status', { status: 'speaking' })
      logger.info(`engineer advice [${firing.reasonCode}] stub=${!this.llm}: ${text.slice(0, 80)}`)
      if (text) this.onSpeak(text, firing, this.voice, this.direction)
      // settle to idle after the (approx) speaking window; clearing the UI cursor
      setTimeout(() => Sender.send('engineer:status', { status: 'idle' }), 6000)
    } catch (err) {
      if (this.isAbort(err)) {
        // cancelled/preempted — do NOT commit partial text or enqueue TTS; reset to idle
        logger.info('engineer advice aborted')
        Sender.send('engineer:status', { status: 'idle' })
        return
      }
      logger.error('engineer advice failed:', (err as Error)?.message ?? err)
      Sender.send('engineer:status', { status: 'error' })
      setTimeout(() => Sender.send('engineer:status', { status: 'idle' }), 4000)
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
