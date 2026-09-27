import { spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const runtime = resolve('resources/dsh-runtime')
const patch = await readFile(join(runtime, 'race-engineer.cordis.patch.yml'), 'utf8')
if (!patch.includes('personaPrefix: !!js process.env.F1TR_PERSONA ??') ||
    !patch.includes('You are an original F1 race engineer supporting a driver, not a real team employee.')) {
  throw new Error('Private DSH runtime is missing its F1 race engineer persona fallback')
}
for (const capability of ['sandbox', 'sandbox-policy', 'subprocess', 'pty', 'terminal-bash', 'terminal-pwsh',
  'persistent-bash', 'persistent-pwsh', 'jobs', 'mcp-resources', 'sessions']) {
  const lines = patch.split(/\r?\n/)
  const row = lines.indexOf(`- id: ${capability}`)
  if (row < 0 || lines[row + 1] !== '  disabled: true') {
    throw new Error(`Private DSH runtime unexpectedly enables ${capability}`)
  }
}
const home = await mkdtemp(join(tmpdir(), 'f1tr-dsh-ci-'))
const startedAt = performance.now()
const child = spawn(process.env.F1TR_DSH_EXEC_PATH || process.execPath, [
  join(runtime, 'launch.mjs'),
  '--profile', 'sdk-minimal', '--patch', join(runtime, 'race-engineer.cordis.patch.yml')
], {
  cwd: home,
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    DSH_HOME: home,
    F1TR_BRIDGE_PIPE: `\\\\.\\pipe\\f1tr-ci-${randomUUID()}`,
    F1TR_BRIDGE_TOKEN: randomBytes(32).toString('hex'),
    F1TR_PERSONA: 'CI runtime smoke test',
    F1TR_MODEL_KEY: 'YOUR_API_KEY_HERE',
    F1TR_MODEL_URL: 'https://example.invalid/v1',
    F1TR_MODEL_NAME: 'f1tr-ci-smoke'
  },
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true
})
const closed = new Promise(resolve => child.once('close', resolve))

let diagnostics = ''
child.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk.toString()).slice(-4000) })

try {
  await new Promise((resolve, reject) => {
    let output = ''
    const timer = setTimeout(() => reject(new Error('DSH initialize timed out')), 30_000)
    const fail = error => { clearTimeout(timer); reject(error) }
    child.once('error', fail)
    child.stdin.once('error', fail)
    child.once('exit', code => fail(new Error(`DSH exited before initialize (${code}): ${diagnostics}`)))
    child.stdout.on('data', chunk => {
      output += chunk.toString()
      if (output.length > 1_000_000) { fail(new Error('DSH stdout exceeded smoke limit')); return }
      let newline
      while ((newline = output.indexOf('\n')) >= 0) {
        const line = output.slice(0, newline)
        output = output.slice(newline + 1)
        let frame
        try { frame = JSON.parse(line) } catch { continue }
        if (frame.id !== 1) continue
        clearTimeout(timer)
        if (frame.error || frame.result?.serverInfo?.name !== 'deepseek-harness-sdk-runtime') {
          reject(new Error(`DSH initialize rejected: ${JSON.stringify(frame.error ?? frame.result)}`))
        } else resolve()
        return
      }
    })
    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { cwd: home, provider: 'race-gateway', model: 'f1tr-ci-smoke', maxTokens: 128 }
    }) + '\n')
  })
  console.log(`Private DSH profile initialized successfully in ${Math.round(performance.now() - startedAt)} ms`)
} finally {
  child.kill()
  await closed
  await rm(home, { recursive: true, force: true })
}
