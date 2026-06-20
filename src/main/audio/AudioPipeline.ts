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
      Sender.send('audio:end', { utteranceId: preemptedId })
      this.client?.cancel()
      this.queue = this.queue.filter((r) => r.priority !== 'low' && r.priority !== 'normal') // drop superseded low/normal
      this.queue.unshift(req) // new request runs next
      // current.play loop will see current=null on its next iteration after cancel resolves
      return
    }

    // otherwise queue (drop lowest if over depth)
    this.queue.push(req)
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
      Sender.send('audio:end', { utteranceId: this.current.id })
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
    Sender.send('audio:start', { utteranceId: req.id, priority: req.priority })
    this.seq = 0
    try {
      await this.client.synthesize(
        req.text,
        req.voice,
        req.direction,
        (base64Pcm16) => {
          Sender.send('audio:chunk', { utteranceId: req.id, seq: this.seq++, base64Pcm16 })
        },
        undefined
      )
      Sender.send('audio:end', { utteranceId: req.id })
    } catch (err) {
      logger.error('AudioPipeline synthesis failed:', (err as Error)?.message ?? err)
      // on abort/error, still notify renderer so it stops playing the old utterance
      Sender.send('audio:end', { utteranceId: req.id })
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

  private priorityRank(p: Priority): number {
    return p === 'critical' ? 4 : p === 'high' ? 3 : p === 'normal' ? 2 : 1
  }
}
