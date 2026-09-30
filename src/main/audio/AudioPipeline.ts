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
 * - Playback completion is reported back by the renderer ('audio:finished'), so an
 *   utterance is only retired once its audio has actually drained. Without that ack a
 *   critical message arriving after synthesis finished could not cut off a long reply.
 *
 * MiMo streams PCM16 chunks as they are ready, so playback can start before the
 * full utterance is synthesized.
 */
export class AudioPipeline {
  private client: MiMoTtsClient | null = null
  private current: SynthRequest | null = null
  private queue: SynthRequest[] = []
  private recentText = new Map<string, number>() // normalizedText -> timestamp
  private seq = 0
  private preemptOnHigh = true
  private maxQueueDepth = 3
  /** `<utteranceId>:<reason>` markers — 'complete' (stream end) and a later 'preempt' are
   *  different events and must BOTH reach the renderer. */
  private sentEnds = new Set<string>()
  private playbackWaiters = new Map<string, () => void>()
  private finishedUtterances = new Set<string>()

  setClient(client: MiMoTtsClient | null): void {
    this.client = client
  }

  setPreemptOnHigh(v: boolean): void {
    this.preemptOnHigh = v
  }

  setMaxQueueDepth(n: number): void {
    this.maxQueueDepth = Math.max(1, n)
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
      // unblock the preempted play() loop even when synthesis already finished and the
      // renderer was still several seconds away from draining its buffer
      this.finishPlayback(preemptedId)
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
      this.finishPlayback(this.current.id)
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
    let samplesSent = 0
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
      // Stream end marker: the renderer keeps playing what it already queued and
      // reports back when the last buffer has actually drained.
      this.endOnce(req.id, 'complete')
      await this.waitForPlayback(req.id, playbackHoldMs(samplesSent))
    } catch (err) {
      logger.error('AudioPipeline synthesis failed:', (err as Error)?.message ?? err)
      // on abort/error, still notify renderer so it stops playing the old utterance
      // don't overwrite a preempt/cancel terminal state with a stale error
      if (!this.isTerminalEnd(req.id)) this.endOnce(req.id, 'error')
      // graceful: the renderer still shows the text advice; just no audio
    } finally {
      // only clear if this play() is still the current one — cancelAll may have
      // already started a new play() and we must not clobber its reference
      if (this.current === req) {
        this.current = null
        const next = this.queue.shift()
        if (next) void this.play(next)
      }
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
    const key = `${utteranceId}:${reason}`
    if (this.sentEnds.has(key)) return
    this.sentEnds.add(key)
    if (this.sentEnds.size > 64) {
      this.sentEnds = new Set(Array.from(this.sentEnds).slice(-32))
    }
    Sender.send('audio:end', { utteranceId, reason })
  }

  /** True once this utterance has been cut short (preempted, cancelled or failed). */
  private isTerminalEnd(utteranceId: string): boolean {
    return (
      this.sentEnds.has(`${utteranceId}:preempt`) ||
      this.sentEnds.has(`${utteranceId}:cancel`) ||
      this.sentEnds.has(`${utteranceId}:error`)
    )
  }

  /** Renderer ack: the utterance's audio finished playing (or it never started). */
  handlePlaybackFinished(utteranceId: string): void {
    const waiter = this.playbackWaiters.get(utteranceId)
    if (waiter) {
      this.playbackWaiters.delete(utteranceId)
      waiter()
      return
    }
    // ack arrived before the pipeline started waiting — remember it
    this.finishedUtterances.add(utteranceId)
    if (this.finishedUtterances.size > 32) {
      this.finishedUtterances = new Set(Array.from(this.finishedUtterances).slice(-16))
    }
  }

  private finishPlayback(utteranceId: string): void {
    const waiter = this.playbackWaiters.get(utteranceId)
    if (waiter) {
      this.playbackWaiters.delete(utteranceId)
      waiter()
    }
  }

  /** Resolve when the renderer confirms playback drained, with a duration-based fallback. */
  private async waitForPlayback(utteranceId: string, fallbackMs: number): Promise<void> {
    if (this.finishedUtterances.delete(utteranceId)) return
    await new Promise<void>((resolve) => {
      let timer: NodeJS.Timeout | null = null
      const done = (): void => {
        if (timer) clearTimeout(timer)
        this.playbackWaiters.delete(utteranceId)
        resolve()
      }
      this.playbackWaiters.set(utteranceId, done)
      timer = setTimeout(done, fallbackMs + 1500)
    })
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
