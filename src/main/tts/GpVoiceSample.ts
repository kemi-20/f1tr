import { app, dialog } from 'electron'
import { readFileSync, writeFileSync, mkdirSync, rmSync, lstatSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const MAX_BYTES = 7_499_900 // Leave room for the data URI within MiMo's 10 MB base64 limit.
const NAME = 'gp-voice-reference'

function samplePath(ext: 'wav' | 'mp3'): string {
  return join(app.getPath('userData'), `${NAME}.${ext}`)
}

export function getGpVoiceSample(): string | null {
  for (const ext of ['wav', 'mp3'] as const) {
    try {
      const path = samplePath(ext)
      const stat = lstatSync(path)
      if (!stat.isFile() || stat.size < 128 || stat.size > MAX_BYTES) continue
      const bytes = readFileSync(path)
      if (bytes.length < 128 || bytes.length > MAX_BYTES) continue
      if (!validAudio(bytes, ext)) continue
      return `data:${ext === 'wav' ? 'audio/wav' : 'audio/mpeg'};base64,${bytes.toString('base64')}`
    } catch { /* No valid saved sample of this format. */ }
  }
  return null
}

export async function chooseGpVoiceSample(): Promise<boolean> {
  const selection = await dialog.showOpenDialog({
    title: '选择你有权使用的 GP 风格语音参考音频',
    properties: ['openFile'],
    filters: [{ name: 'Audio', extensions: ['wav', 'mp3'] }]
  })
  if (selection.canceled || selection.filePaths.length !== 1) return false
  const source = selection.filePaths[0]
  const ext = source.toLowerCase().endsWith('.wav') ? 'wav' : source.toLowerCase().endsWith('.mp3') ? 'mp3' : null
  if (!ext) throw new Error('Only WAV and MP3 reference audio is supported.')
  const stat = lstatSync(source)
  if (!stat.isFile() || stat.size < 128 || stat.size > MAX_BYTES) throw new Error('Reference audio must be a file under 7.5 MB.')
  const bytes = readFileSync(source)
  if (bytes.length < 128 || bytes.length > MAX_BYTES) throw new Error('Reference audio must be under 7.5 MB.')
  if (!validAudio(bytes, ext)) throw new Error('The selected file is not a valid WAV or MP3 header.')
  const root = app.getPath('userData')
  mkdirSync(root, { recursive: true })
  const temporary = join(root, `${NAME}-${randomUUID()}.tmp`)
  try {
    writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 })
    rmSync(samplePath(ext), { force: true })
    renameSync(temporary, samplePath(ext))
    rmSync(samplePath(ext === 'wav' ? 'mp3' : 'wav'), { force: true })
  } finally {
    rmSync(temporary, { force: true })
  }
  return true
}

export function clearGpVoiceSample(): void {
  rmSync(samplePath('wav'), { force: true })
  rmSync(samplePath('mp3'), { force: true })
}

function validAudio(bytes: Buffer, ext: 'wav' | 'mp3'): boolean {
  if (ext === 'wav') return bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE'
  return bytes.toString('ascii', 0, 3) === 'ID3' || bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0
}
