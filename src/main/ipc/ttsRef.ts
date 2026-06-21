import type { AudioPipeline } from '../audio/AudioPipeline'
import { ConfigStore } from '../config/ConfigStore'
import { MiMoTtsClient } from '../tts/MiMoTtsClient'
import { MiMoAsrClient } from '../engineer/MiMoAsrClient'
import { normalizeURL } from '../config/env'
import { logger } from '../logging/Logger'
import type { AppConfig } from '@shared/index'

/**
 * Indirection so ipc/register.ts can reach the running AudioPipeline + MiMo client
 * without a circular import with index.ts.
 */
let pipeline: AudioPipeline | null = null
let client: MiMoTtsClient | null = null
let asrClient: MiMoAsrClient | null = null

export function setAudio(p: AudioPipeline | null): void {
  pipeline = p
}

export function setTtsClient(c: MiMoTtsClient | null): void {
  client = c
}

export function getAudio(): AudioPipeline | null {
  return pipeline
}

export function getTtsClient(): MiMoTtsClient | null {
  return client
}
export function getAsrClient(): MiMoAsrClient | null {
  return asrClient
}

/** Build/rebuild the MiMo client from current config; inject into the pipeline.
 *  Effective key = UI override if set, else .env. URL normalized same as LLM. */
export async function wireTts(cfg: AppConfig): Promise<void> {
  if (!pipeline) return
  const baseURL = normalizeURL(cfg.tts.baseURL)
  const apiKey = ConfigStore.ttsKey()
  if (!baseURL || !apiKey) {
    logger.info('TTS backend inactive (no baseURL/key via UI or .env)')
    pipeline.setClient(null)
    client = null
    return
  }
  client = new MiMoTtsClient({ baseURL, apiKey, model: cfg.tts.model })
  pipeline.setClient(client)
  asrClient = new MiMoAsrClient({ baseURL, apiKey, model: 'mimo-v2.5-asr' })
  pipeline.setPreemptOnHigh(cfg.audio.preemptOnHigh)
  pipeline.setMaxQueueDepth(cfg.advanced.maxQueueDepth)
  logger.info(`TTS backend ready: ${baseURL} (TTS + ASR)`)
}
