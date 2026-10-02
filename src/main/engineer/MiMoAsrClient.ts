import { logger } from '../logging/Logger'

export interface MiMoAsrConfig {
  baseURL: string
  apiKey: string
  model: string // mimo-v2.6-flash
}

/** Audio containers the ASR endpoint accepts, mapped to their data-URL mime type. */
const AUDIO_MIME: Record<string, string> = {
  wav: 'audio/wav',
  mp3: 'audio/mpeg'
}

const MAX_BASE64_CHARS = 13_981_016 // 10MB decoded, per the MiMo ASR limit
const REQUEST_TIMEOUT_MS = 30_000

/**
 * MiMoAsrClient — speech-to-text via MiMo's multimodal model (mimo-v2.6-flash).
 *
 * MiMo ASR API spec:
 *   POST {baseURL}/chat/completions
 *   Audio passed as content array:
 *     [{ type:"input_audio", input_audio:{ data:"data:audio/wav;base64,..." } }]
 *   Max base64 size: 10MB
 * Returns: { choices: [{ message: { content: "transcribed text" } }] }
 */
export class MiMoAsrClient {
  constructor(private config: MiMoAsrConfig) {}

  get ready(): boolean {
    return !!this.config.baseURL && !!this.config.apiKey
  }

  async transcribe(base64Audio: string, format: string, signal?: AbortSignal): Promise<string> {
    if (!this.ready) throw new Error('MiMo ASR not configured (missing baseURL/apiKey)')
    const mime = AUDIO_MIME[format]
    // Reject malformed/oversized payloads before they reach the upstream endpoint.
    if (!mime || typeof base64Audio !== 'string' || base64Audio.length === 0 ||
        base64Audio.length > MAX_BASE64_CHARS || base64Audio.length % 4 !== 0 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(base64Audio)) {
      throw new Error('Invalid audio input')
    }
    if (!hasContainerHeader(Buffer.from(base64Audio.slice(0, 16), 'base64'), format)) {
      throw new Error(`Invalid ${format.toUpperCase()} audio input`)
    }

    const url = this.config.baseURL.replace(/\/+$/, '') + '/chat/completions'
    const dataUrl = `data:${mime};base64,${base64Audio}`
    const body = {
      model: this.config.model,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'input_audio',
              input_audio: { data: dataUrl }
            }
          ]
        }
      ],
      asr_options: { language: 'auto' },
      reasoning_effort: 'none',
      max_tokens: 500
    }

    // Hard deadline: a half-open upstream connection must not leave the radio stuck
    // in 'transcribing' forever.
    const abort = new AbortController()
    const onAbort = (): void => abort.abort()
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) abort.abort()
    const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS)
    try {
      const res = await fetch(url, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'Content-Type': 'application/json',
          'api-key': this.config.apiKey
        },
        body: JSON.stringify(body),
        signal: abort.signal
      })

      if (!res.ok) {
        const status = res.status
        throw new Error(`MiMo ASR HTTP ${status}`)
      }

      const json = (await res.json()) as { text?: string; choices?: Array<{ message?: { content?: string } }> }
      logger.info(`MiMo ASR response keys: ${Object.keys(json).join(',')}`)
      // Response may be { text: "..." } or { choices: [{ message: { content: "..." } }] }
      const text = json.text ?? json.choices?.[0]?.message?.content ?? ''
      if (typeof text !== 'string' || !text.trim() || text.length > 4096) throw new Error('MiMo ASR returned invalid transcription')
      logger.info(`MiMo ASR: transcribed ${text.length} chars`)
      return text
    } catch (err) {
      if (signal?.aborted) throw new DOMException('ASR cancelled', 'AbortError')
      if (abort.signal.aborted) {
        logger.error('MiMo ASR timed out')
        throw new Error(`MiMo ASR timed out after ${REQUEST_TIMEOUT_MS / 1000}s`)
      }
      logger.error('MiMo ASR failed:', (err as Error)?.message ?? err)
      throw err
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
  }
}

/** Cheap container sniff: WAV must start with RIFF....WAVE, MP3 with ID3 or a frame sync. */
function hasContainerHeader(header: Buffer, format: string): boolean {
  if (format === 'wav') {
    return header.length >= 12 &&
      header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WAVE'
  }
  if (format === 'mp3') {
    const hasId3 = header.length >= 3 && header[0] === 0x49 && header[1] === 0x44 && header[2] === 0x33
    const hasFrame = header.length >= 2 && header[0] === 0xff && (header[1] & 0xe0) === 0xe0
    return hasId3 || hasFrame
  }
  return false
}
