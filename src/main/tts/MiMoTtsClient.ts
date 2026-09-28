import { SseParser } from './SseParser'
import { logger } from '../logging/Logger'

export interface MiMoConfig {
  baseURL: string // e.g. https://api.xiaomimimo.com/v1  (must include /v1)
  apiKey: string
  model: string // mimo-v2.5-tts
}

/** Hard deadline per synthesis request (a stalled upstream must not wedge the radio). */
const REQUEST_TIMEOUT_MS = 30_000

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
 * MiMo's mimo-v2.5-tts low-latency streaming returns audio chunks as they are ready.
 */
export class MiMoTtsClient {
  /** Every in-flight synthesis, including settings tests, so cancellation is complete. */
  private activeAborts = new Set<AbortController>()

  constructor(private config: MiMoConfig) {}

  get ready(): boolean {
    return !!this.config.baseURL && !!this.config.apiKey
  }

  /** Abort the in-flight synthesis (preemption / cancel). */
  cancel(): void {
    for (const controller of this.activeAborts) controller.abort()
    this.activeAborts.clear()
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
    if (signal?.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError')
    }

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

    // Per-request parser and controller keep concurrent requests isolated.
    const parser = new SseParser()
    const abort = new AbortController()
    this.activeAborts.add(abort)
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      abort.abort()
    }, REQUEST_TIMEOUT_MS)
    // also honor an externally-supplied signal (cancellation from the pipeline)
    const onExternalAbort = (): void => abort.abort()
    signal?.addEventListener('abort', onExternalAbort, { once: true })

    let done = false

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': this.config.apiKey
        },
        body: JSON.stringify(body),
        signal: abort.signal
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
          parser.feed(value, onChunk, (chunksReceived) => {
            if (chunksReceived === 0) {
              logger.warn('MiMo TTS stream completed with 0 audio chunks — check SSE format')
            }
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
      if (timedOut) {
        logger.error('MiMo TTS timed out')
        throw new Error(`MiMo TTS timed out after ${REQUEST_TIMEOUT_MS / 1000}s`)
      }
      if (this.isAbort(err)) {
        logger.info('MiMo TTS stream aborted')
        throw err // re-throw so AudioPipeline can distinguish abort from success
      }
      throw err
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onExternalAbort)
      this.activeAborts.delete(abort)
    }
  }

  private isAbort(err: unknown): boolean {
    return err instanceof Error && (err.name === 'AbortError' || /aborted/i.test(err.message))
  }
}
