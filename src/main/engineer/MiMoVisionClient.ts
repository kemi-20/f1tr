import { logger } from '../logging/Logger'

export interface MiMoVisionConfig {
  baseURL: string // e.g. https://api.xiaomimimo.com/v1
  apiKey: string
  model: string // mimo-v2.5
}

/**
 * MiMoVisionClient — sends a screenshot to MiMo's vision model (mimo-v2.5)
 * and returns a detailed text description.
 *
 * Used when the default LLM does NOT support image input: the screenshot is
 * described by MiMo, then the description is passed back to the default model
 * as the tool result.
 */
export class MiMoVisionClient {
  constructor(private config: MiMoVisionConfig) {}

  get ready(): boolean {
    return !!this.config.baseURL && !!this.config.apiKey
  }

  async describeImage(base64Png: string): Promise<string> {
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
              text: '这是一张F1 25游戏截图。请详细描述画面内容，包括：赛道名称和位置、当前排名和圈数、轮胎状态、天气条件、HUD显示的所有信息、车手在赛道上的位置、以及任何策略相关细节。'
            },
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${base64Png}` }
            }
          ]
        }
      ],
      max_tokens: 600,
      temperature: 0.3
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
        const errText = await res.text().catch(() => '')
        throw new Error(`MiMo vision HTTP ${res.status}: ${errText.slice(0, 200)}`)
      }

      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>
      }
      const description = json.choices?.[0]?.message?.content ?? ''
      if (!description) throw new Error('MiMo vision returned empty description')
      logger.info(`MiMo vision: described image (${description.length} chars)`)
      return description
    } catch (err) {
      logger.error('MiMo vision failed:', (err as Error)?.message ?? err)
      throw err
    }
  }
}
