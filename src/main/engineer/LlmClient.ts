import OpenAI from 'openai'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import type { EngineerBackend } from './EngineerService'
import type { Digest } from '@shared/types/digest'
import type { TriggerFiring } from '@shared/types/triggers'
import type { ConversationMemory } from './ConversationMemory'
import { logger } from '../logging/Logger'

export interface LlmConfig {
  baseURL: string // e.g. https://api.deepseek.com/v1
  apiKey: string
  model: string // e.g. deepseek-v4-flash
  temperature: number
  maxTokens: number
}

/**
 * LlmClient — the real OpenAI-compatible backend (P3).
 *
 * Uses the official `openai` SDK with a configurable baseURL (DeepSeek / OpenAI / local Ollama).
 * Streams tokens to the renderer; on completion enqueues TTS (handled by EngineerService in P5).
 *
 * DeepSeek specifics (auto prompt-cache): the provider caches the stable prefix automatically;
 * the response `usage` object reports hit/miss via `prompt_cache_hit_tokens` /
 * `prompt_cache_miss_tokens` (when present). We log these to confirm cache hits.
 */
export class LlmClient implements EngineerBackend {
  private client: OpenAI | null = null
  private abort: AbortController | null = null

  constructor(
    private config: LlmConfig,
    private memory: ConversationMemory
  ) {
    this.rebuildClient()
  }

  private rebuildClient(): void {
    if (!this.config.baseURL || !this.config.apiKey) {
      logger.warn('LlmClient: missing baseURL or apiKey — backend inactive')
      this.client = null
      return
    }
    this.client = new OpenAI({
      baseURL: this.config.baseURL,
      apiKey: this.config.apiKey,
      // main process only; never exposed to renderer
      dangerouslyAllowBrowser: false
    })
  }

  updateConfig(config: LlmConfig): void {
    this.config = config
    this.rebuildClient()
  }

  get ready(): boolean {
    return this.client != null
  }

  /** Minimal round-trip for the "Test connection" button. */
  async ping(): Promise<boolean> {
    if (!this.client) return false
    try {
      const res = await this.client.chat.completions.create({
        model: this.config.model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 5,
        thinking: { type: 'disabled' }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
      const content = res.choices[0]?.message?.content
      return !!content || !!res.usage
    } catch (err) {
      logger.warn('LLM ping failed:', (err as Error)?.message ?? err)
      return false
    }
  }

  /** Abort any in-flight stream (for the Stop button / preemption). */
  cancel(): void {
    this.abort?.abort()
    this.abort = null
  }

  async generate(
    digest: Digest,
    digestText: string,
    firing: TriggerFiring,
    manualPrompt: string | undefined,
    onDelta: (delta: string) => void
  ): Promise<string> {
    if (!this.client) throw new Error('LLM backend not configured (missing baseURL/apiKey)')
    this.abort = new AbortController()
    void firing

    // Build the layer-3 digest text (the fresh user turn). Includes trigger + manual prompt.
    const turn = this.renderDigestTurn(digest, digestText, manualPrompt)
    const messages = this.memory.build(turn)

    let text = ''
    try {
      // base typed params (keeps the streaming overload intact) + non-standard thinking field
      const base = {
        model: this.config.model,
        messages,
        temperature: this.config.temperature,
        max_tokens: this.config.maxTokens,
        stream: true as const,
        stream_options: { include_usage: true }
      }
      // DeepSeek v4 thinking defaults to ENABLED — emits a chain-of-thought BEFORE the answer,
      // which wrecks voice latency and burns tokens. Disabled here. Non-standard field,
      // ignored by OpenAI/Ollama.
      const body = { ...base, thinking: { type: 'disabled' } }
      const stream = (await this.client.chat.completions.create(
        body as Parameters<typeof this.client.chat.completions.create>[0],
        { signal: this.abort.signal }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      )) as any

      // watchdog: don't let a stalled stream hang the single-slot queue for minutes.
      // Capture the controller locally so a new generate() starting before the timeout
      // doesn't abort the wrong stream.
      const controller = this.abort
      const watchdog = setTimeout(
        () => {
          logger.warn('LLM stream watchdog (30s) — aborting')
          controller?.abort()
        },
        30_000
      )

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let usage: any = null
      try {
        for await (const part of stream) {
          const delta = part.choices[0]?.delta?.content ?? ''
          if (delta) {
            text += delta
            onDelta(delta)
          }
          // usage arrives in the final chunk (choices empty, usage populated)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if ((part as any).usage) usage = (part as any).usage
        }
      } finally {
        clearTimeout(watchdog)
      }

      if (usage) {
        this.logUsage(usage)
      }
      // record into rolling memory as a user+assistant pair (proper chat alternation)
      this.memory.pushTurn(turn, text || '(no response)')
      return text
    } catch (err) {
      if (this.isAbort(err)) {
        // abort = user cancelled / preempt. Re-throw so advise() knows it wasn't a normal
        // completion and does NOT commit the truncated text as a finished spoken message.
        logger.info('LLM stream aborted — not committing partial text')
        throw err
      }
      throw err
    }
  }

  private renderDigestTurn(d: Digest, digestText: string, manualPrompt?: string): string {
    void d
    const header =
      manualPrompt != null
        ? `DRIVER: ${manualPrompt}\nRACE STATE:`
        : `TRIGGER: ${d.trigger.reason}\nRACE STATE:`
    return `${header}\n${digestText}`
  }

  private logUsage(usage: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
    // DeepSeek cache fields (when present)
    prompt_cache_hit_tokens?: number
    prompt_cache_miss_tokens?: number
  }): void {
    const hit = usage.prompt_cache_hit_tokens
    const miss = usage.prompt_cache_miss_tokens
    if (hit != null || miss != null) {
      logger.info(
        `LLM usage: prompt=${usage.prompt_tokens} completion=${usage.completion_tokens}` +
          ` cache_hit=${hit ?? 0} cache_miss=${miss ?? 0}`
      )
    } else {
      logger.info(`LLM usage: prompt=${usage.prompt_tokens} completion=${usage.completion_tokens} total=${usage.total_tokens}`)
    }
  }

  private isAbort(err: unknown): boolean {
    return err instanceof Error && err.name === 'AbortError'
  }
}

export type { ChatCompletionMessageParam }
