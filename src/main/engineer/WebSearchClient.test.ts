import { describe, expect, it, vi } from 'vitest'
import { WebSearchClient, type WebSearchSettings } from './WebSearchClient'

const DEFAULTS: WebSearchSettings = {
  useNativeWebSearch: false,
  llmBaseURL: 'https://api.deepseek.com/v1',
  llmApiKey: 'llm-test-key',
  llmModel: 'deepseek-v4-flash',
  mimoApiKey: 'mimo-env-test-key',
  ttsApiKey: 'custom-tts-test-key',
  ttsBaseURL: 'https://tts.example/v1'
}

function mimoResponse(annotations: unknown[] = [{ url: 'https://fia.com/rules', title: 'FIA rules' }]): Response {
  return new Response(JSON.stringify({
    choices: [{ message: { content: 'A short sourced result.', annotations } }]
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

function deepSeekResponse(url = 'https://www.fia.com/regulations', title = 'FIA Regulations'): Response {
  return new Response(JSON.stringify({
    content: [
      { type: 'text', text: 'Current regulation summary.', citations: [{ url, cited_text: 'Official summary.' }] },
      { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url, title }] }
    ]
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

function client(
  overrides: Partial<WebSearchSettings> = {},
  fetcher: typeof fetch = vi.fn<typeof fetch>().mockImplementation(async () => mimoResponse()),
  now: () => number = Date.now
): WebSearchClient {
  const settings = { ...DEFAULTS, ...overrides }
  return new WebSearchClient(() => settings, fetcher, now)
}

function requestBody(fetcher: ReturnType<typeof vi.fn<typeof fetch>>): Record<string, unknown> {
  const init = fetcher.mock.calls[0][1]
  return JSON.parse(String(init?.body)) as Record<string, unknown>
}

describe('WebSearchClient', () => {
  it('retains complete citations when a multibyte summary exceeds the result budget', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '\u8d5b'.repeat(7000), annotations: [
        { url: 'https://www.fia.com/rules', title: 'FIA', publish_time: '2026-09-28' }
      ] } }]
    })))
    const result = await client({}, fetcher).search('FIA rules')
    expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(8000)
    expect(result).toContain('[FIA](https://www.fia.com/rules) (2026-09-28)')
  })

  it('does not accept invented DeepSeek prose citations as structured search results', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ content: [
      { type: 'text', text: 'Summary', citations: [{ url: 'https://www.fia.com/rules', title: 'FIA' }] },
      { type: 'web_search_tool_result', content: [] }
    ] })))
    await expect(client({ useNativeWebSearch: true }, fetcher).search('FIA rules')).rejects.toThrow('no verifiable sources')
  })

  it('sends only the one validated query to MiMo fallback with bounded native search', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(mimoResponse())
    const search = client({}, fetcher)
    await search.search('  current F1 safety-car rules  ')

    const [url, init] = fetcher.mock.calls[0]
    expect(String(url)).toBe('https://api.xiaomimimo.com/v1/chat/completions')
    expect(init?.redirect).toBe('error')
    expect(init?.headers).toMatchObject({ 'api-key': 'mimo-env-test-key' })
    const body = requestBody(fetcher)
    expect(body.messages).toEqual([{ role: 'user', content: 'current F1 safety-car rules' }])
    expect(body.tools).toEqual([{ type: 'web_search', max_keyword: 3, force_search: true, limit: 1 }])
    expect(body.stream).toBe(false)
    expect(JSON.stringify(body)).not.toContain('telemetry')
    expect(JSON.stringify(body)).not.toContain('race history')
  })

  it('uses the official DeepSeek Messages route and fixed DSH web-search fields for root API URLs', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(deepSeekResponse())
    const search = client({ useNativeWebSearch: true, llmBaseURL: 'https://api.deepseek.com' }, fetcher)
    const result = await search.search('current FIA technical regulations')

    const [url, init] = fetcher.mock.calls[0]
    expect(String(url)).toBe('https://api.deepseek.com/anthropic/v1/messages')
    expect(init?.redirect).toBe('error')
    expect(init?.headers).toMatchObject({
      'x-api-key': 'llm-test-key',
      authorization: 'Bearer llm-test-key',
      'anthropic-version': '2023-06-01'
    })
    const body = requestBody(fetcher)
    expect(body.tools).toEqual([{ type: 'web_search_20250305', name: 'web_search', max_uses: 1 }])
    expect(body.messages).toEqual([{
      role: 'user', content: [{ type: 'text', text: 'Perform a web search for the query: current FIA technical regulations' }]
    }])
    expect(body).not.toHaveProperty('tool_choice')
    expect(result).toContain('https://www.fia.com/regulations')
    expect(result).toContain('Official summary.')
  })

  it('uses MiMo native search for a supported model on its official endpoint', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(mimoResponse())
    const search = client({
      useNativeWebSearch: true,
      llmBaseURL: 'https://api.xiaomimimo.com/v1',
      llmModel: 'mimo-v2.6-pro'
    }, fetcher)
    await search.search('F1 race control updates')

    expect(String(fetcher.mock.calls[0][0])).toBe('https://api.xiaomimimo.com/v1/chat/completions')
    expect(requestBody(fetcher).model).toBe('mimo-v2.6-pro')
    expect(requestBody(fetcher).tools).toEqual([{ type: 'web_search', max_keyword: 3, force_search: true, limit: 1 }])
    expect(fetcher.mock.calls[0][1]?.redirect).toBe('error')
  })

  it('falls back to MiMo for unsupported models and never sends keys to configured custom or private URLs', async () => {
    for (const llmBaseURL of [
      'https://search-gateway.example/custom/v1',
      'https://rebind.attacker.example/v1',
      'https://api.deepseek.com/v1',
      'https://api.xiaomimimo.com/v1',
      'http://127.0.0.1:8080/v1',
      'https://[::1]/v1',
      'http://169.254.169.254/latest/meta-data',
      'https://metadata.google.internal/v1'
    ]) {
      const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => mimoResponse())
      await client({
        useNativeWebSearch: true,
        llmBaseURL,
        llmApiKey: 'must-not-leak-to-custom-host',
        llmModel: 'unsupported-model'
      }, fetcher).search('F1 race control updates')

      expect(String(fetcher.mock.calls[0][0])).toBe('https://api.xiaomimimo.com/v1/chat/completions')
      expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({ 'api-key': 'mimo-env-test-key' })
      expect(JSON.stringify(fetcher.mock.calls[0][1]?.headers)).not.toContain('must-not-leak-to-custom-host')
    }
  })

  it('fails closed when native search returns prose but no verifiable sources', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(mimoResponse([]))
    await expect(client({}, fetcher).search('latest race news')).rejects.toThrow('no verifiable sources')

    const noDeepSeekBlocks = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      content: [{ type: 'text', text: 'I searched and found a result.' }]
    }), { status: 200 }))
    await expect(client({ useNativeWebSearch: true }, noDeepSeekBlocks).search('latest race news'))
      .rejects.toThrow('no native web-search result block')
  })

  it('does not switch providers after a native API authentication failure', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('unauthorized', { status: 401 }))
    await expect(client({ useNativeWebSearch: true }, fetcher).search('latest race news'))
      .rejects.toThrow('HTTP 401')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(String(fetcher.mock.calls[0][0])).toBe('https://api.deepseek.com/anthropic/v1/messages')
  })

  it('falls back from non-default official ports and rejects a nonofficial TTS key source', async () => {
    const fallback = vi.fn<typeof fetch>().mockImplementation(async () => mimoResponse())
    await client({ useNativeWebSearch: true, llmBaseURL: 'https://api.deepseek.com:8443/v1' }, fallback).search('query')
    expect(String(fallback.mock.calls[0][0])).toBe('https://api.xiaomimimo.com/v1/chat/completions')

    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => mimoResponse())
    await expect(client({
      mimoApiKey: '', ttsBaseURL: 'https://api.xiaomimimo.com:8443/v1'
    }, fetcher).search('query')).rejects.toThrow('requires MIMO_API_KEY')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('never sends a custom TTS key to the official MiMo host unless its URL is exactly official', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(mimoResponse())
    await expect(client({ mimoApiKey: '', ttsBaseURL: 'https://tts.example/v1' }, fetcher).search('query'))
      .rejects.toThrow('requires MIMO_API_KEY')
    expect(fetcher).not.toHaveBeenCalled()

    const official = vi.fn<typeof fetch>().mockResolvedValue(mimoResponse())
    await client({ mimoApiKey: '', ttsBaseURL: 'https://api.xiaomimimo.com/v1' }, official).search('query')
    expect(official.mock.calls[0][1]?.headers).toMatchObject({ 'api-key': 'custom-tts-test-key' })
  })

  it('rejects local, IPv4, and bracketed IPv6 source URLs instead of returning an unsourced answer', async () => {
    for (const url of ['http://127.0.0.1/private', 'http://[::1]/private', 'https://internal.local/data']) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(mimoResponse([{ url, title: 'Untrusted' }]))
      await expect(client({}, fetcher).search('query')).rejects.toThrow('no verifiable sources')
    }
  })

  it('caps unique sources at five and bounds the response body size', async () => {
    const annotations = Array.from({ length: 9 }, (_, i) => ({ url: `https://source${i}.example/page`, title: `Source ${i}` }))
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(mimoResponse(annotations))
    const result = await client({}, fetcher).search('query')
    expect(result.match(/\d+\. \[/g)).toHaveLength(5)

    const oversized = vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(96_001), { status: 200 }))
    await expect(client({}, oversized).search('query')).rejects.toThrow('exceeded its size limit')
  })

  it('validates query length and controls before network access', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(mimoResponse())
    const search = client({}, fetcher)
    await expect(search.search('x'.repeat(501))).rejects.toThrow('Invalid web-search query')
    await expect(search.search('search\nwith controls')).rejects.toThrow('Invalid web-search query')
    await expect(search.search({ query: 'not a string' })).rejects.toThrow('Invalid web-search query')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('caches repeated queries, cools down new requests, and honors caller cancellation', async () => {
    let now = 50_000
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => mimoResponse())
    const search = client({}, fetcher, () => now)
    await search.search('cached query')
    await search.search('cached query')
    expect(fetcher).toHaveBeenCalledTimes(1)
    await expect(search.search('different query')).rejects.toThrow('cooling down')
    now += 10_001
    await search.search('different query')
    expect(fetcher).toHaveBeenCalledTimes(2)

    const waiting = vi.fn<typeof fetch>((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }))
    const controller = new AbortController()
    const cancelled = client({}, waiting).search('cancel this', controller.signal)
    controller.abort()
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
  })
})
