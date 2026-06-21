// @ts-ignore
import lamejs from 'lamejs'
import { useState, useRef, useCallback, useEffect } from 'react'
import { api } from '../ipc/ipcClient'
import { useEngineerStore } from '../store'

type RecorderState = 'idle' | 'recording' | 'transcribing'

/**
 * useVoiceRecorder — records mic audio as 16kHz mono PCM and encodes to WAV
 * (MiMo ASR only accepts wav/mp3, not webm).
 *
 * Flow: start → AudioContext captures PCM → stop → encode MP3 → base64 →
 * IPC to main → MiMo ASR (mimo-v2.5-asr) → text → enqueue as driver_message.
 */
export function useVoiceRecorder() {
  const [state, setState] = useState<RecorderState>('idle')
  const audioCtxRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const chunksRef = useRef<Float32Array[]>([])
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const setStatus = useEngineerStore((s) => s.setStatus)

  const cleanup = useCallback(() => {
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null }
    if (processorRef.current) {
      processorRef.current.disconnect()
      processorRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      void audioCtxRef.current.close()
    }
    audioCtxRef.current = null
  }, [])

  useEffect(() => cleanup, [cleanup])

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true }
      })
      streamRef.current = stream
      // 16kHz mono — ASR doesn't need more, keeps base64 small
      const ctx = new AudioContext({ sampleRate: 16000 })
      audioCtxRef.current = ctx
      const source = ctx.createMediaStreamSource(stream)
      // 4096-sample buffer, 1 channel
      const processor = ctx.createScriptProcessor(4096, 1, 1)
      processorRef.current = processor
      chunksRef.current = []

      processor.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0)
        // copy because the buffer is reused
        chunksRef.current.push(new Float32Array(input))
      }
      source.connect(processor)
      processor.connect(ctx.destination)

      setState('recording')
      timeoutRef.current = setTimeout(() => {
        if (processorRef.current) stop()
      }, 30_000)
    } catch (err) {
      console.error('[voice] mic access failed:', err)
      setState('idle')
    }
  }, [cleanup, setStatus])

  const stop = useCallback(() => {
    if (!processorRef.current) return
    const processor = processorRef.current
    const ctx = audioCtxRef.current
    if (!ctx) return

    // disconnect first so no more onaudioprocess fires
    processor.disconnect()

    // collect all PCM samples
    const chunks = chunksRef.current
    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0)
    if (totalLength < 1600) { // less than 0.1s
      cleanup()
      setState('idle')
      return
    }

    const pcm = new Float32Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
      pcm.set(chunk, offset)
      offset += chunk.length
    }

    cleanup()

    // encode MP3 (128kbps, 16kHz, mono) — smaller than WAV, faster to transfer
    const mp3Base64 = encodeMp3Base64(pcm, ctx.sampleRate)

    setState('transcribing')
    setStatus('thinking')

    void api.transcribe(mp3Base64, 'mp3').then((res) => {
      if (!res.ok) {
        console.warn('[voice] ASR failed:', res.message)
        setStatus('idle')
      }
      // on success, engineer.enqueue already fired in main
      setState('idle')
    }).catch((err) => {
      console.error('[voice] transcribe error:', err)
      setStatus('idle')
      setState('idle')
    })
  }, [cleanup, setStatus])

  const toggle = useCallback(() => {
    if (state === 'recording') stop()
    else if (state === 'idle') void start()
  }, [state, start, stop])

  return { state, toggle }
}

/**
 * Encode Float32 PCM samples into MP3 (128kbps, mono) as a base64 string.
 * MiMo ASR expects: data:audio/mpeg;base64,...
 */
function encodeMp3Base64(samples: Float32Array, sampleRate: number): string {
  // Float32 -> Int16
  const int16 = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
  }
  // Encode to MP3 in 1152-sample blocks
  const encoder = new lamejs.Mp3Encoder(1, sampleRate, 128)
  const blockSize = 1152
  const chunks: Uint8Array[] = []
  for (let i = 0; i < int16.length; i += blockSize) {
    const block = int16.subarray(i, i + blockSize)
    const mp3buf = encoder.encodeBuffer(block)
    if (mp3buf.length > 0) chunks.push(new Uint8Array(mp3buf))
  }
  const end = encoder.flush()
  if (end.length > 0) chunks.push(new Uint8Array(end))
  // Concatenate all MP3 chunks -> base64
  const total = chunks.reduce((sum, c) => sum + c.length, 0)
  const merged = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    merged.set(c, offset)
    offset += c.length
  }
  let binary = ''
  for (let i = 0; i < merged.length; i++) {
    binary += String.fromCharCode(merged[i])
  }
  return btoa(binary)
}
