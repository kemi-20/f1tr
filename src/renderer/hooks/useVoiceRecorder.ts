import { useState, useRef, useCallback, useEffect } from 'react'
import { api } from '../ipc/ipcClient'
import { useEngineerStore } from '../store'

type RecorderState = 'idle' | 'recording' | 'transcribing'

/**
 * useVoiceRecorder — MediaRecorder-based mic recording with 30s auto-stop.
 *
 * Flow: start → record audio (webm) → stop → base64 → IPC to main →
 * MiMo ASR → text → enqueue as driver_message.
 */
export function useVoiceRecorder() {
  const [state, setState] = useState<RecorderState>('idle')
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const setStatus = useEngineerStore((s) => s.setStatus)

  const cleanup = useCallback(() => {
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    recorderRef.current = null
  }, [])

  useEffect(() => cleanup, [cleanup])

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      // Prefer webm/opus (widely supported); fall back to default
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : ''
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      recorderRef.current = recorder
      chunksRef.current = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = async () => {
        cleanup()
        const blob = new Blob(chunksRef.current, { type: mimeType || 'audio/webm' })
        if (blob.size < 200) { setState('idle'); return }

        setState('transcribing')
        setStatus('thinking')
        try {
          const reader = new FileReader()
          reader.onloadend = async () => {
            const base64 = (reader.result as string).split(',')[1]
            const fmt = mimeType ? 'webm' : 'webm'
            const res = await api.transcribe(base64, fmt)
            if (!res.ok) {
              logger.warn('ASR failed:', res.message)
              setStatus('idle')
            }
            // on success, engineer.enqueue already fired in main;
            // the engineer status will transition naturally
            setState('idle')
          }
          reader.readAsDataURL(blob)
        } catch (err) {
          logger.error('voice recorder error:', err)
          setStatus('idle')
          setState('idle')
        }
      }

      recorder.start()
      setState('recording')
      // 30s auto-stop
      timeoutRef.current = setTimeout(() => {
        if (recorderRef.current?.state === 'recording') {
          recorderRef.current.stop()
        }
      }, 30_000)
    } catch (err) {
      logger.error('mic access failed:', err)
      setState('idle')
    }
  }, [cleanup, setStatus])

  const stop = useCallback(() => {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop()
    }
  }, [])

  const toggle = useCallback(() => {
    if (state === 'recording') stop()
    else if (state === 'idle') void start()
  }, [state, start, stop])

  return { state, toggle }
}

// minimal logger for renderer (avoids importing main's Logger)
const logger = {
  warn: (...args: unknown[]) => console.warn('[voice]', ...args),
  error: (...args: unknown[]) => console.error('[voice]', ...args)
}
