import type { TriggerConfig } from './triggers'
import type { LanguageMode } from '../constants/voices'
import { normalizeEngineerStyleId } from '../personas/engineer-styles'

/** Recursively-optional type for config PATCHES (the main process merges them). */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends (infer U)[] ? U[] : T[P] extends object ? DeepPartial<T[P]> : T[P]
}

export type ReasoningEffort = 'none' | 'low' | 'high' | 'max'

/** Where the effective API key comes from (computed in main; the key itself never crosses IPC). */
export type KeySource = 'override' | 'env' | 'none'

/**
 * User-editable application config, persisted to userData/config.json via electron-store.
 *
 * API keys: read from .env by default, but the user can ALSO enter them in the Settings
 * UI (stored here as `apiKeyOverride`). Overrides win over .env. For a local desktop app,
 * storing the key in userData is acceptable and standard (like VS Code storing tokens) —
 * but it is NOT encrypted at rest; document this in the UI.
 */
export interface AppConfig {
 llm: {
   baseURL: string // resolved from AI_API_BASE_URL, editable in UI
   apiKeyOverride: string // '' = use .env AI_API_KEY; otherwise this wins
   model: string // resolved from AI_MODEL
   reasoningEffort: ReasoningEffort
   contextLimit: number // DSH model contextWindow budget in tokens
   useNativeWebSearch: boolean // true = the configured model searches; false = MiMo searches. Both use the same Responses web_search module; there is no fallback between them.
   hasSecret: boolean // whether a key is available (.env or override)
   keySource: KeySource // 'override' | 'env' | 'none' — computed in the main process
    visionSupported: boolean // whether the configured model can accept image input
  }
  tts: {
    baseURL: string // resolved from MIMO_API_BASE_URL, editable in UI
    apiKeyOverride: string // '' = use .env MIMO_API_KEY; otherwise this wins
    model: string // mimo-v2.5-tts
    hasSecret: boolean
    keySource: KeySource
  }
  language: {
    mode: LanguageMode
    voice: string
    direction: string
    engineerStyle: string // which real engineer's style to imitate
  }
  telemetry: {
    port: number
    /** UDP bind address. Defaults to loopback — the game runs on this machine. */
    host: string
    rendererPaintHz: number
  }
  triggers: TriggerConfig
  audio: {
    muted: boolean
    volume: number // 0..1
    preemptOnHigh: boolean
  }
  ui: {
    theme: 'midnight' | 'papaya' | 'racing'
    accent: string
    glassmorphism: boolean
    reduceMotion: boolean
  }
  hotkeys: {
    pushToTalk: string // KeyboardEvent.code, e.g. 'Space', 'KeyA'
  }
  advanced: {
    maxQueueDepth: number
  }
}

export const DEFAULT_CONFIG: AppConfig = {
  llm: { baseURL: '', apiKeyOverride: '', model: '', reasoningEffort: 'low', contextLimit: 200_000, useNativeWebSearch: false, hasSecret: false, keySource: 'none', visionSupported: false },
  tts: { baseURL: '', apiKeyOverride: '', model: 'mimo-v2.5-tts', hasSecret: false, keySource: 'none' },
  language: { mode: 'zh', voice: '冰糖', direction: '冷静果断的 F1 赛车工程师语气', engineerStyle: 'gp' },
  telemetry: {
    port: 20777,
    host: '127.0.0.1',
    rendererPaintHz: 60
  },
  triggers: {
    tyreWearLevels: [50, 70, 90],
    tyreHotC: 115,
    tyreColdC: 75,
    defendGapS: 0.8,
    attackGapS: 0.8,
    lowFuelKg: 5,
    positionChangeDelta: 2,
    rainImminentPct: 40,
    heartbeatIntervalS: 150,
    globalMinGapS: 18,
    perRuleCooldownS: {},
    suppressFirstLap: true,
    suppressLastLapLowPriority: false
  },
  audio: { muted: false, volume: 1, preemptOnHigh: true },
 ui: { theme: 'midnight', accent: '#00D2BE', glassmorphism: true, reduceMotion: false },
  hotkeys: { pushToTalk: 'Space' },
 advanced: { maxQueueDepth: 3 }
}

/** Deep-merge a partial config patch over defaults (shallow per-section). */
export function mergeConfig(patch: DeepPartial<AppConfig>): AppConfig {
  const out: AppConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as AppConfig
  for (const key of Object.keys(patch) as (keyof AppConfig)[]) {
    const p = patch[key]
    if (p && typeof p === 'object' && !Array.isArray(p)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      out[key] = { ...(out[key] as any), ...(p as any) } as any
    } else if (p !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      out[key] = p as any
    }
  }
  out.language.engineerStyle = normalizeEngineerStyleId(out.language.engineerStyle)
  return out
}
