import { logger } from '../logging/Logger'

export interface MiMoAsrConfig {
  baseURL: string
  apiKey: string
  model: string // mimo-v2.6-flash
}

/**
 * MiMoAsrClient — speech-to-text via MiMo's multimodal model (mimo-v2.6-flash).
 *
 * MiMo ASR API spec:
 *   POST {baseURL}/chat/completions
 *   Audio passed as content array:
 *     [{ type:"input_audio", input_audio:{ data:"data:audio/mpeg;base64,..." } }]
 *   Max base64 size: 10MB
 * Returns: { choices: [{ message: { content: "transcribed text" } }] }
 */
export class MiMoAsrClient {
  constructor(private config: MiMoAsrConfig) {}

  get ready(): boolean {
    return !!this.config.baseURL && !!this.config.apiKey
  }

  async transcribe(base64Audio: string, format: string): Promise<string> {
    if (!this.ready) throw new Error('MiMo ASR not configured (missing baseURL/apiKey)')
    if (format !== 'mp3' || typeof base64Audio !== 'string' || base64Audio.length === 0 ||
        base64Audio.length > 13_981_016 || base64Audio.length % 4 !== 0 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(base64Audio)) {
      throw new Error('Invalid MP3 audio input')
    }
    const header = Buffer.from(base64Audio.slice(0, 8), 'base64')
    const hasId3 = header.length >= 3 && header[0] === 0x49 && header[1] === 0x44 && header[2] === 0x33
    const hasFrame = header.length >= 2 && header[0] === 0xff && (header[1] & 0xe0) === 0xe0
    if (!hasId3 && !hasFrame) throw new Error('Invalid MP3 audio input')

    const url = this.config.baseURL.replace(/\/+$/, '') + '/chat/completions'
    const dataUrl = `data:audio/mpeg;base64,${base64Audio}`
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
      max_tokens: 500
    }

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': this.config.apiKey
        },
        body: JSON.stringify(body)
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
      logger.error('MiMo ASR failed:', (err as Error)?.message ?? err)
      throw err
    }
  }
}
