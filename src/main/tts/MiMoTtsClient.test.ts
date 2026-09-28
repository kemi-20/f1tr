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
