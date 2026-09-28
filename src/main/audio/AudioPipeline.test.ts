import { describe, it, expect, vi, beforeEach } from 'vitest'

const bus = vi.hoisted(() => ({ sent: [] as Array<{ channel: string; payload: Record<string, unknown> }> }))

vi.mock('../ipc/sender', () => ({
  Sender: {
    send: (channel: string, payload: Record<string, unknown>) => bus.sent.push({ channel, payload }),
    setWindow: vi.fn(),
    flush: vi.fn()
  }
}))

import { AudioPipeline } from './AudioPipeline'

/** Emits one short PCM16 chunk per call and resolves immediately (synthesis finishes
 *  long before the renderer has finished playing). */
class FakeTtsClient {
  cancels = 0
  spoken: string[] = []
  async synthesize(
    text: string,
    _voice: string,
    _direction: string,
    onChunk: (base64: string) => void
  ): Promise<void> {
    this.spoken.push(text)
    onChunk(Buffer.from(new Int16Array(24_000)).toString('base64')) // ~1s of audio
  }
  cancel(): void {
    this.cancels++
  }
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

function lastEnd(utteranceId: string): string | undefined {
  return bus.sent.filter((m) => m.channel === 'audio:end' && m.payload.utteranceId === utteranceId).at(-1)?.payload.reason as
    | string
    | undefined
}

describe('AudioPipeline preemption', () => {
  beforeEach(() => {
    bus.sent.length = 0
  })

  it('lets a critical message cut off a reply that is still playing', async () => {
    // Regression: the pipeline used to retire the utterance as soon as synthesis
    // resolved, so a critical call arriving during playback had nothing left to
    // preempt and the urgent message waited out the whole reply.
    const pipeline = new AudioPipeline()
    const tts = new FakeTtsClient()
    pipeline.setClient(tts as never)

    pipeline.enqueue('long first reply', 'normal', 'Mia', 'calm')
    await flush()

    const first = bus.sent.find((m) => m.channel === 'audio:start')!.payload.utteranceId as string
    expect(lastEnd(first)).toBe('complete') // stream ended, playback continues

    pipeline.enqueue('SAFETY CAR', 'critical', 'Mia', 'urgent')
    await flush()

    expect(lastEnd(first)).toBe('preempt')
    expect(tts.cancels).toBeGreaterThan(0)
    expect(tts.spoken).toEqual(['long first reply', 'SAFETY CAR'])
    pipeline.cancelAll()
  })

  it('starts the next queued message once the renderer confirms playback drained', async () => {
    const pipeline = new AudioPipeline()
    const tts = new FakeTtsClient()
    pipeline.setClient(tts as never)

    pipeline.enqueue('first', 'normal', 'Mia', 'calm')
    await flush()
    pipeline.enqueue('second', 'normal', 'Mia', 'calm')
    await flush()
    expect(tts.spoken).toEqual(['first']) // still waiting on the first utterance's playback

    const first = bus.sent.find((m) => m.channel === 'audio:start')!.payload.utteranceId as string
    pipeline.handlePlaybackFinished(first)
    await flush()
    expect(tts.spoken).toEqual(['first', 'second'])
    pipeline.cancelAll()
  })

  it('drops a duplicate message inside the dedup window', async () => {
    const pipeline = new AudioPipeline()
    const tts = new FakeTtsClient()
    pipeline.setClient(tts as never)

    pipeline.enqueue('Box this lap', 'high', 'Mia', 'calm')
    await flush()
    pipeline.handlePlaybackFinished(bus.sent.find((m) => m.channel === 'audio:start')!.payload.utteranceId as string)
    await flush()
    pipeline.enqueue('  box   THIS lap ', 'high', 'Mia', 'calm')
    await flush()

    expect(tts.spoken).toEqual(['Box this lap'])
    pipeline.cancelAll()
  })
})
