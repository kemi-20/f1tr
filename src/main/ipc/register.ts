import { ipcMain } from 'electron'
import { ConfigStore } from '../config/ConfigStore'
import { logger } from '../logging/Logger'
import { getTelemetry } from './telemetryRef'
import { getEngineer, getLlm, wireLlm } from './engineerRef'
import { getAudio, getTtsClient, wireTts } from './ttsRef'
import { manualFiring } from '../engineer/EngineerService'

/**
 * Registers all renderer->main IPC handlers.
 * IMPORTANT: use STATIC imports for all refs (getLlm/getTtsClient/wireLlm/wireTts) — dynamic
 * require() does not work reliably under electron-vite's ESM bundle and would throw at runtime.
 */
export function registerIpc(): void {
  ipcMain.handle('config:get', () => ConfigStore.getAll())

  ipcMain.handle('config:set', async (_e, patch) => {
    const cfg = ConfigStore.patch(patch)
    const rewires: Promise<void>[] = []
    if (patch.llm || patch.language || patch.advanced) rewires.push(wireLlm(cfg))
    if (patch.tts || patch.audio || patch.language || patch.advanced) rewires.push(wireTts(cfg))
    const results = await Promise.allSettled(rewires)
    for (const result of results) {
      if (result.status === 'rejected') logger.error('config:set service rewire failed:', result.reason)
    }
    if (patch.triggers) {
      getTelemetry()?.triggers.setConfig(cfg.triggers)
    }
    if (patch.telemetry?.rendererPaintHz != null) {
      getTelemetry()?.setRendererPaintHz(cfg.telemetry.rendererPaintHz)
    }
    if (patch.advanced?.memoryTurns != null) {
      getEngineer()?.setMemoryTurns(cfg.advanced.memoryTurns)
    }
    if (patch.language) {
      const eng = getEngineer()
      eng?.setLanguage(cfg.language.mode)
      eng?.setVoice(cfg.language.voice, cfg.language.direction)
      eng?.setEngineerStyle(cfg.language.engineerStyle)
    }
    return cfg
  })

  ipcMain.handle('config:test:llm', async () => {
    const client = getLlm()
    if (!client) return { ok: false, message: 'No AI_API_BASE_URL/AI_API_KEY in .env (stub advice active).' }
    try {
      const ok = await client.ping()
      return { ok, message: ok ? 'LLM reachable.' : 'LLM responded but no content.' }
    } catch (err) {
      return { ok: false, message: `LLM error: ${(err as Error)?.message ?? err}` }
    }
  })

  ipcMain.handle('config:test:tts', async () => {
    const client = getTtsClient()
    if (!client) return { ok: false, message: 'No MIMO_API_BASE_URL/MIMO_API_KEY in .env.' }
    try {
      let got = false
      const TIMEOUT_MS = 15_000
      const synthesis = client.synthesize('test', 'Mia', 'test', () => {
        got = true
      })
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`TTS test timed out after ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS)
      )
      await Promise.race([synthesis, timeout])
      return { ok: got, message: got ? 'TTS reachable, audio received.' : 'TTS responded but no audio chunk.' }
    } catch (err) {
      return { ok: false, message: `TTS error: ${(err as Error)?.message ?? err}` }
    }
  })

  ipcMain.handle('config:test:udp', async () => {
    const svc = getTelemetry()
    if (!svc) return { ok: false, message: 'UDP receiver not started.' }
    const received = svc.packetsReceived()
    return {
      ok: received > 0,
      message: received > 0 ? `Receiving packets (${received}).` : 'No packets yet — is F1 25 sending to 127.0.0.1:20777?'
    }
  })

  ipcMain.handle('engineer:request', async (_e, text?: string) => {
    const svc = getTelemetry()
    const eng = getEngineer()
    if (!svc || !eng) {
      logger.warn('engineer:request but services not ready')
      return
    }
    const state = svc.aggregator.getState()
    eng.enqueue(state, manualFiring(text))
  })

  ipcMain.handle('engineer:cancel', async () => {
    getEngineer()?.cancel()
    getAudio()?.cancelAll()
    getTtsClient()?.cancel()
    logger.info('engineer:cancel requested')
  })

  ipcMain.handle('audio:mute', async (_e, muted: boolean) => {
    // persist so it survives restart; renderer already drives the live gain
    await ConfigStore.patch({ audio: { muted } })
    logger.debug(`audio mute -> ${muted}`)
  })
  ipcMain.handle('audio:volume', async (_e, vol: number) => {
    await ConfigStore.patch({ audio: { volume: vol } })
  })
  ipcMain.handle('audio:pause', async (_e, pause: boolean) => {
    await ConfigStore.patch({ audio: { pause } })
  })
}
