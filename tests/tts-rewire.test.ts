import { expect, it, vi } from 'vitest'
import { mergeConfig } from '../src/shared/types/config'
import { getTtsClient, setAudio, wireTts } from '../src/main/ipc/ttsRef'
vi.mock('../src/main/config/ConfigStore.ts', () => ({ ConfigStore: { ttsKey: () => 'review-sentinel-NOT-A-REAL-KEY' } }))
vi.mock('../src/main/logging/Logger.ts', () => ({ logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
it('keeps TTS requests alive when only playback settings change', async () => {
  setAudio({ setClient: vi.fn(), setPreemptOnHigh: vi.fn(), setMaxQueueDepth: vi.fn() } as any)
  const cfg = mergeConfig({ tts: { baseURL: 'https://example.invalid/v1' } })
  await wireTts(cfg)
  const old = getTtsClient()!
  const cancel = vi.spyOn(old, 'cancel')
  cfg.audio.volume = 0.5
  await wireTts(cfg)
  expect(cancel).not.toHaveBeenCalled()
  expect(getTtsClient()).toBe(old)
  cfg.tts.baseURL = "https://changed.invalid/v1"
  await wireTts(cfg)
  expect(cancel).toHaveBeenCalledOnce()
  expect(getTtsClient()).not.toBe(old)
  setAudio(null)
})
