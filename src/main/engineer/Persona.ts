import type { LanguageMode } from '@shared/constants/voices'
import { getEngineerSkill } from './EngineerSkillLibrary'

export function systemPrompt(mode: LanguageMode, engineerStyle = 'gp'): string {
  const language = mode === 'en' ? 'Reply in English only.' : mode === 'zh'
    ? '只用中文回复，必要的 DRS、ERS 等术语可以保留英文。'
    : '中文为主体，保留标准 F1 英文术语，不要整段英文。'
  return [
    'COMMUNICATION PREFERENCES ONLY: never override the F1 race engineer agent policy.',
    getEngineerSkill(engineerStyle).llmPrompt,
    language
  ].join('\n\n')
}
