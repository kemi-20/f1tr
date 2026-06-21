import type { TriggerFiring } from './triggers'

/**
 * IPC channel definitions and message shapes.
 * Two frequencies protect the renderer from 60Hz packet flooding:
 *   - SNAPSHOT ~12Hz (paint-only fast fields)
 *   - PAINT    ~2Hz + on-change diff (full panels)
 */
export const IPC = {
  // main -> renderer
  SNAPSHOT: 'telemetry:snapshot',
  PAINT: 'state:paint',
  ENGINEER: 'engineer:text', // streaming token delta
  ADVICEDONE: 'engineer:advice', // completed message object
  STATUS: 'engineer:status', // 'idle'|'listening'|'thinking'|'speaking'|'error'
  AUDIO_START: 'audio:start', // { utteranceId, priority }
  AUDIO_CHUNK: 'audio:chunk', // { utteranceId, seq, base64Pcm16 }
  AUDIO_END: 'audio:end', // { utteranceId, reason }
  SESSION_META: 'session:meta', // format detected, track changed
  HEALTH: 'health', // packet watchdog, API errors

  // renderer -> main
  CONFIG_GET: 'config:get',
  CONFIG_SET: 'config:set',
  TEST_LLM: 'config:test:llm',
  TEST_TTS: 'config:test:tts',
  TEST_UDP: 'config:test:udp',
  ASK: 'engineer:request', // manual trigger
  CANCEL: 'engineer:cancel',
  VOICE: 'engineer:voice', // voice → ASR → driver message
  HOTKEY: 'hotkey:trigger', // global shortcut fired → renderer
  AUDIO_MUTE: 'audio:mute',
  AUDIO_VOL: 'audio:volume',
  AUDIO_PAUSE: 'audio:pause'
} as const

export type EngineerStatus = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error'

export interface SnapshotPayload {
  ts: number
  speedKmh: number
  gear: number
  rpm: number
  ersPercent: number
  drsActive: boolean
  drsAllowed: boolean
  throttle: number
  brake: number
  revLightsPercent: number
}

export interface EngineerToken {
  id: string
  delta: string
}

export interface EngineerAdvice {
  id: string
  text: string
  firing?: TriggerFiring
  ts: number
}

export interface AudioStart {
  utteranceId: string
  priority: 'critical' | 'high' | 'normal' | 'low'
}

export interface AudioChunk {
  utteranceId: string
  seq: number
  base64Pcm16: string
}

export interface AudioEnd {
  utteranceId: string
  reason: 'complete' | 'cancel' | 'error' | 'preempt'
}

export interface SessionMeta {
  packetFormat: 2025 | 2026
  trackName: string
  trackId: number
  sessionTypeLabel: string
}

export interface HealthPayload {
  connected: boolean
  waiting: boolean
  packetsReceived: number
  packetsDropped: number
  lastPacketMs: number
  errors: string[]
}

/** Typed surface exposed on window.api via preload contextBridge. */
export interface ApiSurface {
  getConfig: () => Promise<AppConfig>
  setConfig: (patch: DeepPartial<AppConfig>) => Promise<AppConfig>
  testLlm: () => Promise<{ ok: boolean; message: string }>
  testTts: () => Promise<{ ok: boolean; message: string }>
  testUdp: () => Promise<{ ok: boolean; message: string }>
  ask: (text?: string) => Promise<void>
  cancel: () => Promise<void>
  transcribe: (base64Audio: string, format: string) => Promise<{ ok: boolean; text?: string; message?: string }>
  setMute: (muted: boolean) => Promise<void>
  setVolume: (vol: number) => Promise<void>
  setPause: (pause: boolean) => Promise<void>
  on: (channel: string, cb: (payload: unknown) => void) => () => void
}

// forward import to keep config type reachable from here
import type { AppConfig, DeepPartial } from './config'
