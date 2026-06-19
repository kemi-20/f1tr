import { api } from '../ipc/ipcClient'
import type { AudioChunk, AudioStart } from '@shared/index'

/**
 * WebAudioEngine — renderer-side playback for MiMo PCM16 streams.
 * MiMo audio is 24000Hz, mono, signed int16 little-endian.
 * We create an AudioContext at exactly 24000Hz so no resampling is needed,
 * and schedule chunks on a seamless cursor to avoid clicks/gaps.
 *
 * Mirrors the verified reference client playback pattern.
 */
class WebAudioEngineImpl {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private nextStart = 0
  private active = new Set<AudioBufferSourceNode>()
  private muted = false
  private volume = 1
  private started = false
  /** id of the utterance currently allowed to play; chunks from any other id are dropped
   *  (e.g. after a preempt the old synthesis's late chunks must not keep sounding). */
  private activeUtteranceId: string | null = null

  /** Must be called from a user gesture (AudioContext autoplay policy). */
  ensure(): void {
    if (this.ctx) return
    this.ctx = new AudioContext({ sampleRate: 24000, latencyHint: 'interactive' })
    this.master = this.ctx.createGain()
    this.master.gain.value = this.muted ? 0 : this.volume
    this.master.connect(this.ctx.destination)
    this.nextStart = this.ctx.currentTime
    this.started = true
  }

  private base64ToBytes(b64: string): Uint8Array {
    const bin = atob(b64)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  }

  onChunk({ utteranceId, base64Pcm16 }: AudioChunk): void {
    if (!this.ctx || !this.master || this.muted) return
    // drop chunks that belong to a superseded utterance (preempted/cancelled)
    if (this.activeUtteranceId !== null && utteranceId !== this.activeUtteranceId) return
    const bytes = this.base64ToBytes(base64Pcm16)
    const n = (bytes.length / 2) | 0
    const buf = this.ctx.createBuffer(1, n, 24000)
    const dst = buf.getChannelData(0)
    const dv = new DataView(bytes.buffer, bytes.byteOffset, n * 2)
    for (let i = 0; i < n; i++) dst[i] = dv.getInt16(i * 2, true) / 32768
    const src = this.ctx.createBufferSource()
    src.buffer = buf
    src.connect(this.master)
    const lead = 0.04 // small lead to absorb jitter / avoid underrun
    const startAt = Math.max(this.nextStart, this.ctx.currentTime + lead)
    src.start(startAt)
    this.nextStart = startAt + buf.duration
    this.active.add(src)
    src.onended = () => {
      this.active.delete(src)
    }
  }

  /** Higher-priority message cut-in: fade out current, stop, restore gain. */
  preempt(start: AudioStart): void {
    if (!this.ctx || !this.master) return
    // the new utterance is now the active one; any late chunks from the old one are dropped
    this.activeUtteranceId = start.utteranceId
    const now = this.ctx.currentTime
    // immediately reset nextStart so new chunks don't schedule to the old timeline
    this.nextStart = now
    const g = this.master.gain
    g.cancelScheduledValues(now)
    g.setValueAtTime(Math.max(g.value, 0.0001), now)
    g.linearRampToValueAtTime(0.0001, now + 0.08) // 80ms fade
    setTimeout(() => {
      this.active.forEach((s) => {
        try {
          s.stop()
        } catch {
          /* already stopped */
        }
      })
      this.active.clear()
      this.nextStart = this.ctx!.currentTime
      const n = this.ctx!.currentTime
      g.setValueAtTime(0.0001, n + 0.09)
      g.linearRampToValueAtTime(this.muted ? 0 : this.volume, n + 0.14)
    }, 90)
  }

  setVolume(v: number): void {
    this.volume = v
    if (this.master && !this.muted) this.master.gain.value = v
  }

  setMuted(m: boolean): void {
    this.muted = m
    if (this.master) this.master.gain.value = m ? 0 : this.volume
  }

  /** Mark which utterance's chunks may play; chunks from any other id are dropped. */
  setActiveUtterance(id: string): void {
    this.activeUtteranceId = id
  }

  pause(): void {
    void this.ctx?.suspend()
  }

  resume(): void {
    void this.ctx?.resume()
  }

  get isStarted(): boolean {
    return this.started
  }

  get contextState(): AudioContextState | 'none' {
    return this.ctx?.state ?? 'none'
  }

  resumeContext(): void {
    void this.ctx?.resume()
  }
}

export const WebAudioEngine = new WebAudioEngineImpl()

/** Subscribe the engine to the audio IPC streams. Call once at app boot.
 *  Returns an unsubscribe function for React useEffect cleanup. */
export function wireAudioIpc(): () => void {
  const offs: (() => void)[] = []
  offs.push(api.on('audio:start', (p) => {
    const start = p as AudioStart
    WebAudioEngine.ensure()
    if (start.priority === 'preempt') {
      WebAudioEngine.preempt(start)
    } else {
      WebAudioEngine.setActiveUtterance(start.utteranceId)
    }
  }))
  offs.push(api.on('audio:chunk', (p) => WebAudioEngine.onChunk(p as AudioChunk)))
  offs.push(api.on('audio:end', () => {
    /* per-utterance end; scheduling handles itself */
  }))
  return () => offs.forEach((off) => off())
}
