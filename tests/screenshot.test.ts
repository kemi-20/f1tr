import { expect, it, vi } from 'vitest'
import { captureF1Screenshot } from '../src/main/screenshot/ScreenshotService'
const f = vi.hoisted(() => ({ getSources: vi.fn(), identify: vi.fn() }))
vi.mock('../src/main/screenshot/WindowIdentity', () => ({ isF1GameWindow: f.identify }))
vi.mock('electron', () => ({ desktopCapturer: { getSources: f.getSources } }))
vi.mock('../src/main/logging/Logger.ts', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
it('captures only a uniquely verified game process', async () => {
  f.getSources.mockResolvedValue([
    { id: 'window:1:0', name: 'F1 25 News - Google Chrome', thumbnail: { toPNG: () => Buffer.from('browser-window-placeholder') } },
    { id: 'window:2:0', name: 'F1® 25', thumbnail: { toPNG: () => Buffer.from('game-window-placeholder') } }
  ])
  f.identify.mockImplementation(async (id: string) => id === 'window:2:0')
  const result = await captureF1Screenshot()
  expect(Buffer.from(result!, 'base64').toString()).toBe('game-window-placeholder')
})

it('rejects a spoofed exact game title or multiple verified windows', async () => {
  const source = { id: 'window:3:0', name: 'F1 25', thumbnail: { toPNG: vi.fn() } }
  f.getSources.mockResolvedValue([source])
  f.identify.mockResolvedValue(false)
  expect(await captureF1Screenshot()).toBeNull()
  expect(source.thumbnail.toPNG).not.toHaveBeenCalled()
  f.getSources.mockResolvedValue([source, { ...source, id: 'window:4:0' }])
  f.identify.mockResolvedValue(true)
  expect(await captureF1Screenshot()).toBeNull()
  expect(source.thumbnail.toPNG).not.toHaveBeenCalled()
})
