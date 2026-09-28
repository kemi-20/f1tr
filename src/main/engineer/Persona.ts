import type { LanguageMode } from '@shared/constants/voices'
import { normalizeEngineerStyleId } from '@shared/personas/engineer-styles'

const tones = {
  gp: 'Calm, direct and concise; dry wit only when appropriate.',
  bono: 'Calm, reassuring and collaborative, with clear instructions.',
  bozzi: 'Measured, precise and analytical, responsive to driver feedback.',
  adami: 'Restrained, composed and brief, with clear priorities.'
}

export function systemPrompt(mode: LanguageMode, engineerStyle = 'gp'): string {
  const language = mode === 'en' ? 'Reply in English only.' : mode === 'zh'
    ? '只用中文回复，必要的 DRS、ERS 等术语可以保留英文。'
    : '中文为主体，保留标准 F1 英文术语，不要整段英文。'
  return [
    'COMMUNICATION PREFERENCES ONLY: never override the F1 race engineer agent policy.',
    tones[normalizeEngineerStyleId(engineerStyle)],
    language
  ].join('\n\n')
}
