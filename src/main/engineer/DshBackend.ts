import { app } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createServer, type Server, type Socket } from 'node:net'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID, randomBytes } from 'node:crypto'
import type { Digest } from '@shared/types/digest'
import type { TriggerFiring } from '@shared/types/triggers'
import type { EngineerBackend } from './EngineerService'
import type { LlmConfig } from './LlmClient'
import type { TelemetryHistory } from './TelemetryHistory'
import { executeTelemetryTool } from './TelemetryHarness'
import { captureF1Screenshot } from '../screenshot/ScreenshotService'
import type { MiMoVisionClient } from './MiMoVisionClient'
import { logger } from '../logging/Logger'

type JsonRecord = Record<string, unknown>
type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void }

/** The private CLI reuses Electron's Node runtime, with an isolated DSH home. */
export class DshBackend implements EngineerBackend {
  private child: ChildProcessWithoutNullStreams | null = null
  private server: Server | null = null
  private home = ''
  private pipe = ''
  private token = ''
  private nextId = 1
  private requests = new Map<number, Pending>()
  private sessionId = randomUUID()
  private current: { firing: TriggerFiring; onDelta: (text: string) => void; resolve: (text: string) => void; reject: (e: Error) => void; text: string; calls: number; screenshots: number; speeches: number; corrected: boolean; timer: NodeJS.Timeout } | null = null
  private starting: Promise<void> | null = null
  private radioTimes: number[] = []
  private closing = false
  private stderrLines = 0

  constructor(
    private readonly config: LlmConfig,
    private readonly history: TelemetryHistory,
    private readonly vision: MiMoVisionClient | null,
    private readonly speak: (text: string, firing: TriggerFiring) => void,
    private readonly persona: string
  ) {}

  async ping(): Promise<boolean> {
    try { await this.start(); return true } catch (error) {
      logger.warn('Private DSH startup failed:', (error as Error).message)
      return false
    }
  }

  cancel(): void {
    const pending = this.current
    this.current = null
    if (pending) {
      clearTimeout(pending.timer)
      pending.reject(Object.assign(new Error('Engineer turn cancelled'), { name: 'AbortError' }))
    }
    this.stop()
  }

  async dispose(): Promise<void> { this.cancel() }

  async generate(_digest: Digest, digestText: string, firing: TriggerFiring, manualPrompt: string | undefined, onDelta: (delta: string) => void, audioBase64?: string): Promise<string> {
    if (audioBase64) throw new Error('Voice input must be transcribed before DSH')
    if (this.current) throw new Error('Engineer turn already running')
    await this.start()
    const manual = firing.reasonCode === 'manual'
    const driverText = manualPrompt ?? firing.reason
    const prompt = `${manual ? 'SOURCE: driver_manual. The driver asked directly; call speak_radio with your answer.' : 'SOURCE: automatic_event. Speak only when an actionable radio message is warranted.'}\n${manual ? `DRIVER: ${driverText.slice(0, 1024)}\n` : ''}${digestText}`
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => this.cancel(), manual ? 90_000 : 45_000)
      this.current = { firing, onDelta, resolve, reject, text: '', calls: 0, screenshots: 0, speeches: 0, corrected: false, timer }
      void this.request('session/prompt', { sessionId: this.sessionId, contentBlocks: [{ type: 'text', text: prompt }] })
        .catch((error: Error) => { if (this.current) this.finish(error) })
    })
  }

  private runtimeDir(): string { return app.isPackaged ? join(process.resourcesPath, 'dsh-runtime') : join(app.getAppPath(), 'resources', 'dsh-runtime') }

  private async start(): Promise<void> {
    if (this.starting) return this.starting
    if (this.child && !this.child.killed) return
    this.starting = this.startInner().finally(() => { this.starting = null })
    return this.starting
  }

  private async startInner(): Promise<void> {
    const root = this.runtimeDir()
    const startedAt = performance.now()
    const node = process.execPath
    const bin = join(root, 'launch.mjs')
    const patch = join(root, 'race-engineer.cordis.patch.yml')
    const plugin = join(root, 'plugin', 'index.mjs')
    if (!existsSync(bin) || !existsSync(patch) || !existsSync(plugin)) {
      throw new Error('Private DSH runtime resources are missing')
    }
    this.home = mkdtempSync(join(tmpdir(), 'f1tr-dsh-'))
    this.pipe = `\\\\.\\pipe\\f1tr-${randomUUID()}`
    this.token = randomBytes(32).toString('hex')
    this.server = createServer(socket => this.acceptToolConnection(socket))
    try {
      await new Promise<void>((resolve, reject) => {
        this.server!.once('error', reject)
        this.server!.listen(this.pipe, () => resolve())
      })
      this.server.removeAllListeners('error')
      this.server.on('error', error => {
        logger.warn('Private DSH bridge failed:', error.message)
        this.cancel()
      })
      const env: NodeJS.ProcessEnv = {
        ELECTRON_RUN_AS_NODE: '1',
        SystemRoot: process.env.SystemRoot,
        WINDIR: process.env.WINDIR,
        PATH: app.isPackaged ? root : process.env.PATH,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        DSH_HOME: this.home,
        F1TR_BRIDGE_PIPE: this.pipe,
        F1TR_BRIDGE_TOKEN: this.token,
        F1TR_PERSONA: this.persona,
        F1TR_MODEL_KEY: this.config.apiKey,
        F1TR_MODEL_URL: this.config.baseURL,
        F1TR_MODEL_NAME: this.config.model
      }
      this.stderrLines = 0
      const child = spawn(node, [bin, '--profile', 'sdk-minimal', '--patch', patch], {
        cwd: this.home, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
      })
      this.child = child
      const ownedHome = this.home
      child.stdout.setEncoding('utf8')
      let lines = ''
      child.stdout.on('data', (chunk: string) => {
        lines += chunk
        if (lines.length > 2_000_000) { this.stop(); return }
        let at: number
        while ((at = lines.indexOf('\n')) >= 0) {
          const line = lines.slice(0, at); lines = lines.slice(at + 1)
          this.onLine(line)
        }
      })
      child.stderr.setEncoding('utf8')
      let stderr = ''
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk
        if (stderr.length > 16_384) stderr = stderr.slice(-16_384)
        let at: number
        while ((at = stderr.indexOf('\n')) >= 0) {
          const line = stderr.slice(0, at)
          stderr = stderr.slice(at + 1)
          this.logChildStderr(line)
        }
      })
      child.stderr.on('end', () => {
        if (stderr.trim()) this.logChildStderr(stderr)
      })
      child.once('error', error => {
        if (this.child !== child) return
        for (const pending of this.requests.values()) pending.reject(error)
        this.requests.clear()
        if (this.current) this.finish(error)
      })
      child.once('close', code => {
        if (this.child === child) {
          this.child = null
          if (this.current) this.finish(new Error(`Private DSH exited (${code})`))
          for (const pending of this.requests.values()) pending.reject(new Error('Private DSH exited'))
          this.requests.clear()
        }
        this.releaseHome(ownedHome)
      })
      await this.request('initialize', { cwd: this.home, provider: 'race-gateway', model: this.config.model, maxTokens: this.config.maxTokens }, 20_000)
      logger.info(`Private DSH runtime ready in ${Math.round(performance.now() - startedAt)} ms`)
    } catch (error) {
      this.stop()
      throw error
    }
  }

  private request(method: string, params: JsonRecord, timeoutMs = 10_000): Promise<unknown> {
    const child = this.child
    if (!child?.stdin.writable) return Promise.reject(new Error('Private DSH is unavailable'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.requests.delete(id); reject(new Error(`DSH ${method} timed out`)) }, timeoutMs)
      this.requests.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value) },
        reject: error => { clearTimeout(timer); reject(error) }
      })
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n', error => {
        if (!error) return
        const pending = this.requests.get(id)
        if (pending) {
          this.requests.delete(id)
          pending.reject(error)
        }
      })
    })
  }

  private onLine(line: string): void {
    let frame: JsonRecord
    try { frame = JSON.parse(line) as JsonRecord } catch { return }
    if (typeof frame.id === 'number') {
      const pending = this.requests.get(frame.id)
      if (!pending) return
      this.requests.delete(frame.id)
      if (frame.error) pending.reject(new Error(`DSH ${String((frame.error as JsonRecord).code ?? 'request')} failed`))
      else pending.resolve(frame.result)
      return
    }
    const active = this.current
    if (!active || !frame.params || typeof frame.params !== 'object') return
    const p = frame.params as JsonRecord
    if (p.sessionId !== this.sessionId) return
    if (frame.method === 'session.status' && p.status === 'idle') {
      if (active.firing.reasonCode === 'manual' && active.speeches === 0 && !active.corrected) {
        active.corrected = true
        void this.request('session/prompt', { sessionId: this.sessionId, contentBlocks: [{ type: 'text', text: 'Driver is waiting. Call speak_radio now with your direct answer.' }] })
          .catch((error: Error) => { if (this.current) this.finish(error) })
        return
      }
      this.finish(); return
    }
    if (frame.method !== 'session.event' || !p.event || typeof p.event !== 'object') return
    const event = p.event as JsonRecord
    if (event.type === 'assistant/message' && event.data && typeof event.data === 'object') {
      const message = (event.data as JsonRecord).message as JsonRecord | undefined
      const blocks = message?.content
      if (Array.isArray(blocks)) {
        const text = blocks.filter(b => b?.type === 'text' && typeof b.text === 'string').map(b => b.text as string).join('')
        if (text) { active.text += text; active.onDelta(text) }
      }
    }
  }

  private finish(error?: Error): void {
    const active = this.current
    this.current = null
    if (!active) return
    clearTimeout(active.timer)
    if (error) active.reject(error)
    else active.resolve(active.text)
  }

  private logChildStderr(line: string): void {
    const text = line.trim()
    if (!text || this.stderrLines++ >= 20) return
    const redact = (value: string): string => value ? text.split(value).join('[redacted]') : text
    const safe = [this.config.apiKey, this.token].reduce(redact, text).slice(0, 2_000)
    logger.warn(`Private DSH stderr: ${safe}`)
  }

  private acceptToolConnection(socket: Socket): void {
    socket.setEncoding('utf8')
    socket.setTimeout(15_000, () => socket.destroy())
    let input = ''
    socket.on('data', (chunk: string) => {
      input += chunk
      if (input.length > 8192) { socket.destroy(); return }
      const at = input.indexOf('\n')
      if (at < 0) return
      const line = input.slice(0, at)
      input = ''
      void this.handleTool(socket, line)
    })
  }

  private async handleTool(socket: Socket, line: string): Promise<void> {
    let id: unknown = null
    try {
      const req = JSON.parse(line) as JsonRecord
      id = req.id
      if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id) || req.token !== this.token ||
          typeof req.name !== 'string' || !this.current || socket.destroyed) throw new Error('Tool unavailable')
      const active = this.current
      if (++active.calls > 16) throw new Error('Tool budget exceeded')
      const args = req.args && typeof req.args === 'object' && !Array.isArray(req.args) ? req.args as JsonRecord : {}
      let result: string
      if (['get_race_state', 'get_telemetry_history', 'get_lap_history', 'get_race_events', 'get_stint_history', 'read_telemetry_packet'].includes(req.name)) {
        result = executeTelemetryTool(this.history, req.name, JSON.stringify(args))
      } else if (req.name === 'capture_screenshot') {
        if (++active.screenshots > 1) throw new Error('Screenshot limit exceeded')
        const png = await captureF1Screenshot()
        if (socket.destroyed || this.current !== active) throw new Error('Engineer turn cancelled')
        const controller = new AbortController()
        socket.once('close', () => controller.abort())
        result = png && this.vision ? await this.vision.describeImage(png, controller.signal) : 'Screenshot unavailable or visual description is not configured'
      } else if (req.name === 'speak_radio') {
        if (++active.speeches > 2) throw new Error('Radio limit exceeded')
        const now = Date.now()
        this.radioTimes = this.radioTimes.filter(time => now - time < 10_000)
        if (this.radioTimes.length >= 2) throw new Error('Radio rate limit exceeded')
        const text = args.text
        if (typeof text !== 'string' || !text.trim() || text.length > 600) throw new Error('Invalid radio text')
        if (socket.destroyed || this.current !== active) throw new Error('Engineer turn cancelled')
        this.radioTimes.push(now)
        this.speak(text.trim(), active.firing)
        result = 'Radio message accepted'
      } else throw new Error('Unknown tool')
      if (socket.destroyed || this.current !== active) throw new Error('Engineer turn cancelled')
      if (Buffer.byteLength(result, 'utf8') > 54_000) result = 'Result exceeds context budget; use a narrower section or page.'
      socket.end(JSON.stringify({ id, ok: true, result }) + '\n')
    } catch (error) {
      if (!socket.destroyed) socket.end(JSON.stringify({ id, ok: false, result: '', error: (error as Error).message.slice(0, 200) }) + '\n')
    }
  }

  private stop(): void {
    if (this.closing) return
    this.closing = true
    const child = this.child
    const home = this.home
    child?.kill()
    this.child = null
    if (this.server?.listening) this.server.close()
    this.server = null
    for (const pending of this.requests.values()) pending.reject(new Error('Private DSH stopped'))
    this.requests.clear()
    if (!child) this.releaseHome(home)
    this.sessionId = randomUUID()
    this.closing = false
  }

  private releaseHome(path: string): void {
    if (!path) return
    try { rmSync(path, { recursive: true, force: true }) } catch (error) {
      logger.warn('Could not clean private DSH session directory:', (error as Error).message)
    }
    if (this.home === path) this.home = ''
  }
}
