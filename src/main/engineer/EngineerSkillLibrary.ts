import gpSkill from '../../engineer_skills/gp.md?raw'
import bonoSkill from '../../engineer_skills/bono.md?raw'
import bozziSkill from '../../engineer_skills/bozzi.md?raw'
import { normalizeEngineerStyleId, type EngineerStyleId } from '@shared/personas/engineer-styles'

export interface EngineerSkill {
  id: EngineerStyleId
  markdown: string
  llmPrompt: string
  ttsDirection: string
}

const SKILLS: Record<EngineerStyleId, EngineerSkill> = {
  gp: buildSkill('gp', gpSkill),
  bono: buildSkill('bono', bonoSkill),
  bozzi: buildSkill('bozzi', bozziSkill)
}

export function getEngineerSkill(id?: string): EngineerSkill {
  return SKILLS[normalizeEngineerStyleId(id)]
}

function buildSkill(id: EngineerStyleId, markdown: string): EngineerSkill {
  const ttsDirection = extractNumberedSection(markdown, 0) || 'calm, concise F1 race engineer radio voice'
  return {
    id,
    markdown,
    llmPrompt: [
      'ENGINEER STYLE SKILL:',
      'Follow the following skill as the selected race-engineer communication style.',
      'Do not claim to be a real person or real team employee; imitate only the generalized radio communication style described here.',
      markdown.trim()
    ].join('\n\n'),
    ttsDirection
  }
}

function extractNumberedSection(markdown: string, sectionNumber: number): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const startPattern = new RegExp(`^#\\s*${sectionNumber}\\.`)
  const nextTopLevelPattern = /^#\s+\d+\./
  const start = lines.findIndex((line) => startPattern.test(line.trim()))
  if (start === -1) return ''

  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (nextTopLevelPattern.test(line)) {
      end = i
      break
    }
  }

  return lines
    .slice(start + 1, end)
    .filter((line) => !/^---+$/.test(line.trim()))
    .join('\n')
    .trim()
}
