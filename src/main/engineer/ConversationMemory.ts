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
 *   layer 3: recent user/assistant turns (rolling) + current digest (fresh)
 *
 * Layers 1+2 are kept at the FRONT and unchanged between calls so the provider's
 * prompt-cache hits. Only the rolling tail (layer 3) varies.
 */
export class ConversationMemory {
  private mode: LanguageMode = 'zh'
  private engineerStyle: string = 'gp'
  private primeText = ''
  private primeSessionUID = ''
  private primeBuilder = new SessionPrimeBuilder()
  // store as user+assistant PAIRS so the conversation alternates correctly
  private recentTurns: { user: string; assistant: string }[] = []

  constructor(
    private maxTurns = 6
  ) {}

  setMaxTurns(maxTurns: number): void {
    this.maxTurns = Math.max(0, Math.min(20, Math.round(maxTurns)))
    if (this.recentTurns.length > this.maxTurns) {
      this.recentTurns = this.maxTurns === 0 ? [] : this.recentTurns.slice(-this.maxTurns)
    }
  }

  setLanguage(mode: LanguageMode): void {
    if (this.mode !== mode) {
      this.mode = mode
      this.reset()
      logger.info(`engineer language mode -> ${mode}`)
    }
  }

  setEngineerStyle(style: string): void {
    if (this.engineerStyle !== style) {
      this.engineerStyle = style
      this.reset()
      logger.info(`engineer style -> ${style}`)
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

  get languageMode(): LanguageMode {
    return this.mode
  }

  /** Record a completed user→assistant turn into the rolling window. */
  pushTurn(userDigest: string, assistantReply: string): void {
    this.recentTurns.push({ user: userDigest, assistant: assistantReply })
    if (this.recentTurns.length > this.maxTurns) {
      this.recentTurns = this.maxTurns === 0 ? [] : this.recentTurns.slice(-this.maxTurns)
    }
  }

  /**
   * Build the full message array for a new LLM call.
   * `digestText` is the fresh layer-3 user turn.
   */
  build(digestText: string): ChatCompletionMessageParam[] {
    const msgs: ChatCompletionMessageParam[] = []
    // layer 1 + 2 combined into a single stable system message (max cache benefit)
    const sys = [systemPrompt(this.mode, this.engineerStyle), this.primeText ? `\n\n${this.primeText}` : ''].join('')
    msgs.push({ role: 'system', content: sys })

    // layer 3a: recent turns as alternating user/assistant pairs (proper chat format)
    for (const t of this.recentTurns) {
      msgs.push({ role: 'user', content: t.user })
      msgs.push({ role: 'assistant', content: t.assistant })
    }

    // layer 3b: fresh digest
    msgs.push({ role: 'user', content: digestText })
    return msgs
  }

  reset(): void {
    this.primeText = ''
    this.primeSessionUID = ''
    this.recentTurns = []
  }
}
