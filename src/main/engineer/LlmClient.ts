import OpenAI from 'openai'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import type { EngineerBackend } from './EngineerService'
import type { Digest } from '@shared/types/digest'
import type { TriggerFiring } from '@shared/types/triggers'
import type { ConversationMemory } from './ConversationMemory'
import type { MiMoVisionClient } from './MiMoVisionClient'
import { captureF1Screenshot } from '../screenshot/ScreenshotService'
import { logger } from '../logging/Logger'

export interface LlmConfig {
  baseURL: string // e.g. https://api.deepseek.com/v1
  apiKey: string
  model: string // e.g. deepseek-v4-flash
  temperature: number
  maxTokens: number
  visionSupported: boolean // whether the configured model can accept image input
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
    private memory: ConversationMemory,
    private visionClient: MiMoVisionClient | null = null
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
    onDelta: (delta: string) => void,
    audioBase64?: string
  ): Promise<string> {
    if (!this.client) throw new Error('LLM backend not configured (missing baseURL/apiKey)')
    this.abort = new AbortController()
    void firing

    const turn = this.renderDigestTurn(digest, digestText, manualPrompt)
    const messages: ChatCompletionMessageParam[] = this.memory.build(turn)

    // If audio is provided (voice message from driver), append audio content to the last user message
    if (audioBase64) {
      const lastMsg = messages[messages.length - 1]
      if (lastMsg && lastMsg.role === 'user') {
        const textContent = typeof lastMsg.content === 'string' ? lastMsg.content : ''
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(lastMsg as any).content = [
          { type: 'text', text: textContent + '\n[DRIVER VOICE MESSAGE - audio attached]' },
          { type: 'input_audio', input_audio: { data: audioBase64, format: 'mp3' } }
        ]
      }
    }

    // Tool: capture_screenshot — the AI can call this to see the game screen.
    const tools = [{
      type: 'function' as const,
      function: {
        name: 'capture_screenshot',
        description: 'Capture a screenshot of the F1 25 game window. Use this when you need visual context beyond telemetry data (e.g., to see track position, weather effects, on-screen HUD, or damage details).',
        parameters: { type: 'object' as const, properties: {}, required: [] as string[] }
      }
    }]

    let finalText = ''
    const maxToolRounds = 3

    for (let round = 0; round <= maxToolRounds; round++) {
      const isLastRound = round === maxToolRounds
      let text = ''
      try {
        const base = {
          model: this.config.model,
          messages,
          temperature: this.config.temperature,
          max_tokens: this.config.maxTokens,
          stream: true as const,
          stream_options: { include_usage: true },
          ...(isLastRound ? {} : { tools })
        }
        const body = { ...base, thinking: { type: 'disabled' } }
        const stream = (await this.client.chat.completions.create(
          body as Parameters<typeof this.client.chat.completions.create>[0],
          { signal: this.abort.signal }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        )) as any

        const controller = this.abort
        const watchdog = setTimeout(() => { logger.warn('LLM stream watchdog (30s) — aborting'); controller?.abort() }, 30_000)

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let usage: any = null
        let finishReason: string | null = null
        const toolCallAcc = new Map<number, { id: string; name: string; arguments: string }>()
        try {
          for await (const part of stream) {
            const delta = part.choices[0]?.delta?.content ?? ''
            if (delta) { text += delta; onDelta(delta) }
            const tcDeltas = part.choices[0]?.delta?.tool_calls
            if (tcDeltas) {
              for (const tc of tcDeltas) {
                const idx = tc.index ?? 0
                if (!toolCallAcc.has(idx)) toolCallAcc.set(idx, { id: tc.id ?? '', name: tc.function?.name ?? '', arguments: '' })
                const ex = toolCallAcc.get(idx)!
                if (tc.id) ex.id = tc.id
                if (tc.function?.name) ex.name = tc.function.name
                if (tc.function?.arguments) ex.arguments += tc.function.arguments
              }
            }
            if (part.choices[0]?.finish_reason) finishReason = part.choices[0].finish_reason as string
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if ((part as any).usage) usage = (part as any).usage
          }
        } finally {
          clearTimeout(watchdog)
        }
        if (usage) this.logUsage(usage)

        // If the model called a tool, execute it and continue the conversation
        if (finishReason === 'tool_calls' && toolCallAcc.size > 0 && !isLastRound) {
          messages.push({
            role: 'assistant',
            content: text || null,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            tool_calls: Array.from(toolCallAcc.values()).map((tc) => ({
              id: tc.id, type: 'function' as const,
              function: { name: tc.name, arguments: tc.arguments }
            })) as any
          } as ChatCompletionMessageParam)
          for (const tc of Array.from(toolCallAcc.values())) {
            if (tc.name === 'capture_screenshot') {
              const toolResult = await this.executeScreenshotTool()
              messages.push({ role: 'tool', tool_call_id: tc.id, content: toolResult } as ChatCompletionMessageParam)
            }
          }
          continue // next round — model responds after seeing the tool result
        }
        finalText = text
        break
      } catch (err) {
        if (this.isAbort(err)) {
          logger.info('LLM stream aborted — not committing partial text')
          throw err
        }
        throw err
      }
    } // end tool-calling loop

    this.memory.pushTurn(turn, finalText || '(no response)')
    return finalText
  }

  /**
   * Execute the capture_screenshot tool.
   * - If the model supports vision: return image content (base64 PNG).
   * - If not: send to MiMo mimo-v2.5 for text description, return that.
   */
  private async executeScreenshotTool(): Promise<string | unknown[]> {
    const base64 = await captureF1Screenshot()
    if (!base64) return 'Screenshot capture failed — no F1 25 window or screen found.'
    if (this.config.visionSupported) {
      return [
        { type: 'text', text: 'Screenshot of the F1 25 game window:' },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } }
      ]
    }
    if (!this.visionClient) return 'Screenshot captured but no MiMo vision client configured for image description.'
    try {
      const description = await this.visionClient.describeImage(base64)
      return `MiMo vision description of the F1 25 screenshot:\n${description}`
    } catch (err) {
      return `Screenshot captured but MiMo vision description failed: ${(err as Error)?.message ?? err}`
    }
  }

  private renderDigestTurn(d: Digest, digestText: string, manualPrompt?: string): string {
    const isManual = manualPrompt != null || d.trigger.code === 'manual'
    const header = isManual
      ? manualHeader(this.memory.languageMode, manualPrompt ?? d.trigger.reason)
      : autoHeader(this.memory.languageMode, d.trigger.reason)
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

function manualHeader(mode: ConversationMemory['languageMode'], prompt: string): string {
  switch (mode) {
    case 'zh':
      return `来源：车手主动询问\n车手：${prompt}\n比赛状态：`
    case 'mixed':
      return `SOURCE: DRIVER_MESSAGE / 车手主动询问\nDRIVER: ${prompt}\nRACE STATE / 比赛状态：`
    case 'en':
      return `SOURCE: DRIVER_MESSAGE\nDRIVER: ${prompt}\nRACE STATE:`
  }
}

function autoHeader(mode: ConversationMemory['languageMode'], reason: string): string {
  switch (mode) {
    case 'zh':
      return `来源：系统自动触发\n触发原因：${reason}\n自动播报规则：不要确认，不要以 Copy/Received/OK/收到/明白 开头，直接给建议。\n比赛状态：`
    case 'mixed':
      return `SOURCE: AUTO_TRIGGER / 系统自动触发\nTRIGGER: ${reason}\nAUTO-RADIO RULE: 不要确认，不要以 Copy/Received/OK/收到/明白 开头，直接给 advice。\nRACE STATE / 比赛状态：`
    case 'en':
      return `SOURCE: AUTO_TRIGGER\nTRIGGER: ${reason}\nAUTO-RADIO RULE: Do not acknowledge. Do not start with Copy/Received/OK/收到/明白. Start directly with advice.\nRACE STATE:`
  }
}

export type { ChatCompletionMessageParam }
