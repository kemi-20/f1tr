import type { EngineerService } from '../engineer/EngineerService'
import { DshBackend } from '../engineer/DshBackend'
import { systemPrompt } from '../engineer/Persona'
import { MiMoVisionClient } from '../engineer/MiMoVisionClient'
import type { AppConfig } from '@shared/index'
import { ConfigStore } from '../config/ConfigStore'
import { normalizeURL } from '../config/env'
import { logger } from '../logging/Logger'

/**
 * Indirection so ipc/register.ts can reach the running EngineerService + LlmClient
 * without a circular import with index.ts.
 */
let svc: EngineerService | null = null
let llm: DshBackend | null = null

export function setEngineer(s: EngineerService | null): void {
  svc = s
}

export function getEngineer(): EngineerService | null {
  return svc
}

export function getLlm(): DshBackend | null {
  return llm
}

/** Build/rebuild the LLM client from current config + secrets; inject into the engineer.
 *  Called at boot and whenever config (model/baseURL/key/temperature/language) changes.
 *  Effective key = UI override if set, else .env. */
export async function wireLlm(cfg: AppConfig): Promise<void> {
  if (!svc) return
  llm?.cancel()
  const baseURL = normalizeURL(cfg.llm.baseURL)
  const apiKey = ConfigStore.llmKey()
  svc.setLanguage(cfg.language.mode)
  if (!baseURL || !apiKey || !cfg.llm.model) {
    logger.info('LLM backend inactive: model endpoint, model ID, or API key is missing')
    svc.setBackend(null)
    llm = null
    return
  }
  try {
    const endpoint = new URL(baseURL)
    if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
      throw new Error('Invalid model endpoint')
    }
  } catch {
    logger.warn('LLM backend inactive: invalid model endpoint')
    svc.setBackend(null)
    llm = null
    return
  }
  const model = cfg.llm.model
  llm = new DshBackend(
    { baseURL, apiKey, model, temperature: cfg.llm.temperature, contextLimit: cfg.llm.contextLimit, visionSupported: cfg.llm.visionSupported },
    svc.telemetryHistory,
    buildVisionClient(cfg),
    (text, firing) => svc?.acceptRadio(text, firing),
    systemPrompt(cfg.language.mode, cfg.language.engineerStyle)
  )
  svc.setBackend(llm)
  logger.info(`LLM backend ready: model=${model} vision=${cfg.llm.visionSupported}`)
}

/** Build a MiMo vision client from the TTS config (same base URL + key). */
function buildVisionClient(cfg: AppConfig): MiMoVisionClient | null {
  const baseURL = normalizeURL(cfg.tts.baseURL)
  const apiKey = ConfigStore.ttsKey()
  if (!baseURL || !apiKey) return null
  return new MiMoVisionClient({ baseURL, apiKey, model: 'mimo-v2.6-flash' })
}
