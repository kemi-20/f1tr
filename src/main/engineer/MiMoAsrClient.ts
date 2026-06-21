import { logger } from '../logging/Logger'

export interface MiMoAsrConfig {
  baseURL: string
  apiKey: string
  model: string // mimo-v2.5-asr
}

/**
 * MiMoAsrClient — speech-to-text via MiMo's ASR model (mimo-v2.5-asr).
 *
 * MiMo ASR API spec (https://mimo.mi.com/docs/zh-CN/api/audio/Speech-Recognition):
 *   POST {baseURL}/chat/completions
 *   Audio passed as base64 data URL in message content:
 *     data:audio/mpeg;base64,...  (also supports audio/wav, audio/mp3)
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

    const url = this.config.baseURL.replace(/\/+$/, '') + '/chat/completions'
    // MiMo ASR: data:{MIME_TYPE};base64,$BASE64_AUDIO
    const mimeType = format === 'mp3' ? 'audio/mpeg' : `audio/${format}`
    const dataUrl = `data:${mimeType};base64,${base64Audio}`
    const body = {
      model: this.config.model,
      messages: [{ role: 'user', content: dataUrl }],
      max_tokens: 500
    }

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify(body)
      })

      if (!res.ok) {
        const status = res.status
        const errText = await res.text().catch(() => '')
        logger.error(`MiMo ASR HTTP ${status}: ${errText.slice(0, 500)}`)
        throw new Error(`MiMo ASR HTTP ${status}: ${errText.slice(0, 200)}`)
      }

      const json = (await res.json()) as { text?: string; choices?: Array<{ message?: { content?: string } }> }
      logger.info(`MiMo ASR response keys: ${Object.keys(json).join(',')}`)
      // Response may be { text: "..." } or { choices: [{ message: { content: "..." } }] }
      const text = json.text ?? json.choices?.[0]?.message?.content ?? ''
      if (!text) throw new Error('MiMo ASR returned empty transcription')
      logger.info(`MiMo ASR: transcribed ${text.length} chars: ${text.slice(0, 80)}`)
      return text
    } catch (err) {
      logger.error('MiMo ASR failed:', (err as Error)?.message ?? err)
      throw err
    }
  }
}
