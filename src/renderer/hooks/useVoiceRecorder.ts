// @ts-ignore - lamejs has no official types
import lamejs from 'lamejs'
import { useState, useRef, useCallback, useEffect } from 'react'
import { api } from '../ipc/ipcClient'
import { useEngineerStore } from '../store'

type RecorderState = 'idle' | 'recording' | 'transcribing'

/**
 * useVoiceRecorder — records mic audio as 16kHz mono PCM and encodes to MP3.
 *
 * Flow: start -> AudioContext captures PCM -> stop -> encode MP3 -> base64 ->
 * IPC to main -> MiMo ASR (or direct to LLM if audioSupported) -> text -> driver_message.
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
      try { processorRef.current.disconnect() } catch { /* noop */ }
      processorRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      void audioCtxRef.current.close().catch(() => {})
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
      const ctx = new AudioContext({ sampleRate: 16000 })
      audioCtxRef.current = ctx
      const source = ctx.createMediaStreamSource(stream)
      const processor = ctx.createScriptProcessor(4096, 1, 1)
      processorRef.current = processor
      chunksRef.current = []

      processor.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0)
        chunksRef.current.push(new Float32Array(input))
      }
      source.connect(processor)
      // Connect to a zero-gain node instead of destination — mic audio must NOT
      // play through speakers (feedback + audio process crash on some systems).
      // ScriptProcessorNode requires a connection to fire onaudioprocess.
      const sink = ctx.createGain()
      sink.gain.value = 0
      processor.connect(sink)
      sink.connect(ctx.destination)

      setState('recording')
      timeoutRef.current = setTimeout(() => {
        if (processorRef.current) stop()
      }, 30_000)
    } catch (err) {
      console.error('[voice] mic access failed:', err)
      cleanup()
      setState('idle')
    }
  }, [cleanup, setStatus])

  const stop = useCallback(() => {
    if (!processorRef.current) return
    const ctx = audioCtxRef.current
    if (!ctx) { cleanup(); setState('idle'); return }

    try { processorRef.current.disconnect() } catch { /* noop */ }

    const chunks = chunksRef.current
    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0)
    if (totalLength < 1600) {
      cleanup()
      setState('idle')
      return
    }

    const sampleRate = ctx.sampleRate

    // Merge PCM before cleanup (ctx still alive)
    const pcm = new Float32Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
      pcm.set(chunk, offset)
      offset += chunk.length
    }

    cleanup()

    // Encode MP3 in a try-catch — lamejs can throw on malformed data
    let mp3Base64: string
    try {
      mp3Base64 = encodeMp3Base64(pcm, sampleRate)
    } catch (err) {
      console.error('[voice] MP3 encoding failed:', err)
      setStatus('idle')
      setState('idle')
      return
    }

    setState('transcribing')
    setStatus('thinking')

    void api.transcribe(mp3Base64, 'mp3').then((res) => {
      if (!res.ok) {
        console.warn('[voice] ASR failed:', res.message)
        setStatus('idle')
      }
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
 * Uses chunked base64 encoding to avoid O(n^2) string concatenation.
 */
function encodeMp3Base64(samples: Float32Array, sampleRate: number): string {
  const int16 = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
  }

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

  const total = chunks.reduce((sum, c) => sum + c.length, 0)
  const merged = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    merged.set(c, offset)
    offset += c.length
  }

  // Chunked base64: process in 32KB slices to avoid string concat O(n^2)
  const sliceSize = 32768
  let result = ''
  for (let i = 0; i < merged.length; i += sliceSize) {
    const slice = merged.subarray(i, Math.min(i + sliceSize, merged.length))
    let binary = ''
    for (let j = 0; j < slice.length; j++) {
      binary += String.fromCharCode(slice[j])
    }
    result += btoa(binary)
  }
  return result
}
