import { LANGUAGE_PROFILE, normalizeEngineerStyleId } from '@shared/index'
import type { AppConfig, DeepPartial, LanguageMode } from '@shared/index'

/**
 * Trust boundary for renderer-supplied config patches.
 *
 * `config:set` is reachable from the renderer (and therefore from anything that can
 * influence it), so every field is validated against its expected type/range/enum here
 * and unknown keys are dropped. Invalid values are ignored rather than persisted, which
 * keeps NaN / negative / out-of-range junk out of electron-store.
 */
export function sanitizeConfigPatch(patch: unknown): DeepPartial<AppConfig> {
  if (!isPlainObject(patch)) return {}
  const out: DeepPartial<AppConfig> = {}

  const llm = asObject(patch.llm)
  if (llm) {
    const next: DeepPartial<AppConfig['llm']> = {}
    assign(next, 'baseURL', pickEndpoint(llm.baseURL))
    assign(next, 'apiKeyOverride', pickSecret(llm.apiKeyOverride))
    assign(next, 'model', pickString(llm.model, 128))
    assign(next, 'reasoningEffort', pickEnum(llm.reasoningEffort, ['none', 'low', 'max'] as const))
    assign(next, 'contextLimit', pickInt(llm.contextLimit, 8_192, 2_000_000))
    assign(next, 'visionSupported', pickBool(llm.visionSupported))
    if (Object.keys(next).length > 0) out.llm = next
  }

  const tts = asObject(patch.tts)
  if (tts) {
    const next: DeepPartial<AppConfig['tts']> = {}
    assign(next, 'baseURL', pickEndpoint(tts.baseURL))
    assign(next, 'apiKeyOverride', pickSecret(tts.apiKeyOverride))
    assign(next, 'model', pickString(tts.model, 128))
    if (Object.keys(next).length > 0) out.tts = next
  }

  const language = asObject(patch.language)
  if (language) {
    const next: DeepPartial<AppConfig['language']> = {}
    const mode = pickEnum(language.mode, ['zh', 'en', 'mixed'] as const)
    assign(next, 'mode', mode)
    assign(next, 'voice', pickVoice(language.voice, mode))
    assign(next, 'direction', pickString(language.direction, 500))
    if (typeof language.engineerStyle === 'string') next.engineerStyle = normalizeEngineerStyleId(language.engineerStyle)
    if (Object.keys(next).length > 0) out.language = next
  }

  const telemetry = asObject(patch.telemetry)
  if (telemetry) {
    const next: DeepPartial<AppConfig['telemetry']> = {}
    assign(next, 'port', pickInt(telemetry.port, 1, 65535))
    assign(next, 'host', pickHost(telemetry.host))
    assign(next, 'rendererPaintHz', pickInt(telemetry.rendererPaintHz, 1, 30))
    if (Object.keys(next).length > 0) out.telemetry = next
  }

  const triggers = asObject(patch.triggers)
  if (triggers) {
    const next: DeepPartial<AppConfig['triggers']> = {}
    assign(next, 'tyreWearLevels', pickTyreWearLevels(triggers.tyreWearLevels))
    assign(next, 'tyreHotC', pickNum(triggers.tyreHotC, 40, 200))
    assign(next, 'tyreColdC', pickNum(triggers.tyreColdC, 0, 150))
    assign(next, 'defendGapS', pickNum(triggers.defendGapS, 0.1, 10))
    assign(next, 'attackGapS', pickNum(triggers.attackGapS, 0.1, 10))
    assign(next, 'lowFuelKg', pickNum(triggers.lowFuelKg, 0.1, 50))
    assign(next, 'positionChangeDelta', pickInt(triggers.positionChangeDelta, 1, 20))
    assign(next, 'rainImminentPct', pickNum(triggers.rainImminentPct, 1, 100))
    assign(next, 'heartbeatIntervalS', pickInt(triggers.heartbeatIntervalS, 10, 3600))
    assign(next, 'globalMinGapS', pickNum(triggers.globalMinGapS, 0, 600))
    assign(next, 'perRuleCooldownS', pickCooldownMap(triggers.perRuleCooldownS))
    assign(next, 'suppressFirstLap', pickBool(triggers.suppressFirstLap))
    assign(next, 'suppressLastLapLowPriority', pickBool(triggers.suppressLastLapLowPriority))
    if (Object.keys(next).length > 0) out.triggers = next
  }

  const audio = asObject(patch.audio)
  if (audio) {
    const next: DeepPartial<AppConfig['audio']> = {}
    assign(next, 'muted', pickBool(audio.muted))
    assign(next, 'volume', pickNum(audio.volume, 0, 1))
    assign(next, 'preemptOnHigh', pickBool(audio.preemptOnHigh))
    if (Object.keys(next).length > 0) out.audio = next
  }

  const ui = asObject(patch.ui)
  if (ui) {
    const next: DeepPartial<AppConfig['ui']> = {}
    assign(next, 'theme', pickEnum(ui.theme, ['midnight', 'papaya', 'racing'] as const))
    assign(next, 'accent', pickHexColor(ui.accent))
    assign(next, 'glassmorphism', pickBool(ui.glassmorphism))
    assign(next, 'reduceMotion', pickBool(ui.reduceMotion))
    if (Object.keys(next).length > 0) out.ui = next
  }

  const hotkeys = asObject(patch.hotkeys)
  if (hotkeys) {
    const next: DeepPartial<AppConfig['hotkeys']> = {}
    assign(next, 'pushToTalk', pickKeyCode(hotkeys.pushToTalk))
    if (Object.keys(next).length > 0) out.hotkeys = next
  }

  const advanced = asObject(patch.advanced)
  if (advanced) {
    const next: DeepPartial<AppConfig['advanced']> = {}
    assign(next, 'maxQueueDepth', pickInt(advanced.maxQueueDepth, 1, 10))
    if (Object.keys(next).length > 0) out.advanced = next
  }

  return out
}

// ───────────────────────── field validators ─────────────────────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function asObject(v: unknown): Record<string, unknown> | null {
  return isPlainObject(v) ? v : null
}

function assign<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) target[key] = value
}

function pickString(v: unknown, maxLength: number): string | undefined {
  if (typeof v !== 'string') return undefined
  // reject control characters outright; they have no business in config values
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(v)) return undefined
  return v.length <= maxLength ? v : undefined
}

function pickBool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined
}

function pickInt(v: unknown, min: number, max: number): number | undefined {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) return undefined
  return v
}

function pickNum(v: unknown, min: number, max: number): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) return undefined
  return v
}

function pickEnum<T extends string>(v: unknown, allowed: readonly T[]): T | undefined {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : undefined
}

/** Empty string is meaningful ("fall back to .env"); otherwise require an http(s) URL. */
function pickEndpoint(v: unknown): string | undefined {
  const text = pickString(v, 2_048)
  if (text === undefined) return undefined
  if (text === '') return ''
  try {
    const url = new URL(text)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    if (url.username || url.password) return undefined
    return text
  } catch {
    return undefined
  }
}

/** API key override: trimmed, printable, length-bounded. Empty clears the override. */
function pickSecret(v: unknown): string | undefined {
  const text = pickString(v, 512)
  if (text === undefined) return undefined
  const trimmed = text.trim()
  return /\s/.test(trimmed) ? undefined : trimmed
}

/** Voices must come from the shipped catalog (the MiMo API is case-sensitive). */
function pickVoice(v: unknown, mode: LanguageMode | undefined): string | undefined {
  const text = pickString(v, 64)
  if (text === undefined) return undefined
  // A mode-specific voice must come from that mode's catalog; without a mode in the same
  // patch, accept any catalog voice (the mode field may follow in a later patch).
  const modes: LanguageMode[] = mode ? [mode] : ['zh', 'en', 'mixed']
  const catalog = new Set(modes.flatMap((m) => LANGUAGE_PROFILE[m].voices.map((o) => o.id)))
  return catalog.has(text) ? text : undefined
}

/** F1 runs locally; keep telemetry bound to loopback and never expose it to the LAN. */
function pickHost(v: unknown): string | undefined {
  return v === '127.0.0.1' ? v : undefined
}

function pickTyreWearLevels(v: unknown): number[] | undefined {
  if (!Array.isArray(v) || v.length === 0 || v.length > 4) return undefined
  const levels = v.filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0 && n < 100)
  if (levels.length !== v.length) return undefined
  return [...levels].sort((a, b) => a - b)
}

function pickCooldownMap(v: unknown): Record<string, number> | undefined {
  const obj = asObject(v)
  if (!obj) return undefined
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(obj).slice(0, 32)) {
    const name = pickString(key, 64)
    const seconds = pickNum(value, 0, 3600)
    if (name && seconds !== undefined) out[name] = seconds
  }
  return out
}

function pickHexColor(v: unknown): string | undefined {
  const text = pickString(v, 9)
  return text && /^#[0-9a-fA-F]{6}$/.test(text) ? text : undefined
}

/** KeyboardEvent.code-style identifier (Space, KeyA, F1, Numpad0, ArrowUp…). */
function pickKeyCode(v: unknown): string | undefined {
  const text = pickString(v, 32)
  return text && /^[A-Za-z0-9]{1,32}$/.test(text) ? text : undefined
}
