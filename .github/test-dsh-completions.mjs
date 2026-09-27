import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer as httpServer } from 'node:http'
import { createServer as pipeServer } from 'node:net'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// Offline integration: the real pinned agent, adapter and F1 tool plugin run on
// Electron's Node, against a loopback-only fake Chat Completions endpoint.
const runtime = resolve('resources/dsh-runtime')
const home = await mkdtemp(join(tmpdir(), 'f1tr-completions-test-'))
const token = randomBytes(32).toString('hex')
const pipe = `\\\\.\\pipe\\f1tr-test-${randomUUID()}`
const expectedTools = ['capture_screenshot', 'get_lap_history', 'get_race_events', 'get_race_state',
  'get_stint_history', 'get_telemetry_history', 'read_telemetry_packet', 'speak_radio'].sort()
let requests = 0
const calls = []
let failure
const bridge = pipeServer(socket => {
  let input = ''
  socket.on('error', () => {})
  socket.on('data', chunk => {
    input += chunk
    if (!input.includes('\n')) return
    try {
      const call = JSON.parse(input)
      assert.equal(call.token, token)
      calls.push(call.name)
      socket.end(JSON.stringify({ id: call.id, ok: true, result: call.name === 'get_race_state' ? '{"fuelLaps":2.5}' : 'Radio message accepted' }) + '\n')
    } catch (error) { failure = error; socket.destroy() }
  })
})
await new Promise(resolve => bridge.listen(pipe, resolve))
const api = httpServer(async (req, res) => {
  try {
    assert.equal(req.url, '/v1/chat/completions')
    assert.equal(req.headers.authorization, 'Bearer YOUR_API_KEY_HERE')
    let body = ''
    for await (const chunk of req) body += chunk
    const request = JSON.parse(body)
    assert.equal(request.stream, true)
    assert.equal(request.model, 'f1tr-ci-smoke')
    assert.deepEqual(request.tools.map(tool => tool.function.name).sort(), expectedTools)
    requests++
    assert.ok(requests <= 3, 'Unexpected retry or agent loop')
    if (requests > 1) assert.ok(request.messages.some(message => message.role === 'tool'), 'Tool result missing from replay')
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: 'chatcmpl-test', object: 'chat.completion.chunk', created: 1, model: request.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`)
    if (requests < 3) {
      const name = requests === 1 ? 'get_race_state' : 'speak_radio'
      const args = requests === 1 ? '{"section":"player"}' : '{"text":"Fuel margin is positive. Maintain the current pace."}'
      send({ role: 'assistant', tool_calls: [{ index: 0, id: `call_${requests}`, type: 'function', function: { name, arguments: '' } }] })
      // Deliberately split tool JSON across SSE frames to exercise assembly.
      send({ tool_calls: [{ index: 0, function: { arguments: args.slice(0, 9) } }] })
      send({ tool_calls: [{ index: 0, function: { arguments: args.slice(9) } }] })
      send({}, 'tool_calls')
    } else {
      send({ role: 'assistant', content: 'Radio complete.' })
      send({}, 'stop')
    }
    res.end('data: [DONE]\n\n')
  } catch (error) { failure = error; res.writeHead(500); res.end('Test assertion failed') }
})
await new Promise(resolve => api.listen(0, '127.0.0.1', resolve))
const child = spawn(process.env.F1TR_DSH_EXEC_PATH || process.execPath, [
  join(runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), '--profile', 'sdk-minimal',
  '--patch', join(runtime, 'race-engineer.cordis.patch.yml')
], { cwd: home, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: {
  SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, TEMP: process.env.TEMP, TMP: process.env.TMP,
  ELECTRON_RUN_AS_NODE: '1', DSH_HOME: home, F1TR_BRIDGE_PIPE: pipe, F1TR_BRIDGE_TOKEN: token,
  F1TR_MODEL_KEY: 'YOUR_API_KEY_HERE', F1TR_MODEL_URL: `http://127.0.0.1:${api.address().port}/v1`,
  F1TR_MODEL_NAME: 'f1tr-ci-smoke', F1TR_PERSONA: 'You are an F1 race engineer. Use only F1 tools.'
} })
const closed = new Promise(resolve => child.once('close', resolve))
let diagnostics = ''
child.stderr.on('data', data => { diagnostics = (diagnostics + data).slice(-4000) })
const startedAt = performance.now()
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(failure ?? new Error(`F1 tool round-trip timed out: ${diagnostics}`)), 40_000)
    const fail = error => { clearTimeout(timer); reject(error) }
    child.once('error', fail)
    child.stdin.on('error', fail)
    child.once('exit', code => fail(new Error(`DSH exited (${code}): ${diagnostics}`)))
    let buffer = ''
    child.stdout.on('data', chunk => {
      buffer += chunk
      if (buffer.length > 1_000_000) { fail(new Error('Output limit')); return }
      let at
      while ((at = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, at); buffer = buffer.slice(at + 1)
        let frame
        try { frame = JSON.parse(line) } catch { continue }
        if (frame.error) { fail(new Error('RPC error')); return }
        if (frame.id === 1) child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'session/prompt', params: {
          sessionId: 'f1tr-integration', contentBlocks: [{ type: 'text', text: 'Check fuel then speak.' }]
        } }) + '\n')
        if (frame.method === 'session.status' && frame.params.status === 'idle' && requests > 0) {
          clearTimeout(timer)
          resolve()
        }
      }
    })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      cwd: home, provider: 'race-gateway', model: 'f1tr-ci-smoke', maxTokens: 256
    } }) + '\n')
  })
  if (failure) throw failure
  assert.equal(requests, 3)
  assert.deepEqual(calls, ['get_race_state', 'speak_radio'])
  console.log(`Completions streaming + tool assembly + replay + radio passed in ${Math.round(performance.now() - startedAt)} ms`)
} finally {
  child.kill()
  await closed
  api.closeAllConnections()
  await new Promise(resolve => api.close(resolve))
  await new Promise(resolve => bridge.close(resolve))
  await rm(home, { recursive: true, force: true })
}
