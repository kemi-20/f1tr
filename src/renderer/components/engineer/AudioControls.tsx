import { useEffect, useState } from 'react'
import { Volume2, VolumeX, Square } from 'lucide-react'
import { api } from '../../ipc/ipcClient'
import { WebAudioEngine } from '../../audio/WebAudioEngine'
import { useConfigStore, useEngineerStore } from '../../store'
import { cancelVoiceRecording } from '../../hooks/useVoiceRecorder'

/** Mute / volume / Stop controls. */
export function AudioControls(): React.ReactElement {
  const cfg = useConfigStore((s) => s.config)
  const patch = useConfigStore((s) => s.patch)
  const pitwall = cfg?.ui.style === 'pitwall'
  const status = useEngineerStore((s) => s.status)
  const [muted, setMuted] = useState(false)
  const [volume, setVolume] = useState(1)

  // initialize local state + engine from persisted config once it loads
  useEffect(() => {
    if (!cfg) return
    setMuted(cfg.audio.muted)
    setVolume(cfg.audio.volume)
    WebAudioEngine.setMuted(cfg.audio.muted)
    WebAudioEngine.setVolume(cfg.audio.volume)
  }, [cfg?.audio.muted, cfg?.audio.volume])

  // resume AudioContext on first interaction (autoplay policy)
  useEffect(() => {
    const onFirst = (): void => {
      WebAudioEngine.ensure()
      WebAudioEngine.resumeContext()
    }
    window.addEventListener('pointerdown', onFirst, { once: true })
    return () => window.removeEventListener('pointerdown', onFirst)
  }, [])

  const toggleMute = (): void => {
    const m = !muted
    setMuted(m)
    WebAudioEngine.setMuted(m)
    void patch({ audio: { muted: m } })
  }

  const changeVol = (v: number): void => {
    setVolume(v)
    WebAudioEngine.setVolume(v)
    void patch({ audio: { volume: v } })
  }

  const stop = (): void => {
    cancelVoiceRecording()
    void api.cancel()
    WebAudioEngine.stopAll()
  }
  const isSpeaking = status === 'speaking' || status === 'thinking'

  return (
    <div className="audio-controls flex items-center gap-3 rounded-lg bg-black/20 px-3 py-2">
      <button
        onClick={toggleMute}
        className={`chip border ${muted ? 'border-accent-racing/50 text-accent-racing' : 'border-white/10 text-white/60'}`}
        title={muted ? '取消静音' : '静音'}
        aria-label={muted ? '取消静音' : '静音'} aria-pressed={muted}
      >
        {pitwall ? muted ? <VolumeX size={16} /> : <Volume2 size={16} /> : muted ? '🔇' : '🔊'}
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={volume}
        aria-label="主音量"
        onChange={(e) => changeVol(Number(e.target.value))}
        className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-white/10 accent-accent-carbon"
      />
      <span className="num-mono w-8 text-right text-[10px] text-white/40">{Math.round(volume * 100)}</span>
      <button
        onClick={stop}
        className={`chip border ${isSpeaking ? 'border-accent-racing/50 text-accent-racing' : 'border-white/10 text-white/60'}`}
        title="停止播报"
        aria-label="停止播报"
      >
        {pitwall ? <Square size={14} /> : '■'}
      </button>
    </div>
  )
}
