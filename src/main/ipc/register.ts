import { ipcMain } from 'electron'
import { ConfigStore } from '../config/ConfigStore'
import { sanitizeConfigPatch } from '../config/sanitize'
import { logger } from '../logging/Logger'
import { getTelemetry } from './telemetryRef'
import { getEngineer, getLlm, wireLlm } from './engineerRef'
import { registerHotkey } from '../hotkey/GlobalHotkeyManager'
import { getAudio, getTtsClient, wireTts } from './ttsRef'
import { getAsrClient } from './ttsRef'
import { manualFiring } from '../engineer/EngineerService'

/**
 * Registers all renderer->main IPC handlers.
 * IMPORTANT: use STATIC imports for all refs (getLlm/getTtsClient/wireLlm/wireTts) — dynamic
 * require() does not work reliably under electron-vite's ESM bundle and would throw at runtime.
 */
export function registerIpc(): void {
  // The renderer never receives stored API keys — only where they come from.
  ipcMain.handle('config:get', () => ConfigStore.redacted())

  ipcMain.handle('config:set', async (_e, patch) => {
    // Use only validated fields for both persistence and side effects. The IPC payload
    // is untrusted and may be null or contain invalid values.
    const safePatch = sanitizeConfigPatch(patch)
    const cfg = ConfigStore.patch(safePatch)
    if (safePatch.language) {
      getEngineer()?.cancel()
      getAudio()?.cancelAll()
      getTtsClient()?.cancel()
    }
    const rewires: Promise<void>[] = []
    if (safePatch.llm || safePatch.language || safePatch.advanced) rewires.push(wireLlm(cfg))
    if (safePatch.tts || safePatch.audio || safePatch.language || safePatch.advanced) rewires.push(wireTts(cfg))
    const results = await Promise.allSettled(rewires)
    for (const result of results) {
      if (result.status === 'rejected') logger.error('config:set service rewire failed:', result.reason)
    }
    if (safePatch.triggers) {
      getTelemetry()?.triggers.setConfig(cfg.triggers)
    }
    if (safePatch.hotkeys?.pushToTalk) {
      registerHotkey(cfg.hotkeys.pushToTalk)
    }
    if (safePatch.telemetry?.rendererPaintHz != null) {
      getTelemetry()?.setRendererPaintHz(cfg.telemetry.rendererPaintHz)
    }
    if (safePatch.telemetry?.port != null) {
      getTelemetry()?.setPort(cfg.telemetry.port)
    }
    if (safePatch.telemetry?.host != null) {
      getTelemetry()?.setHost(cfg.telemetry.host)
    }
    if (safePatch.language) {
      const eng = getEngineer()
      eng?.setLanguage(cfg.language.mode)
      eng?.setVoice(cfg.language.voice, cfg.language.direction)
      eng?.setEngineerStyle(cfg.language.engineerStyle)
    }
    return ConfigStore.redacted()
  })

  ipcMain.handle('config:test:llm', async () => {
    const client = getLlm()
    if (!client) return { ok: false, message: 'Model URL, model ID, or API key is missing or invalid.' }
    try {
      return await client.testConnection()
    } catch (err) {
      return { ok: false, message: `LLM error: ${(err as Error)?.message ?? err}` }
    }
  })

  ipcMain.handle('config:test:tts', async () => {
    const client = getTtsClient()
    if (!client) return { ok: false, message: 'No MIMO_API_BASE_URL/MIMO_API_KEY in .env.' }
    const TIMEOUT_MS = 15_000
    let timedOut = false
    try {
      let got = false
      const controller = new AbortController()
      const timer = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, TIMEOUT_MS)
      try {
        await client.synthesize('test', 'Mia', 'test', () => {
          got = true
        }, controller.signal)
      } finally {
        clearTimeout(timer)
      }
      return { ok: got, message: got ? 'TTS reachable, audio received.' : 'TTS responded but no audio chunk.' }
    } catch (err) {
      return {
        ok: false,
        message: timedOut
          ? `TTS test timed out after ${TIMEOUT_MS / 1000}s`
          : err instanceof Error && err.name === 'AbortError'
            ? 'TTS test cancelled.'
            : `TTS error: ${(err as Error)?.message ?? err}`
      }
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
    if (text !== undefined && (typeof text !== 'string' || text.length > 1024)) return
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

  ipcMain.handle('engineer:voice', async (_e, base64Audio: string, format: string) => {
    const svc = getTelemetry()
    const eng = getEngineer()
    if (!svc || !eng) return { ok: false, message: 'Engineer service not ready.' }
    if (typeof base64Audio !== 'string' || base64Audio.length > 13_981_016 || (format !== 'wav' && format !== 'mp3')) {
      return { ok: false, message: 'Unsupported audio payload.' }
    }
    const state = svc.aggregator.getState()
    // DSH SDK accepts text and images; transcribe driver audio before admission.
    const asr = getAsrClient()
    if (!asr) return { ok: false, message: 'MiMo ASR not configured (check TTS base URL / API key).' }
    try {
      const text = await asr.transcribe(base64Audio, format)
      eng.enqueue(state, manualFiring(text))
      return { ok: true, text }
    } catch (err) {
      return { ok: false, message: `ASR error: ${(err as Error)?.message ?? err}` }
    }
  })

  ipcMain.handle('audio:mute', async (_e, muted: boolean) => {
    // persist so it survives restart; renderer already drives the live gain
    await ConfigStore.patch({ audio: { muted } })
    logger.debug(`audio mute -> ${muted}`)
  })
  ipcMain.handle('audio:volume', async (_e, vol: number) => {
    if (typeof vol === 'number' && Number.isFinite(vol)) {
      await ConfigStore.patch({ audio: { volume: Math.max(0, Math.min(1, vol)) } })
    }
  })
  // Renderer ack: an utterance's audio actually drained (drives TTS preemption timing).
  ipcMain.handle('audio:finished', async (_e, utteranceId: string) => {
    if (typeof utteranceId === 'string' && utteranceId.length <= 64) {
      getAudio()?.handlePlaybackFinished(utteranceId)
    }
  })
}
