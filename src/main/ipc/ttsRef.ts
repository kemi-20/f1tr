import type { AudioPipeline } from '../audio/AudioPipeline'
import { ConfigStore } from '../config/ConfigStore'
import { MiMoTtsClient } from '../tts/MiMoTtsClient'
import { logger } from '../logging/Logger'
import type { AppConfig } from '@shared/index'

/**
 * Indirection so ipc/register.ts can reach the running AudioPipeline + MiMo client
 * without a circular import with index.ts.
 */
let pipeline: AudioPipeline | null = null
let client: MiMoTtsClient | null = null

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

/** Build/rebuild the MiMo client from current config + secrets; inject into the pipeline. */
export async function wireTts(cfg: AppConfig): Promise<void> {
  if (!pipeline) return
  const secrets = ConfigStore.secrets()
  if (!secrets.mimoBaseURL || !secrets.mimoKey) {
    logger.info('TTS backend inactive (no MIMO_* secrets)')
    pipeline.setClient(null)
    client = null
    return
  }
  client = new MiMoTtsClient({ baseURL: secrets.mimoBaseURL, apiKey: secrets.mimoKey, model: cfg.tts.model })
  pipeline.setClient(client)
  pipeline.setPreemptOnHigh(cfg.audio.preemptOnHigh)
  pipeline.setMaxQueueDepth(cfg.advanced.maxQueueDepth)
  logger.info(`TTS backend ready: ${secrets.mimoBaseURL}`)
}
