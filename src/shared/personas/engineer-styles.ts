/** Engineer skill choices shown in the renderer.
 *  Full skill markdown is bundled in the main process and injected into the LLM there. */
export interface EngineerStyle {
  id: string
  name: string
  description: string
}

export const ENGINEER_STYLES = [
  {
    id: 'gp',
    name: 'GP · 红牛式',
    description: '冷静、极简、直接，压力越大越短'
  },
  {
    id: 'bono',
    name: 'Bono · 梅赛德斯式',
    description: '稳、暖、可靠，先接住车手再给指令'
  },
  {
    id: 'bozzi',
    name: 'Bozzi · 法拉利式',
    description: '清晰专业，带法拉利式温度和及时肯定'
  },
  {
    id: 'adami',
    name: 'Adami · 法拉利冷电台',
    description: '极简、冷静、低反馈，高工程密度'
  }
] as const satisfies readonly EngineerStyle[]

export type EngineerStyleId = (typeof ENGINEER_STYLES)[number]['id']

export function normalizeEngineerStyleId(id?: string): EngineerStyleId {
  return ENGINEER_STYLES.some((s) => s.id === id) ? (id as EngineerStyleId) : 'gp'
}

export function getEngineerStyle(id?: string): EngineerStyle {
  const normalized = normalizeEngineerStyleId(id)
  return ENGINEER_STYLES.find((s) => s.id === normalized) ?? ENGINEER_STYLES[0]
}
