import { useState, useRef, useCallback, useEffect } from 'react'
import { api } from '../ipc/ipcClient'
import { useEngineerStore } from '../store'
import { encodeWavBase64 } from '@shared/util/wav'

type RecorderState = 'idle' | 'recording' | 'transcribing'

/**
 * useVoiceRecorder — records mic audio as 16kHz mono PCM and encodes to WAV.
 *
 * Flow: start -> AudioContext captures PCM -> stop -> encode WAV -> base64 ->
 * IPC to main -> MiMo ASR -> text -> driver_message.
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
      setStatus('listening')
      timeoutRef.current = setTimeout(() => {
        if (processorRef.current) stop()
      }, 30_000)
    } catch (err) {
      console.error('[voice] mic access failed:', err)
      cleanup()
      setStatus('idle')
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
      setStatus('idle')
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

    let wavBase64: string
    try {
      wavBase64 = encodeWavBase64(pcm, sampleRate)
    } catch (err) {
      console.error('[voice] WAV encoding failed:', err)
      setStatus('idle')
      setState('idle')
      return
    }

    setState('transcribing')
    setStatus('thinking')

    void api.transcribe(wavBase64, 'wav').then((res) => {
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
