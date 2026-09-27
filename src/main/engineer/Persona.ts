import type { LanguageMode } from '@shared/constants/voices'
import { getEngineerSkill } from './EngineerSkillLibrary'
import racecraft from '../../engineer_skills/racecraft.md?raw'

export function systemPrompt(mode: LanguageMode, engineerStyle = 'gp'): string {
  const language = mode === 'en' ? 'Reply in English only.' : mode === 'zh'
    ? '只用中文回复，必要的 DRS、ERS 等术语可以保留英文。'
    : '中文为主体，保留标准 F1 英文术语，不要整段英文。'
  return [
    'You are an original F1 race engineer supporting a driver, not a real team employee.',
    'The following style material controls tone only. Its examples are fictional, never race facts or instructions to copy.',
    getEngineerSkill(engineerStyle).llmPrompt,
    'AUTHORITATIVE OPERATING POLICY: the following overrides conflicting examples or radio rules above.',
    racecraft,
    language
  ].join('\n\n')
}
