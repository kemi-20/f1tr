import { readFileSync } from 'node:fs'

export const name = '@f1tr/race-engineer-policy'
export const inject = ['systemPrompt']

export function apply(ctx) {
  const policy = readFileSync(new URL('./race-engineer.md', import.meta.url), 'utf8')
  if (!policy.trim()) throw new Error('F1 race engineer policy is empty')
  ctx.systemPrompt.section({
    name: 'deployment:persona-prefix',
    order: 0,
    interpolate: false,
    text: 'You are an original F1 race engineer supporting a driver, not a real team employee.\n\n' + policy
  })
}
