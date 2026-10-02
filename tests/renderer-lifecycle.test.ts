// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Simulate } from 'react-dom/test-utils'
import { EndpointInput } from '../src/renderer/settings/EndpointInput'
import { useVoiceRecorder, cancelVoiceRecording } from '../src/renderer/hooks/useVoiceRecorder'
import { AudioControls } from '../src/renderer/components/engineer/AudioControls'
import { mergeConfig } from '../src/shared/types/config'

const f = vi.hoisted(() => ({ setStatus: vi.fn(), patch: vi.fn(), cfg: {} as any }))
vi.mock('../src/renderer/ipc/ipcClient', () => ({ api: { cancel: vi.fn(), transcribe: vi.fn() } }))
vi.mock('../src/renderer/audio/WebAudioEngine', () => ({ WebAudioEngine: {
  setMuted: vi.fn(), setVolume: vi.fn(), ensure: vi.fn(), resumeContext: vi.fn(), stopAll: vi.fn()
} }))
vi.mock('../src/renderer/store', () => ({
  useEngineerStore: (selector: any) => selector({ setStatus: f.setStatus, status: 'idle' }),
  useConfigStore: (selector: any) => selector({ config: f.cfg, patch: f.patch })
}))

let root: Root | null = null
let host: HTMLDivElement
async function mount(element: React.ReactElement): Promise<void> {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(element))
}
afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
  vi.clearAllMocks()
})

it('keeps partial endpoint input local and saves a complete URL on blur', async () => {
  const save = vi.fn().mockResolvedValue(undefined)
  await mount(createElement(EndpointInput, { value: '', placeholder: 'URL', onSave: save }))
  const input = host.querySelector('input')!
  for (const value of ['h', 'ht', 'https://example.com/v1']) {
    await act(async () => Simulate.change(input, { target: { value } } as any))
    expect(input.value).toBe(value)
    expect(save).not.toHaveBeenCalled()
  }
  await act(async () => Simulate.blur(input))
  expect(save).toHaveBeenCalledWith('https://example.com/v1')
  await act(async () => Simulate.change(input, { target: { value: 'http://' } } as any))
  await act(async () => Simulate.blur(input))
  expect(save).toHaveBeenCalledTimes(1)
  expect(input.getAttribute('aria-invalid')).toBe('true')
})

function Recorder(): React.ReactElement {
  const { state, toggle } = useVoiceRecorder()
  return createElement('button', { onClick: toggle }, state)
}

it('admits one pending microphone request and stops a stream arriving after cancellation', async () => {
  let grant!: (stream: MediaStream) => void
  const request = vi.fn(() => new Promise<MediaStream>(resolve => { grant = resolve }))
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: request } })
  await mount(createElement(Recorder))
  const button = host.querySelector('button')!
  await act(async () => { Simulate.click(button); Simulate.click(button) })
  expect(request).toHaveBeenCalledTimes(1)
  expect(button.textContent).toBe('requesting')
  await act(async () => cancelVoiceRecording())
  const stop = vi.fn()
  await act(async () => grant({ getTracks: () => [{ stop }] } as unknown as MediaStream))
  expect(stop).toHaveBeenCalledOnce()
  expect(button.textContent).toBe('idle')
})

it('stops a microphone stream whose permission completes after unmount', async () => {
  let grant!: (stream: MediaStream) => void
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
    getUserMedia: () => new Promise<MediaStream>(resolve => { grant = resolve })
  } })
  await mount(createElement(Recorder))
  await act(async () => Simulate.click(host.querySelector('button')!))
  await act(async () => root!.unmount())
  root = null
  const stop = vi.fn()
  await act(async () => grant({ getTracks: () => [{ stop }] } as unknown as MediaStream))
  expect(stop).toHaveBeenCalledOnce()
})

it('uses the shared configuration path for HUD volume and mute', async () => {
  f.cfg = mergeConfig({})
  await mount(createElement(AudioControls))
  await act(async () => Simulate.change(host.querySelector('input')!, { target: { value: '0.37' } } as any))
  expect(f.patch).toHaveBeenCalledWith({ audio: { volume: 0.37 } })
  await act(async () => Simulate.click(host.querySelector('[aria-label="静音"]')!))
  expect(f.patch).toHaveBeenCalledWith({ audio: { muted: true } })
})
