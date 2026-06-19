import { describe, expect, it } from 'vitest'
import { systemPrompt } from '../src/main/engineer/Persona'
import { getEngineerSkill } from '../src/main/engineer/EngineerSkillLibrary'

describe('engineer skills', () => {
  it('loads bundled GP/Bono/Bozzi skills for the LLM', () => {
    expect(systemPrompt('zh', 'gp')).toContain('红牛式顶级F1比赛工程师')
    expect(systemPrompt('zh', 'bono')).toContain('Bono-inspired')
    expect(systemPrompt('zh', 'bozzi')).toContain('Bryan Bozzi')
  })

  it('uses section #0 as the MiMo TTS direction', () => {
    expect(getEngineerSkill('gp').ttsDirection).toContain('红牛式顶级F1比赛工程师无线电')
    expect(getEngineerSkill('bono').ttsDirection).toContain('成熟英国男性工程师式无线电声线')
    expect(getEngineerSkill('bozzi').ttsDirection).toContain('泛化的现代F1比赛工程师英语无线电音色')
    expect(getEngineerSkill('bono').ttsDirection).not.toContain('# 1.')
  })

  it('falls back old or unknown style ids to GP', () => {
    expect(getEngineerSkill('default').id).toBe('gp')
    expect(getEngineerSkill('ferrari').id).toBe('gp')
  })
})
