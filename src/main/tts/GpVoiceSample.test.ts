import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const host = vi.hoisted(() => ({ root: '', selected: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => host.root },
  dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [host.selected] }) }
}))

import { chooseGpVoiceSample, clearGpVoiceSample, getGpVoiceSample } from './GpVoiceSample'

beforeEach(() => { host.root = mkdtempSync(join(tmpdir(), 'f1tr-gp-voice-')) })
afterEach(() => { rmSync(host.root, { recursive: true, force: true }) })

describe('GP reference audio boundary', () => {
  it('accepts a selected WAV and removes the saved sample on clear', async () => {
    host.selected = join(host.root, 'source.wav')
    const wav = Buffer.alloc(128)
    wav.write('RIFF', 0)
    wav.write('WAVE', 8)
    writeFileSync(host.selected, wav)
    expect(await chooseGpVoiceSample()).toBe(true)
    expect(getGpVoiceSample()).toBe(`data:audio/wav;base64,${wav.toString('base64')}`)
    clearGpVoiceSample()
    expect(getGpVoiceSample()).toBeNull()
  })

  it('rejects a renamed non-audio file without saving it', async () => {
    host.selected = join(host.root, 'source.wav')
    writeFileSync(host.selected, Buffer.alloc(128, 42))
    await expect(chooseGpVoiceSample()).rejects.toThrow('valid WAV or MP3 header')
    expect(getGpVoiceSample()).toBeNull()
  })
})
