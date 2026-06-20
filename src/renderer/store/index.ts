import { create } from 'zustand'
import { api } from '../ipc/ipcClient'
import type { AppConfig, SnapshotPayload, EngineerStatus, DeepPartial } from '@shared/index'
import type { RaceState } from '@shared/types/state'

interface TelemetryState {
  snapshot: SnapshotPayload | null
  setSnapshot: (s: SnapshotPayload) => void
}

export const useTelemetryStore = create<TelemetryState>((set) => ({
  snapshot: null,
  setSnapshot: (snapshot) => set({ snapshot })
}))

interface ConfigState {
  config: AppConfig | null
  loading: boolean
  settingsOpen: boolean
  openSettings: () => void
  closeSettings: () => void
  load: () => Promise<void>
  patch: (p: DeepPartial<AppConfig>) => Promise<void>
}

export const useConfigStore = create<ConfigState>((set) => ({
  config: null,
  loading: true,
  settingsOpen: false,
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  load: async () => {
    const config = await api.getConfig()
    set({ config, loading: false })
  },
  patch: async (p) => {
    const config = await api.setConfig(p)
    set({ config })
  }
}))

interface EngineerMessage {
  id: string
  text: string
  ts: number
  priority?: string
}

interface EngineerState {
  status: EngineerStatus
  messages: EngineerMessage[]
  streamingId: string | null
  streamingText: string
  setStatus: (s: EngineerStatus) => void
  startStream: (id: string) => void
  appendDelta: (delta: string) => void
  commit: (id: string, text: string) => void
  clearStream: () => void
}

export const useEngineerStore = create<EngineerState>((set) => ({
  status: 'idle',
  messages: [],
  streamingId: null,
  streamingText: '',
  setStatus: (status) => set({ status }),
  startStream: (id) => set({ streamingId: id, streamingText: '', status: 'thinking' }),
  appendDelta: (delta) =>
    set((s) => ({ streamingText: s.streamingText + delta })),
  commit: (id, text) =>
    set((s) => ({
      messages: [{ id, text, ts: Date.now() }, ...s.messages].slice(0, 50),
      streamingId: null,
      streamingText: '',
      status: 'speaking'
    })),
  clearStream: () => set({ streamingId: null, streamingText: '' })
}))

/** Paint store — the slow (~2Hz) full-state projection from the aggregator. */
interface PaintState {
  race: RaceState | null
  connected: boolean
  setRace: (r: RaceState) => void
  setConnected: (c: boolean) => void
}

export const useRaceStore = create<PaintState>((set) => ({
  race: null,
  connected: false,
  setRace: (race) => set({ race }),
  setConnected: (connected) => set({ connected })
}))

/** Health (packet watchdog + errors). */
interface HealthState {
  connected: boolean
  waiting: boolean
  packetsReceived: number
  packetsDropped: number
  lastPacketMs: number
  errors: string[]
  set: (p: Partial<HealthState>) => void
}

export const useHealthStore = create<HealthState>((set) => ({
  connected: false,
  waiting: true,
  packetsReceived: 0,
  packetsDropped: 0,
  lastPacketMs: 0,
  errors: [],
  set: (p) => set(p)
}))
