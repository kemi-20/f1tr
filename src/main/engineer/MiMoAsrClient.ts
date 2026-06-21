import { logger } from '../logging/Logger'

export interface MiMoAsrConfig {
  baseURL: string
  apiKey: string
  model: string // mimo-v2.5-asr
}

/**
 * MiMoAsrClient — speech-to-text via MiMo's ASR model (mimo-v2.5-asr).
 *
 * Uses the OpenAI-compatible /audio/transcriptions endpoint.
 * POST {baseURL}/audio/transcriptions  (multipart/form-data)
 *   file: audio blob, model: mimo-v2.5-asr
 * Returns: { text: "transcribed text" }
 */
export class MiMoAsrClient {
  constructor(private config: MiMoAsrConfig) {}

  get ready(): boolean {
    return !!this.config.baseURL && !!this.config.apiKey
  }

  async transcribe(base64Audio: string, format: string): Promise<string> {
    if (!this.ready) throw new Error('MiMo ASR not configured (missing baseURL/apiKey)')

    const url = this.config.baseURL.replace(/\/+$/, '') + '/audio/transcriptions'
    const buffer = Buffer.from(base64Audio, 'base64')
    const blob = new Blob([buffer], { type: `audio/${format}` })

    const formData = new FormData()
    formData.append('file', blob, `audio.${format}`)
    formData.append('model', this.config.model)

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
        body: formData
      })

      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        throw new Error(`MiMo ASR HTTP ${res.status}: ${errText.slice(0, 200)}`)
      }

      const json = (await res.json()) as { text?: string }
      const text = json.text ?? ''
      if (!text) throw new Error('MiMo ASR returned empty transcription')
      logger.info(`MiMo ASR: transcribed (${text.length} chars): ${text.slice(0, 60)}`)
      return text
    } catch (err) {
      logger.error('MiMo ASR failed:', (err as Error)?.message ?? err)
      throw err
    }
  }
}
