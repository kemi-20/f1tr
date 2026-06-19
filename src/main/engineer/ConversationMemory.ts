import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { systemPrompt } from './Persona'
import { SessionPrimeBuilder } from './SessionPrimeBuilder'
import type { RaceState } from '@shared/types/state'
import type { LanguageMode } from '@shared/constants/voices'
import { logger } from '../logging/Logger'

/**
 * ConversationMemory — assembles the three-layer message array for the LLM:
 *
 *   layer 1: stable system persona          (cached)
 *   layer 2: session prime baseline text    (cached, rebuilt on session change)
 *   layer 3: recent assistant advice (rolling) + current digest (fresh)
 *
 * Layers 1+2 are kept at the FRONT and unchanged between calls so the provider's
 * prompt-cache hits. Only the rolling tail (layer 3) varies.
 */
export class ConversationMemory {
  private mode: LanguageMode = 'zh'
  private primeText = ''
  private primeSessionUID = ''
  private primeBuilder = new SessionPrimeBuilder()
  private recentAdvice: string[] = []

  constructor(
    private readonly maxTurns = 6
  ) {}

  setLanguage(mode: LanguageMode): void {
    if (this.mode !== mode) {
      this.mode = mode
      logger.info(`engineer language mode -> ${mode}`)
    }
  }

  /**
   * Ensure the prime is built for the current session. Rebuilds on session change.
   * Returns true if the prime was (re)built this call.
   */
  primeIfNeeded(state: RaceState): boolean {
    const uid = state.session.sessionUID
    if (this.primeText && this.primeSessionUID === uid) return false
    this.primeText = this.primeBuilder.build(state)
    this.primeSessionUID = uid
    logger.info(`session prime built for ${state.session.trackName || 'session'} (${uid || 'n/a'})`)
    return true
  }

  get prime(): string {
    return this.primeText
  }

  /** Record a completed assistant message into the rolling window. */
  pushAdvice(text: string): void {
    this.recentAdvice.push(text)
    if (this.recentAdvice.length > this.maxTurns) {
      this.recentAdvice = this.recentAdvice.slice(-this.maxTurns)
    }
  }

  /**
   * Build the full message array for a new LLM call.
   * `digestText` is the fresh layer-3 user turn.
   */
  build(digestText: string): ChatCompletionMessageParam[] {
    const msgs: ChatCompletionMessageParam[] = []
    // layer 1 + 2 combined into a single stable system message (max cache benefit)
    const sys = [systemPrompt(this.mode), this.primeText ? `\n\n${this.primeText}` : ''].join('')
    msgs.push({ role: 'system', content: sys })

    // layer 3a: recent advice as alternating turns gives conversational continuity
    for (const a of this.recentAdvice) {
      msgs.push({ role: 'assistant', content: a })
    }

    // layer 3b: fresh digest
    msgs.push({ role: 'user', content: digestText })
    return msgs
  }

  reset(): void {
    this.primeText = ''
    this.primeSessionUID = ''
    this.recentAdvice = []
  }
}
