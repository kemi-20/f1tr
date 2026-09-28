/**
 * PCM16/WAV encoding helpers.
 *
 * The voice recorder captures 16kHz mono float samples in the renderer and encodes
 * them here. WAV (RIFF/PCM) is accepted directly by the MiMo ASR endpoint, so no
 * lossy MP3 encoder is needed — and a single-pass base64 conversion avoids the
 * chunked-padding bug that made any recording longer than one 32KB slice invalid.
 */

export const VOICE_SAMPLE_RATE = 16_000

/** Clamp float samples to [-1, 1] and convert to signed 16-bit PCM. */
export function floatToPcm16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff)
  }
  return out
}

/** Wrap PCM16 samples in a canonical 44-byte RIFF/WAVE header (mono, 16-bit). */
export function pcm16ToWav(pcm: Int16Array, sampleRate: number = VOICE_SAMPLE_RATE): Uint8Array {
  const dataBytes = pcm.length * 2
  const bytes = new Uint8Array(44 + dataBytes)
  const view = new DataView(bytes.buffer)
  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true) // 1 = PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate: rate * channels * bytesPerSample
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataBytes, true)
  for (let i = 0; i < pcm.length; i++) view.setInt16(44 + i * 2, pcm[i], true)
  return bytes
}

/** Base64-encode bytes with ONE btoa call (multiple calls would emit interior '=' padding). */
export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000 // chunk only the string building, never the base64 call
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)))
  }
  return btoa(binary)
}

/** Float PCM -> 16-bit mono WAV -> base64 (what the ASR IPC transport expects). */
export function encodeWavBase64(samples: Float32Array, sampleRate: number = VOICE_SAMPLE_RATE): string {
  return bytesToBase64(pcm16ToWav(floatToPcm16(samples), sampleRate))
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
}
