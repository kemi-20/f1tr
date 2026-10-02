import { afterEach, expect, it, vi } from 'vitest'
import { isF1GameWindow } from '../src/main/screenshot/WindowIdentity'

const f = vi.hoisted(() => ({ run: vi.fn() }))
vi.mock('node:child_process', () => ({ execFile: Object.assign(vi.fn(), {
  [Symbol.for('nodejs.util.promisify.custom')]: f.run
}) }))
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
afterEach(() => { Object.defineProperty(process, 'platform', platform); vi.clearAllMocks() })

it('requires a supported game executable rather than just a matching title', async () => {
  Object.defineProperty(process, 'platform', { ...platform, value: 'win32' })
  f.run.mockResolvedValueOnce({ stdout: 'chrome.exe\r\n' })
    .mockResolvedValueOnce({ stdout: 'F1_25.exe\r\n' })
    .mockRejectedValueOnce(new Error('Access denied'))
  expect(await isF1GameWindow('window:123:0')).toBe(false)
  expect(await isF1GameWindow('window:456:0')).toBe(true)
  expect(await isF1GameWindow('window:789:0')).toBe(false)
  expect(f.run.mock.calls[0][1]).toEqual(['-NoProfile', '-NonInteractive', '-Command', expect.stringContaining('[IntPtr]123')])
  expect(f.run.mock.calls[0][2]).toMatchObject({ timeout: 5000, windowsHide: true })
})

it('rejects malformed or out-of-range HWNDs without starting a subprocess', async () => {
  Object.defineProperty(process, 'platform', { ...platform, value: 'win32' })
  for (const id of ['screen:1:0', 'window:123;Write-Host:0', 'window:0:0', 'window:999999999999999999999999:0']) {
    expect(await isF1GameWindow(id)).toBe(false)
  }
  expect(f.run).not.toHaveBeenCalled()
})
