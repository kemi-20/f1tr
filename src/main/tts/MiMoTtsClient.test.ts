import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { logger } from '../logging/Logger'
import { MiMoTtsClient } from './MiMoTtsClient'

const fetchMock = vi.fn<typeof fetch>()
const requestSignals: AbortSignal[] = []

function createClient(): MiMoTtsClient {
  return new MiMoTtsClient({
    baseURL: 'https://tts.example.test/v1',
    apiKey: 'local-test-key',
    model: 'mimo-v2.5-tts'
  })
}

beforeEach(() => {
  fetchMock.mockReset()
  requestSignals.length = 0
  fetchMock.mockImplementation((_input, init) => new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal
    if (!signal) {
      reject(new Error('Missing abort signal'))
      return
    }
    requestSignals.push(signal)
    signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')), { once: true })
  }))
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(logger, 'info').mockImplementation(() => undefined)
  vi.spyOn(logger, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('MiMoTtsClient cancellation', () => {
  it('cancel aborts all concurrent synthesis requests', async () => {
    const client = createClient()
    const raceSpeech = client.synthesize('race radio', 'Mia', 'test', () => undefined)
    const settingsTest = client.synthesize('connection test', 'Mia', 'test', () => undefined)

    expect(requestSignals).toHaveLength(2)
    client.cancel()

    const results = await Promise.allSettled([raceSpeech, settingsTest])
    expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected'])
    expect(requestSignals.every((signal) => signal.aborted)).toBe(true)
  })

  it('an external timeout signal only aborts its own request', async () => {
    const client = createClient()
    const testTimeout = new AbortController()
    const settingsTest = client.synthesize('connection test', 'Mia', 'test', () => undefined, testTimeout.signal)
    const raceSpeech = client.synthesize('race radio', 'Mia', 'test', () => undefined)

    testTimeout.abort()
    await expect(settingsTest).rejects.toMatchObject({ name: 'AbortError' })
    expect(requestSignals[1].aborted).toBe(false)

    client.cancel()
    await expect(raceSpeech).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('GP reference voice selection', () => {
  it('uses the documented voiceclone model only for GP when a sample is configured', async () => {
    const sample = 'data:audio/wav;base64,UklGRg=='
    const client = new MiMoTtsClient({ baseURL: 'https://tts.example.test/v1', apiKey: 'local-test-key',
      model: 'mimo-v2.5-tts', gpVoiceSample: sample })
    const gp = client.synthesize('Box this lap', 'Milo', 'Calm', () => undefined, undefined, 'gp')
    const bono = client.synthesize('Box this lap', 'Milo', 'Calm', () => undefined, undefined, 'bono')
    const gpBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    const bonoBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body))
    expect(gpBody).toMatchObject({ model: 'mimo-v2.5-tts-voiceclone', audio: { format: 'pcm16', voice: sample }, stream: true })
    expect(bonoBody).toMatchObject({ model: 'mimo-v2.5-tts', audio: { format: 'pcm16', voice: 'Milo' }, stream: true })
    client.cancel()
    await Promise.allSettled([gp, bono])
  })

  it('keeps the preset voice when no reference sample exists', async () => {
    const client = createClient()
    const request = client.synthesize('Copy', 'Milo', 'Calm', () => undefined, undefined, 'gp')
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(body.model).toBe('mimo-v2.5-tts')
    expect(body.audio.voice).toBe('Milo')
    client.cancel()
    await Promise.allSettled([request])
  })

  it('falls back once on clone HTTP 429 and pauses clone requests', async () => {
    const client = new MiMoTtsClient({ baseURL: 'https://tts.example.test/v1', apiKey: 'local-test-key',
      model: 'mimo-v2.5-tts', gpVoiceSample: 'data:audio/wav;base64,UklGRg==' })
    fetchMock.mockResolvedValueOnce(new Response('rate limit', { status: 429 }))
    const first = client.synthesize('Box', 'Milo', 'Calm', () => undefined, undefined, 'gp')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).model).toBe('mimo-v2.5-tts-voiceclone')
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).model).toBe('mimo-v2.5-tts')
    const second = client.synthesize('Push', 'Milo', 'Calm', () => undefined, undefined, 'gp')
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body)).model).toBe('mimo-v2.5-tts')
    client.cancel()
    await Promise.allSettled([first, second])
  })

  it('does not hide other clone errors behind a preset request', async () => {
    const client = new MiMoTtsClient({ baseURL: 'https://tts.example.test/v1', apiKey: 'local-test-key',
      model: 'mimo-v2.5-tts', gpVoiceSample: 'data:audio/wav;base64,UklGRg==' })
    fetchMock.mockResolvedValueOnce(new Response('invalid sample', { status: 400 }))
    await expect(client.synthesize('Box', 'Milo', 'Calm', () => undefined, undefined, 'gp')).rejects.toThrow('HTTP 400')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not start the fallback after radio cancellation', async () => {
    const client = new MiMoTtsClient({ baseURL: 'https://tts.example.test/v1', apiKey: 'local-test-key',
      model: 'mimo-v2.5-tts', gpVoiceSample: 'data:audio/wav;base64,UklGRg==' })
    fetchMock.mockImplementationOnce(async () => {
      client.cancel()
      return new Response('rate limit', { status: 429 })
    })
    await expect(client.synthesize('Box', 'Milo', 'Calm', () => undefined, undefined, 'gp')).rejects.toThrow('HTTP 429')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
