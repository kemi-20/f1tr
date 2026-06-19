import Store from 'electron-store'
import { DEFAULT_CONFIG, mergeConfig, type AppConfig, type DeepPartial } from '@shared/index'
import { loadSecrets } from './env'

/**
 * Persists non-sensitive preferences to userData/config.json.
 * Secrets never enter here — they are resolved from .env at read time.
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
    // resolve secret presence flags from .env
    const secrets = loadSecrets()
    merged.llm.hasSecret = !!secrets.aiKey
    merged.tts.hasSecret = !!secrets.mimoKey
    if (!merged.llm.baseURL) merged.llm.baseURL = secrets.aiBaseURL
    if (!merged.llm.model) merged.llm.model = secrets.aiModel
    if (!merged.tts.baseURL) merged.tts.baseURL = secrets.mimoBaseURL
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

  /** Returns resolved secrets (for main-internal use only). */
  secrets() {
    return loadSecrets()
  }
}

export const ConfigStore = new ConfigStoreImpl()
