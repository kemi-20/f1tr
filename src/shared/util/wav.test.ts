import { describe, it, expect } from 'vitest'
import { bytesToBase64, encodeWavBase64, floatToPcm16, pcm16ToWav, VOICE_SAMPLE_RATE } from './wav'

describe('wav encoding', () => {
  it('writes a canonical 44-byte RIFF/WAVE header', () => {
    const pcm = floatToPcm16(new Float32Array([0, 0.5, -0.5, 1, -1]))
    const wav = pcm16ToWav(pcm, 16_000)

    expect(wav.length).toBe(44 + pcm.length * 2)
    expect(String.fromCharCode(...wav.subarray(0, 4))).toBe('RIFF')
    expect(String.fromCharCode(...wav.subarray(8, 12))).toBe('WAVE')
    expect(String.fromCharCode(...wav.subarray(36, 40))).toBe('data')
    const view = new DataView(wav.buffer)
    expect(view.getUint16(20, true)).toBe(1) // PCM
    expect(view.getUint16(22, true)).toBe(1) // mono
    expect(view.getUint32(24, true)).toBe(16_000)
    expect(view.getUint32(28, true)).toBe(16_000 * 2)
    expect(view.getUint16(34, true)).toBe(16)
    expect(view.getUint32(40, true)).toBe(pcm.length * 2)
    expect(view.getUint32(4, true)).toBe(36 + pcm.length * 2)
  })

  it('clamps out-of-range samples instead of wrapping', () => {
    const pcm = floatToPcm16(new Float32Array([5, -5]))
    expect(pcm[0]).toBe(0x7fff)
    expect(pcm[1]).toBe(-0x8000)
  })

  it('emits ONE base64 string with no interior padding for multi-slice payloads', () => {
    // Regression: the old encoder called btoa() once per 32KB slice, so every slice
    // boundary that wasn't a multiple of 3 bytes emitted '=' in the middle of the string
    // and the ASR endpoint rejected anything longer than ~2s of audio.
    const samples = new Float32Array(16_000 * 3) // 3s @16kHz → ~96KB, three 32KB slices
    for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(i / 20) * 0.4

    const base64 = encodeWavBase64(samples, VOICE_SAMPLE_RATE)

    expect(base64.length).toBeGreaterThan(32_768 * 1.5)
    expect(base64).toMatch(/^[A-Za-z0-9+/]+={0,2}$/)
    expect(base64.slice(0, -2).includes('=')).toBe(false)
    // decodes to a WAV container
    const head = Buffer.from(base64.slice(0, 16), 'base64').toString('ascii')
    expect(head.startsWith('RIFF')).toBe(true)
    expect(head.slice(8, 12)).toBe('WAVE')
  })

  it('round-trips arbitrary bytes through base64', () => {
    const bytes = new Uint8Array(70_000)
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7) % 256
    const decoded = Buffer.from(bytesToBase64(bytes), 'base64')
    expect(decoded.length).toBe(bytes.length)
    expect(decoded[0]).toBe(bytes[0])
    expect(decoded[bytes.length - 1]).toBe(bytes[bytes.length - 1])
  })
})
