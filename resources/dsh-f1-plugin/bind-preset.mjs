export const name = '@f1tr/bind-race-engineer'
export const inject = ['agentPresets']

export async function apply(ctx) {
  const dispose = await ctx.agentPresets.register({
    id: 'f1-race-engineer',
    name: 'F1 Race Engineer',
    description: 'Race-distance-aware strategy, performance and driver support',
    plugins: [{
      id: 'race-engineer-policy',
      name: new URL('./preset.mjs', import.meta.url).href
    }]
  })
  ctx.effect(() => dispose)
  // SDK-minimal creates agents without a preset setup callback. Bind before
  // the serial creation notification completes and the agent loop starts.
  ctx.on('agent/created', async ({ agent, source }) => {
    if (source === 'startup') await ctx.agentPresets.select(agent, 'f1-race-engineer')
    else await ctx.agentPresets.mount(agent.ctx, 'f1-race-engineer')
  })
}
