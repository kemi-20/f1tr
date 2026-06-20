import { useEffect, useState } from 'react'
import { api } from '../../ipc/ipcClient'
import { WebAudioEngine } from '../../audio/WebAudioEngine'
import { useConfigStore } from '../../store'

/** Mute / volume / pause controls. The master gain is the single control point. */
export function AudioControls(): React.ReactElement {
  const cfg = useConfigStore((s) => s.config)
  const [muted, setMuted] = useState(false)
  const [volume, setVolume] = useState(1)
  const [paused, setPaused] = useState(false)

  // initialize local state + engine from persisted config once it loads
  useEffect(() => {
    if (!cfg) return
    setMuted(cfg.audio.muted)
    setVolume(cfg.audio.volume)
    setPaused(cfg.audio.pause)
    WebAudioEngine.setMuted(cfg.audio.muted)
    WebAudioEngine.setVolume(cfg.audio.volume)
    if (cfg.audio.pause) WebAudioEngine.pause()
    else WebAudioEngine.resume()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg?.audio.muted, cfg?.audio.volume, cfg?.audio.pause])

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
    void api.setMute(m)
  }

  const changeVol = (v: number): void => {
    setVolume(v)
    WebAudioEngine.setVolume(v)
    void api.setVolume(v)
  }

  const togglePause = (): void => {
    const p = !paused
    setPaused(p)
    if (p) WebAudioEngine.pause()
    else WebAudioEngine.resume()
    void api.setPause(p)
  }

  return (
    <div className="flex items-center gap-3 rounded-lg bg-black/20 px-3 py-2">
      <button
        onClick={toggleMute}
        className={`chip border ${muted ? 'border-accent-racing/50 text-accent-racing' : 'border-white/10 text-white/60'}`}
        title={muted ? '取消静音' : '静音'}
      >
        {muted ? '🔇' : '🔊'}
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={volume}
        onChange={(e) => changeVol(Number(e.target.value))}
        className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-white/10 accent-accent-carbon"
      />
      <span className="num-mono w-8 text-right text-[10px] text-white/40">{Math.round(volume * 100)}</span>
      <button
        onClick={togglePause}
        className={`chip border ${paused ? 'border-accent-ember/50 text-accent-ember' : 'border-white/10 text-white/60'}`}
        title="暂停/恢复音频"
      >
        {paused ? '⏸' : '▶'}
      </button>
    </div>
  )
}
