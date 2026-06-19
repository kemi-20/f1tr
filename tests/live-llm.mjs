/**
 * Live LLM smoke test — sends a tiny streaming chat-completion to the configured
 * OpenAI-compatible endpoint (DeepSeek by default) using the SAME request shape as the app:
 *   - model from .env (AI_MODEL), thinking disabled (DeepSeek v4)
 *   - stream:true + stream_options.include_usage
 *   - reads token deltas and the final usage incl. cache hit/miss fields
 *
 * Run: node tests/live-llm.mjs
 * Requires AI_API_BASE_URL / AI_API_KEY / AI_MODEL set in .env (or env).
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

function loadEnv() {
  const p = resolve(process.cwd(), '.env')
  const out = {}
  if (!existsSync(p)) return out
  for (const line of readFileSync(p, 'utf-8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq < 0) continue
    let v = t.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    out[t.slice(0, eq).trim()] = v
  }
  return out
}

const env = { ...process.env, ...loadEnv() }
const BASE = env.AI_API_BASE_URL || ''
let url = BASE
if (!/^https?:\/\//.test(url)) url = 'https://' + url
url = url.replace(/\/+$/, '') + (/\/v\d+$/.test(url) ? '' : '/v1') + '/chat/completions'

const KEY = env.AI_API_KEY
const MODEL = env.AI_MODEL || 'deepseek-v4-flash'

console.log(`Endpoint: ${url}`)
console.log(`Model:    ${MODEL}`)
console.log(`Key:      ${KEY ? KEY.slice(0, 6) + '…(' + KEY.length + ' chars)' : '(missing!)'}`)
if (!KEY) {
  console.error('No AI_API_KEY — aborting.')
  process.exit(1)
}

const body = {
  model: MODEL,
  messages: [
    { role: 'system', content: 'You are an F1 race engineer. Reply in one short sentence.' },
    { role: 'user', content: 'My medium tyres are at 70% and it is lap 20 of 53. What do I do?' }
  ],
  temperature: 0.6,
  max_tokens: 80,
  stream: true,
  stream_options: { include_usage: true },
  thinking: { type: 'disabled' }
}

const res = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
  body: JSON.stringify(body)
})

if (!res.ok) {
  console.error(`HTTP ${res.status}`)
  console.error(await res.text())
  process.exit(1)
}

console.log('\n--- streaming response ---')
let text = ''
let usage = null
const reader = res.body.getReader()
const dec = new TextDecoder()
let buf = ''
let chunkCount = 0
while (true) {
  const { value, done } = await reader.read()
  if (done) break
  buf += dec.decode(value, { stream: true })
  let nl
  while ((nl = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, nl).trim()
    buf = buf.slice(nl + 1)
    if (!line.startsWith('data: ')) continue
    const payload = line.slice(6)
    if (payload === '[DONE]') continue
    chunkCount++
    const json = JSON.parse(payload)
    const delta = json.choices?.[0]?.delta?.content
    if (delta) {
      text += delta
      process.stdout.write(delta)
    }
    if (json.usage) usage = json.usage
  }
}
console.log('\n\n--- result ---')
console.log(`chunks: ${chunkCount}`)
console.log(`text:   "${text}"`)
console.log('usage:', JSON.stringify(usage, null, 2))
if (usage) {
  console.log('\n--- cache check ---')
  console.log(`prompt_cache_hit_tokens:  ${usage.prompt_cache_hit_tokens ?? '(absent)'}`)
  console.log(`prompt_cache_miss_tokens: ${usage.prompt_cache_miss_tokens ?? '(absent)'}`)
}

// ── Second call: same stable prefix (system) should hit cache. Proves session-prime value. ──
console.log('\n--- second call (expect cache hit on shared prefix) ---')
const res2 = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
  body: JSON.stringify({ ...body, messages: body.messages.slice(0, 2) })
})
if (res2.ok) {
  const reader2 = res2.body.getReader()
  const dec2 = new TextDecoder()
  let buf2 = ''
  let usage2 = null
  while (true) {
    const { value, done } = await reader2.read()
    if (done) break
    buf2 += dec2.decode(value, { stream: true })
    let nl
    while ((nl = buf2.indexOf('\n')) !== -1) {
      const line = buf2.slice(0, nl).trim()
      buf2 = buf2.slice(nl + 1)
      if (!line.startsWith('data: ')) continue
      const payload = line.slice(6)
      if (payload === '[DONE]') continue
      const json = JSON.parse(payload)
      if (json.usage) usage2 = json.usage
    }
  }
  console.log('usage2:', JSON.stringify(usage2, null, 2))
  if (usage2) {
    console.log(`cache_hit:  ${usage2.prompt_cache_hit_tokens ?? 0}`)
    console.log(`cache_miss: ${usage2.prompt_cache_miss_tokens ?? 0}`)
  }
}
