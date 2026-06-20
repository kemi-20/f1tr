import { nanoid } from 'nanoid'
import { MiMoTtsClient } from '../tts/MiMoTtsClient'
import { Sender } from '../ipc/sender'
import { logger } from '../logging/Logger'
import type { SynthRequest, Priority } from '@shared/types/audio'

/**
 * AudioPipeline — owns TTS synthesis + playback scheduling coordination.
 *
 * - Priority queue: higher-priority messages preempt in-flight synthesis.
 * - Dedup: identical (normalized) text within the dedup window is skipped.
 * - Synthesis happens in MAIN; the base64 PCM16 chunks cross IPC to the renderer,
 *   which owns the AudioContext (24kHz) and actual playback.
 *
 * NOTE on MiMo latency: current streaming is "compatibility mode" (whole clip synthesized
 * then chunked). So preemption mostly cancels a not-yet-played synthesis, not mid-audio.
 */
export class AudioPipeline {
  private client: MiMoTtsClient | null = null
  private current: SynthRequest | null = null
  private queue: SynthRequest[] = []
  private recentText = new Map<string, number>() // normalizedText -> timestamp
  private seq = 0
  private preemptOnHigh = true
  private maxQueueDepth = 3
  private endedUtterances = new Set<string>()

  setClient(client: MiMoTtsClient | null): void {
    this.client = client
  }

  setPreemptOnHigh(v: boolean): void {
    this.preemptOnHigh = v
  }

  setMaxQueueDepth(n: number): void {
    this.maxQueueDepth = Math.max(1, n)
  }

  get active(): boolean {
    return this.current != null
  }

  /** Enqueue a synthesis request. Higher priority preempts / jumps the queue. */
  enqueue(text: string, priority: Priority, voice: string, direction: string): void {
    const norm = this.normalize(text)
    // dedup
    const now = Date.now()
    for (const [k, t] of this.recentText) {
      if (now - t > 10_000) this.recentText.delete(k)
    }
    if (norm.length > 0 && this.recentText.has(norm)) {
      logger.debug(`AudioPipeline dedup skip: "${text.slice(0, 30)}…"`)
      return
    }
    this.recentText.set(norm, now)

    const req: SynthRequest = { id: nanoid(8), text, priority, voice, direction }

    if (!this.current) {
      void this.play(req)
      return
    }

    // preemption: a higher priority than the current in-flight cuts it off
    if (this.preemptOnHigh && this.higherThan(priority, this.current.priority)) {
      const preemptedId = this.current.id
      logger.info(`AudioPipeline preempt: [${priority}] > [${this.current.priority}]`)
      this.endOnce(preemptedId, 'preempt')
      this.client?.cancel()
      this.queue = this.queue.filter((r) => this.priorityRank(r.priority) >= this.priorityRank(priority))
      this.insertQueued(req)
      // current.play loop will see current=null on its next iteration after cancel resolves
      return
    }

    // otherwise queue (drop lowest if over depth)
    this.insertQueued(req)
    if (this.queue.length > this.maxQueueDepth) {
      // evict the lowest-priority queued item
      let worst = 0
      for (let i = 1; i < this.queue.length; i++) {
        if (this.priorityRank(this.queue[i].priority) < this.priorityRank(this.queue[worst].priority)) worst = i
      }
      this.queue.splice(worst, 1)
    }
  }

  /** Cancel everything (Stop button). */
  cancelAll(): void {
    this.client?.cancel()
    if (this.current) {
      this.endOnce(this.current.id, 'cancel')
    }
    this.queue = []
    this.current = null
  }

  private async play(req: SynthRequest): Promise<void> {
    if (!this.client) {
      logger.warn('AudioPipeline: no TTS client — skipping synthesis')
      return
    }
    this.current = req
    this.endedUtterances.delete(req.id)
    Sender.send('audio:start', { utteranceId: req.id, priority: req.priority })
    this.seq = 0
    let samplesSent = 0
    let completed = false
    try {
      await this.client.synthesize(
        req.text,
        req.voice,
        req.direction,
        (base64Pcm16) => {
          samplesSent += pcm16Samples(base64Pcm16)
          Sender.send('audio:chunk', { utteranceId: req.id, seq: this.seq++, base64Pcm16 })
        },
        undefined
      )
      completed = true
      this.endOnce(req.id, 'complete')
      await sleep(playbackHoldMs(samplesSent))
    } catch (err) {
      logger.error('AudioPipeline synthesis failed:', (err as Error)?.message ?? err)
      // on abort/error, still notify renderer so it stops playing the old utterance
      this.endOnce(req.id, completed ? 'complete' : 'error')
      // graceful: the renderer still shows the text advice; just no audio
    } finally {
      this.current = null
      // drain the queue
      const next = this.queue.shift()
      if (next) void this.play(next)
    }
  }

  private normalize(text: string): string {
    return text.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 200)
  }

  private higherThan(a: Priority, b: Priority): boolean {
    return this.priorityRank(a) > this.priorityRank(b)
  }

  private insertQueued(req: SynthRequest): void {
    const rank = this.priorityRank(req.priority)
    const idx = this.queue.findIndex((queued) => this.priorityRank(queued.priority) < rank)
    if (idx === -1) this.queue.push(req)
    else this.queue.splice(idx, 0, req)
  }

  private endOnce(utteranceId: string, reason: 'complete' | 'cancel' | 'error' | 'preempt'): void {
    if (this.endedUtterances.has(utteranceId)) return
    this.endedUtterances.add(utteranceId)
    if (this.endedUtterances.size > 32) {
      this.endedUtterances = new Set(Array.from(this.endedUtterances).slice(-16))
    }
    Sender.send('audio:end', { utteranceId, reason })
  }

  private priorityRank(p: Priority): number {
    return p === 'critical' ? 4 : p === 'high' ? 3 : p === 'normal' ? 2 : 1
  }
}

function pcm16Samples(base64Pcm16: string): number {
  return Math.floor((base64Pcm16.length * 3 / 4) / 2)
}

function playbackHoldMs(samples: number): number {
  if (samples <= 0) return 0
  return Math.min(60_000, Math.ceil((samples / 24_000) * 1000) + 160)
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve()
}
