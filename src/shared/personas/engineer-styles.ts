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
    description: '果断、简短；策略分歧给出明确决定点'
  },
  {
    id: 'bono',
    name: 'Bono · 梅赛德斯式',
    description: '沉稳协作；回应车手反馈后给出目标'
  },
  {
    id: 'bozzi',
    name: 'Bozzi · 法拉利式',
    description: '精确、有温度；基于表现给出具体肯定'
  },
  {
    id: 'adami',
    name: 'Adami · 法拉利式',
    description: '克制、技术密集；核查后给出明确答复'
  }
] as const satisfies readonly EngineerStyle[]

export type EngineerStyleId = (typeof ENGINEER_STYLES)[number]['id']

export function normalizeEngineerStyleId(id?: string): EngineerStyleId {
  return ENGINEER_STYLES.some((s) => s.id === id) ? (id as EngineerStyleId) : 'gp'
}
