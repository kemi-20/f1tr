import Store from 'electron-store'
import { DEFAULT_CONFIG, mergeConfig, type AppConfig, type DeepPartial } from '@shared/index'
import { loadSecrets } from './env'

/**
 * Persists user preferences (incl. optional API-key overrides) to userData/config.json.
 * .env remains the default; UI overrides win when set.
 */
class ConfigStoreImpl {
  private store: Store<AppConfig> | null = null

  private ensure(): Store<AppConfig> {
    if (!this.store) {
      this.store = new Store<AppConfig>({ name: 'config', defaults: DEFAULT_CONFIG as unknown as AppConfig })
    }
    return this.store
  }

  getAll(): AppConfig {
    const stored = this.ensure().store as unknown as Partial<AppConfig>
    const merged = mergeConfig(stored)
    const secrets = loadSecrets()
    // base URL / model: fall back to .env when not set in UI
    if (!merged.llm.baseURL) merged.llm.baseURL = secrets.aiBaseURL
    if (!merged.llm.model) merged.llm.model = secrets.aiModel
    if (!merged.tts.baseURL) merged.tts.baseURL = secrets.mimoBaseURL
    this.upgradeQuietEngineerDefaults(merged, stored)
    // hasSecret: true if EITHER an override OR a .env key is present
    merged.llm.hasSecret = !!(merged.llm.apiKeyOverride || secrets.aiKey)
    merged.tts.hasSecret = !!(merged.tts.apiKeyOverride || secrets.mimoKey)
    return merged
  }

  patch(partial: DeepPartial<AppConfig>): AppConfig {
    const store = this.ensure()
    for (const key of Object.keys(partial) as (keyof AppConfig)[]) {
      const v = partial[key]
      if (v === undefined) continue
      const current = store.get(key) as unknown
      if (v && typeof v === 'object' && !Array.isArray(v) && current && typeof current === 'object') {
        store.set(key, { ...(current as object), ...(v as object) })
      } else {
        store.set(key, v as never)
      }
    }
    return this.getAll()
  }

  /** Resolve the effective LLM key: override wins, else .env. */
  llmKey(): string {
    const cfg = this.getAll()
    return cfg.llm.apiKeyOverride || loadSecrets().aiKey
  }

  /** Resolve the effective MiMo key: override wins, else .env. */
  ttsKey(): string {
    const cfg = this.getAll()
    return cfg.tts.apiKeyOverride || loadSecrets().mimoKey
  }

  private upgradeQuietEngineerDefaults(config: AppConfig, stored: Partial<AppConfig>): void {
    if (stored.llm?.maxTokens === 80) config.llm.maxTokens = DEFAULT_CONFIG.llm.maxTokens
    if (stored.triggers?.heartbeatIntervalS === 60) config.triggers.heartbeatIntervalS = DEFAULT_CONFIG.triggers.heartbeatIntervalS
    if (stored.triggers?.globalMinGapS === 8) config.triggers.globalMinGapS = DEFAULT_CONFIG.triggers.globalMinGapS
    if (stored.triggers?.tyreColdC === 80) config.triggers.tyreColdC = DEFAULT_CONFIG.triggers.tyreColdC
    if (stored.triggers?.tyreHotC === 110) config.triggers.tyreHotC = DEFAULT_CONFIG.triggers.tyreHotC
    if (stored.ui?.accent === '#2DD4BF') config.ui.accent = DEFAULT_CONFIG.ui.accent
  }
}

export const ConfigStore = new ConfigStoreImpl()
