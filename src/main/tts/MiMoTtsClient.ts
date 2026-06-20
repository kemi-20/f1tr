import { SseParser } from './SseParser'
import { logger } from '../logging/Logger'

export interface MiMoConfig {
  baseURL: string // e.g. https://api.xiaomimimo.com/v1  (must include /v1)
  apiKey: string
  model: string // mimo-v2.5-tts
}

/**
 * MiMoTtsClient — synthesizes speech via Xiaomi MiMo TTS.
 *
 * Request shape (VERIFIED — text to speak goes in the ASSISTANT message, style in the USER):
 *   POST {baseURL}/chat/completions
 *   { model, messages:[{role:'user',content:direction},{role:'assistant',content:text}],
 *     audio:{format:'pcm16',voice}, stream:true }
 * Response: SSE, each chunk choices[0].delta.audio.data = base64 PCM16
 *           (24000Hz, mono, int16 LE). Terminated by `data: [DONE]`.
 *
 * NOTE: MiMo's streaming is currently "compatibility mode" — the whole audio is synthesized
 * first then chunked, so stream:true does NOT reduce first-audio latency (~1-3s full synthesis).
 * We still stream so audio can begin playing as soon as chunks arrive.
 */
export class MiMoTtsClient {
  private parser = new SseParser()
  private abort: AbortController | null = null

  constructor(private config: MiMoConfig) {}

  get ready(): boolean {
    return !!this.config.baseURL && !!this.config.apiKey
  }

  /** Abort the in-flight synthesis (preemption / cancel). */
  cancel(): void {
    this.abort?.abort()
    this.abort = null
  }

  /**
   * Stream-synthesize `text` to PCM16 chunks.
   * onChunk receives base64 PCM16 strings; resolves when the stream ends ([DONE]).
   * Throws on HTTP error / non-2xx.
   */
  async synthesize(
    text: string,
    voice: string,
    direction: string,
    onChunk: (base64Pcm16: string) => void,
    signal?: AbortSignal
  ): Promise<void> {
    if (!this.ready) throw new Error('MiMo TTS not configured (missing MIMO_API_BASE_URL/MIMO_API_KEY)')
    // if an already-aborted signal was passed, bail immediately
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

    const url = this.config.baseURL.replace(/\/+$/, '') + '/chat/completions'
    const body = {
      model: this.config.model,
      messages: [
        { role: 'user', content: direction || 'calm, decisive F1 race engineer' },
        { role: 'assistant', content: text }
      ],
      audio: { format: 'pcm16', voice },
      stream: true
    }

    this.abort = new AbortController()
    // also honor an externally-supplied signal (cancellation from the pipeline)
    signal?.addEventListener('abort', () => this.abort?.abort(), { once: true })

    this.parser.reset()
    let done = false

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify(body),
        signal: this.abort.signal
      })

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => '')
        throw new Error(`MiMo TTS HTTP ${res.status}: ${errText.slice(0, 200)}`)
      }

      const reader = res.body.getReader()
      try {
        while (true) {
          const { value, done: streamDone } = await reader.read()
          if (streamDone) break
          this.parser.feed(value, onChunk, () => {
            done = true
          })
          if (done) break
        }
      } finally {
        try {
          await reader.cancel()
        } catch {
          /* noop */
        }
      }
      logger.debug(`MiMo TTS stream complete for voice=${voice}`)
    } catch (err) {
      if (this.isAbort(err)) {
        logger.info('MiMo TTS stream aborted')
        return
      }
      throw err
    }
  }

  private isAbort(err: unknown): boolean {
    return err instanceof Error && (err.name === 'AbortError' || /aborted/i.test(err.message))
  }
}
