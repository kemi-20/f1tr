import { beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, mergeConfig } from '../src/shared/types/config'
import { registerIpc } from '../src/main/ipc/register'

const f = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  cfg: {} as any,
  enqueue: vi.fn(), cancel: vi.fn(), wireLlm: vi.fn(), wireVision: vi.fn(), wireTts: vi.fn(), transcribe: vi.fn()
}))
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, cb: any) => f.handlers.set(name, cb) } }))
vi.mock('../src/main/logging/Logger.ts', () => ({ logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../src/main/ipc/sender.ts', () => ({ Sender: { send: vi.fn() } }))
vi.mock('../src/main/config/ConfigStore.ts', () => ({ ConfigStore: {
  getAll: () => f.cfg, redacted: () => f.cfg,
  patch: (p: any) => { for (const k of Object.keys(p)) f.cfg[k] = { ...f.cfg[k], ...p[k] }; return f.cfg }
} }))
vi.mock('../src/main/ipc/engineerRef.ts', () => ({
  getEngineer: () => ({ enqueue: f.enqueue, cancel: f.cancel }), getLlm: () => null, wireLlm: f.wireLlm, wireVision: f.wireVision
}))
vi.mock('../src/main/ipc/telemetryRef.ts', () => ({ getTelemetry: () => ({ aggregator: { getState: () => ({}) } }) }))
vi.mock('../src/main/hotkey/GlobalHotkeyManager.ts', () => ({ registerHotkey: vi.fn() }))
vi.mock('../src/main/ipc/ttsRef.ts', () => ({
  getAudio: () => null, getTtsClient: () => null, wireTts: f.wireTts, getAsrClient: () => ({ transcribe: f.transcribe })
}))
beforeEach(() => { vi.clearAllMocks(); f.handlers.clear(); f.cfg = mergeConfig(DEFAULT_CONFIG); registerIpc() })

it('refreshes fallback vision credentials without discarding the LLM conversation', async () => {
  await f.handlers.get('config:set')!({}, { tts: { apiKeyOverride: 'review-sentinel-NOT-A-REAL-KEY' } })
  expect(f.wireTts).toHaveBeenCalledOnce()
  expect(f.wireLlm).not.toHaveBeenCalled()
  expect(f.wireVision).toHaveBeenCalledOnce()
})

it('discards late transcription after Stop even if upstream ignores cancellation', async () => {
  let resolveAsr: (text: string) => void = () => {}
  f.transcribe.mockImplementationOnce(() => new Promise(resolve => { resolveAsr = resolve }))
  const pending = f.handlers.get('engineer:voice')!({}, 'AAAA', 'wav')
  await f.handlers.get('engineer:cancel')!({})
  expect(f.cancel).toHaveBeenCalledOnce()
  resolveAsr('driver question')
  await pending
  expect(f.enqueue).not.toHaveBeenCalled()
  expect(f.transcribe.mock.calls[0][2].aborted).toBe(true)
})
