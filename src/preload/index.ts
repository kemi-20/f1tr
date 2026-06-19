import { contextBridge, ipcRenderer } from 'electron'
import type { ApiSurface } from '@shared/index'

const api: ApiSurface = {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch) => ipcRenderer.invoke('config:set', patch),
  testLlm: () => ipcRenderer.invoke('config:test:llm'),
  testTts: () => ipcRenderer.invoke('config:test:tts'),
  testUdp: () => ipcRenderer.invoke('config:test:udp'),
  ask: (text) => ipcRenderer.invoke('engineer:request', text),
  cancel: () => ipcRenderer.invoke('engineer:cancel'),
  setMute: (muted) => ipcRenderer.invoke('audio:mute', muted),
  setVolume: (vol) => ipcRenderer.invoke('audio:volume', vol),
  setPause: (pause) => ipcRenderer.invoke('audio:pause', pause),
  on: (channel, cb) => {
    const handler = (_e: unknown, payload: unknown): void => cb(payload)
    ipcRenderer.on(channel, handler as never)
    return () => ipcRenderer.removeListener(channel, handler as never)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
