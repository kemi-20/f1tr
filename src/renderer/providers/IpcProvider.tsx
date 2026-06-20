import { useEffect } from 'react'
import { api } from '../ipc/ipcClient'
import { useConfigStore, useEngineerStore, useHealthStore, useRaceStore, useTelemetryStore } from '../store'
import { wireAudioIpc } from '../audio/WebAudioEngine'
import type { RaceState, HealthPayload } from '@shared/index'

/**
 * Boot provider: loads config, subscribes to all main->renderer IPC streams,
 * wires the audio engine. Mount once near the root.
 */
export function IpcProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const loadConfig = useConfigStore((s) => s.load)
  const setSnapshot = useTelemetryStore((s) => s.setSnapshot)

  useEffect(() => {
    void loadConfig()
    const offAudio = wireAudioIpc()

    const offs = [
      api.on('telemetry:snapshot', (p) => setSnapshot(p as never)),
      api.on('state:paint', (p) => useRaceStore.getState().setRace(p as RaceState)),
      api.on('health', (p) => {
        const h = p as HealthPayload
        useHealthStore.getState().set({ ...h })
      }),
      api.on('engineer:text', (p) => {
        const { id, delta } = p as { id: string; delta: string }
        const st = useEngineerStore.getState()
        if (st.streamingId !== id) st.startStream(id)
        st.appendDelta(delta)
      }),
      api.on('engineer:advice', (p) => {
        const { id, text } = p as { id: string; text: string }
        useEngineerStore.getState().commit(id, text)
      }),
      api.on('engineer:status', (p) => {
        // main sends { status: 'thinking'|'speaking'|'error'... } — unwrap to the string union
        const payload = p as { status?: string } | string
        const status = (typeof payload === 'string' ? payload : payload?.status ?? 'idle') as never
        const st = useEngineerStore.getState()
        st.setStatus(status)
        // on error/abort, drop the partial streaming bubble so an old-language
        // response doesn't stick after settings changes or Stop.
        if ((status as string) === 'error' || (status as string) === 'idle') st.clearStream()
      })
    ]
    return () => {
      offAudio()
      offs.forEach((off) => off())
    }
  }, [loadConfig, setSnapshot])

  return <>{children}</>
}
