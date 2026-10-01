import type { TriggerFiring } from './triggers'
import type { TrackPosition } from './state'

export interface PositionPayload {
  ts: number
  sessionUID: string
  trackId: number
  flashbackActive: boolean
  positions: TrackPosition[]
}

export type EngineerStatus = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error'

export interface EngineerStatusPayload {
  status: EngineerStatus
  message?: string
}

export interface SnapshotPayload {
  ts: number
  speedKmh: number
  gear: number
  rpm: number
  ersPercent: number
  drsActive: boolean
  drsAllowed: boolean
  regulations2026: boolean
  activeAeroMode: 'corner' | 'straight' | null
  activeAeroAvailable: boolean
  overtakeAvailable: boolean
  overtakeActive: boolean
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
  audioFinished: (utteranceId: string) => Promise<void>
  on: (channel: string, cb: (payload: unknown) => void) => () => void
}

// forward import to keep config type reachable from here
import type { AppConfig, DeepPartial } from './config'
