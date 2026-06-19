import type { EngineerService } from '../engineer/EngineerService'
import type { LlmClient } from '../engineer/LlmClient'
import type { AppConfig } from '@shared/index'
import { ConfigStore } from '../config/ConfigStore'
import { logger } from '../logging/Logger'

/**
 * Indirection so ipc/register.ts can reach the running EngineerService + LlmClient
 * without a circular import with index.ts.
 */
let svc: EngineerService | null = null
let llm: LlmClient | null = null

export function setEngineer(s: EngineerService | null): void {
  svc = s
}

export function getEngineer(): EngineerService | null {
  return svc
}

export function getLlm(): LlmClient | null {
  return llm
}

/** Build/rebuild the LLM client from current config + secrets; inject into the engineer.
 *  Called at boot and whenever config (model/baseURL/temperature/language) changes. */
export async function wireLlm(cfg: AppConfig): Promise<void> {
  if (!svc) return
  const { LlmClient } = await import('../engineer/LlmClient')
  const secrets = ConfigStore.secrets()
  svc.setLanguage(cfg.language.mode)
  if (!secrets.aiBaseURL || !secrets.aiKey) {
    logger.info(
      `LLM backend inactive — baseURL=${secrets.aiBaseURL ? '(set)' : '(empty)'} key=${secrets.aiKey ? '(set)' : '(empty)'}`
    )
    svc.setBackend(null)
    llm = null
    return
  }
  const model = cfg.llm.model || secrets.aiModel || 'deepseek-v4-flash'
  llm = new LlmClient(
    { baseURL: secrets.aiBaseURL, apiKey: secrets.aiKey, model, temperature: cfg.llm.temperature, maxTokens: cfg.llm.maxTokens },
    svc.memory
  )
  svc.setBackend(llm)
  logger.info(`LLM backend ready: ${secrets.aiBaseURL} model=${model}`)
}
