import { logger } from '../logging/Logger'

export interface MiMoVisionConfig {
  baseURL: string // e.g. https://api.xiaomimimo.com/v1
  apiKey: string
  model: string // mimo-v2.6-flash
}

/**
 * MiMoVisionClient — describes a screenshot with an image-capable chat model.
 * and returns a detailed text description.
 *
 * The description is passed back to the DSH model as a text tool result.
 */
export class MiMoVisionClient {
  constructor(private config: MiMoVisionConfig) {}

  get ready(): boolean {
    return !!this.config.baseURL && !!this.config.apiKey
  }

  async describeImage(base64Png: string, signal?: AbortSignal): Promise<string> {
    if (!this.ready) throw new Error('MiMo vision not configured (missing baseURL/apiKey)')

    const url = this.config.baseURL.replace(/\/+$/, '') + '/chat/completions'
    const body = {
      model: this.config.model,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: '这是一张 F1 25 或 F1 26 游戏截图。请描述画面中能直接确认的赛道、排名、圈数、轮胎、天气、旗语和策略信息；看不清的内容不要猜测。'
            },
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${base64Png}` }
            }
          ]
        }
      ],
      reasoning_effort: 'none',
      max_completion_tokens: 600,
      temperature: 0.3
    }

    try {
      const res = await fetch(url, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'Content-Type': 'application/json',
          authorization: `Bearer ${this.config.apiKey}`
        },
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
        body: JSON.stringify(body)
      })

      if (!res.ok) {
        throw new Error(`MiMo vision HTTP ${res.status}`)
      }

      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>
      }
      const description = json.choices?.[0]?.message?.content ?? ''
      if (typeof description !== 'string' || !description.trim() || description.length > 20_000) throw new Error('MiMo vision returned invalid description')
      logger.info(`MiMo vision: described image (${description.length} chars)`)
      return description
    } catch (err) {
      logger.error('MiMo vision failed:', (err as Error)?.message ?? err)
      throw err
    }
  }
}
