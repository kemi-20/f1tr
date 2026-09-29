import { describe, expect, it } from 'vitest'
import { systemPrompt } from './Persona'
import { getEngineerSkill } from './EngineerSkillLibrary'

describe('engineer communication styles', () => {
  it.each(['gp', 'bono', 'bozzi', 'adami'])('sends the selected %s style to DSH without replacing race policy', (style) => {
    const prompt = systemPrompt('zh', style)
    expect(prompt).toContain(getEngineerSkill(style).llmPrompt)
    expect(prompt).toContain('never override the F1 race engineer agent policy')
    expect(prompt).toContain('只用中文回复')
    expect(getEngineerSkill(style).ttsDirection.length).toBeLessThan(250)
  })
})
