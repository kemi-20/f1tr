import { describe, expect, it, vi } from 'vitest'
import { WebSearchClient, responsesEndpoint, type WebSearchSettings } from './WebSearchClient'

const DEFAULTS: WebSearchSettings = {
  useNativeWebSearch: true,
  llmBaseURL: 'https://api.deepseek.com/v1',
  llmApiKey: 'llm-test-key',
  llmModel: 'deepseek-v4-flash',
  mimoApiKey: 'mimo-env-test-key',
  ttsApiKey: 'custom-tts-test-key',
  ttsBaseURL: 'https://tts.example/v1'
}

/** A Responses body whose search result carries real citations. */
function responsesWithCitations(sources = [{ url: 'https://www.fia.com/rules', title: 'FIA rules' }]): Response {
  return new Response(JSON.stringify({
    output: [
      { type: 'reasoning', summary: [] },
      { type: 'web_search_call', status: 'completed' },
      {
        type: 'message',
        status: 'completed',
        content: [{
          type: 'output_text',
          text: 'A short sourced result.',
          annotations: sources.map((source, i) => ({ type: 'url_citation', ...source, index: i }))
        }]
      }
    ],
    output_text: 'A short sourced result.'
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

function client(
  overrides: Partial<WebSearchSettings> = {},
  fetcher: typeof fetch = vi.fn<typeof fetch>().mockImplementation(async () => responsesWithCitations()),
  now: () => number = Date.now
): WebSearchClient {
  const settings = { ...DEFAULTS, ...overrides }
  return new WebSearchClient(() => settings, fetcher, now)
}

/** A chat-completions body whose search result arrives as message annotations. */
function completionsWithAnnotations(annotations = [{ url: 'https://www.fia.com/rules', title: 'FIA rules' }]): Response {
  return new Response(JSON.stringify({
    choices: [{ message: { content: 'A short sourced result.', annotations } }]
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

function requestBody(fetcher: ReturnType<typeof vi.fn<typeof fetch>>): Record<string, unknown> {
  return JSON.parse(String(fetcher.mock.calls[0][1]?.body)) as Record<string, unknown>
}

describe('responsesEndpoint', () => {
  it('appends responses once and normalises trailing slashes', () => {
    expect(responsesEndpoint('https://example.com/v1')?.href).toBe('https://example.com/v1/responses')
    expect(responsesEndpoint('https://example.com/v1/')?.href).toBe('https://example.com/v1/responses')
    expect(responsesEndpoint('https://example.com/v1/responses')?.href).toBe('https://example.com/v1/responses')
    expect(responsesEndpoint('https://example.com/v1/responses/')?.href).toBe('https://example.com/v1/responses')
  })

  it('rejects non-https and credential-bearing base URLs', () => {
    expect(responsesEndpoint('http://example.com/v1')).toBeNull()
    expect(responsesEndpoint('https://user:pass@example.com/v1')).toBeNull()
    expect(responsesEndpoint('not a url')).toBeNull()
  })
})

describe('WebSearchClient native mode', () => {
  it('searches with the current model over Responses and sends nothing but the query', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(responsesWithCitations())
    const result = await client({ useNativeWebSearch: true }, fetcher).search('  current FIA technical regulations  ')

    const [url, init] = fetcher.mock.calls[0]
    expect(String(url)).toBe('https://api.deepseek.com/v1/responses')
    expect(init?.redirect).toBe('error')
    expect(init?.headers).toMatchObject({
      'content-type': 'application/json',
      authorization: 'Bearer llm-test-key'
    })
    const body = requestBody(fetcher)
    expect(body.model).toBe('deepseek-v4-flash')
    expect(body.tools).toEqual([{ type: 'web_search' }])
    expect(body.input).toBe('Perform a web search for the query: current FIA technical regulations')
    const sent = JSON.stringify(body).toLowerCase()
    for (const forbidden of ['telemetry', 'race history', 'lapdistance', 'fuel', 'tyre']) {
      expect(sent).not.toContain(forbidden)
    }
    expect(result).toContain('https://www.fia.com/rules')
  })

  it('uses a custom gateway Responses endpoint rather than MiMo', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(responsesWithCitations())
    await client({
      useNativeWebSearch: true,
      llmBaseURL: 'https://gateway.example/v1',
      llmApiKey: 'gateway-key',
      llmModel: 'some-local-model'
    }, fetcher).search('F1 rule changes')

    expect(String(fetcher.mock.calls[0][0])).toBe('https://gateway.example/v1/responses')
    expect(requestBody(fetcher).model).toBe('some-local-model')
    expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({ authorization: 'Bearer gateway-key' })
    expect(JSON.stringify(fetcher.mock.calls[0][1]?.headers)).not.toContain('mimo-env-test-key')
  })

  it.each([400, 401, 403, 404, 500])('fails on HTTP %i without trying MiMo', async status => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('nope', { status }))
    await expect(client({ useNativeWebSearch: true }, fetcher).search('F1 rule changes'))
      .rejects.toThrow(`HTTP ${status}`)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(String(fetcher.mock.calls[0][0])).toBe('https://api.deepseek.com/v1/responses')
  })

  it('fails closed when the response carries no verifiable source', async () => {
    const proseOnly = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      output: [{ type: 'message', content: [{
        type: 'output_text',
        text: 'I searched and the answer is at https://example.invented/page',
        annotations: []
      }] }],
      output_text: 'I searched and the answer is at https://example.invented/page'
    })))
    await expect(client({ useNativeWebSearch: true }, proseOnly).search('F1 rule changes'))
      .rejects.toThrow('no verifiable sources')
  })

  it('does not substitute the MiMo key when the current model key is missing', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => responsesWithCitations())
    await expect(client({ useNativeWebSearch: true, llmApiKey: '' }, fetcher).search('F1 rule changes'))
      .rejects.toThrow('API key for the current model')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('lets an official MiMo model search natively over its own protocol', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(completionsWithAnnotations())
    const result = await client({
      useNativeWebSearch: true,
      llmBaseURL: 'https://api.xiaomimimo.com/v1',
      llmApiKey: 'mimo-native-key',
      llmModel: 'mimo-v2.6-pro'
    }, fetcher).search('2026 F1 season calendar')

    const [url, init] = fetcher.mock.calls[0]
    // The user's own model, on the protocol its vendor serves — not /responses, and not
    // the fallback model.
    expect(String(url)).toBe('https://api.xiaomimimo.com/v1/chat/completions')
    expect(init?.headers).toMatchObject({ 'api-key': 'mimo-native-key' })
    expect(requestBody(fetcher).model).toBe('mimo-v2.6-pro')
    expect(requestBody(fetcher).tools).toEqual([{ type: 'web_search', max_keyword: 3, force_search: true, limit: 1 }])
    expect(result).toContain('https://www.fia.com/rules')
  })

  it('keeps native MiMo on its own model even when the fallback key differs', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(completionsWithAnnotations())
    await client({
      useNativeWebSearch: true,
      llmBaseURL: 'https://api.xiaomimimo.com/v1/',
      llmApiKey: 'llm-key',
      llmModel: 'mimo-v2.6-flash',
      mimoApiKey: 'other-mimo-key'
    }, fetcher).search('F1 news')

    expect(requestBody(fetcher).model).toBe('mimo-v2.6-flash')
    expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({ 'api-key': 'llm-key' })
    expect(JSON.stringify(fetcher.mock.calls[0][1]?.headers)).not.toContain('other-mimo-key')
  })
})

describe('WebSearchClient MiMo mode', () => {
  it('searches with MiMo over its allowlisted completions dialect', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(completionsWithAnnotations())
    await client({ useNativeWebSearch: false }, fetcher).search('  2026 F1 calendar  ')

    const [url, init] = fetcher.mock.calls[0]
    expect(String(url)).toBe('https://api.xiaomimimo.com/v1/chat/completions')
    expect(init?.redirect).toBe('error')
    expect(init?.headers).toMatchObject({ 'content-type': 'application/json', 'api-key': 'mimo-env-test-key' })
    const body = requestBody(fetcher)
    expect(body.model).toBe('mimo-v2.6-flash')
    expect(body.tools).toEqual([{ type: 'web_search', max_keyword: 3, force_search: true, limit: 1 }])
    expect(body.messages).toEqual([{ role: 'user', content: '2026 F1 calendar' }])
    expect(body.stream).toBe(false)
  })

  it('never falls back to the Responses dialect or another provider', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('nope', { status: 400 }))
    await expect(client({ useNativeWebSearch: false }, fetcher).search('2026 F1 calendar')).rejects.toThrow('HTTP 400')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(String(fetcher.mock.calls[0][0])).toBe('https://api.xiaomimimo.com/v1/chat/completions')
  })

  it('requires a MiMo key and refuses to reuse a third-party TTS key', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => responsesWithCitations())
    await expect(client({ useNativeWebSearch: false, mimoApiKey: '', ttsBaseURL: 'https://tts.example/v1' }, fetcher)
      .search('query')).rejects.toThrow('requires MIMO_API_KEY')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('reuses a TTS key only when the TTS base is exactly the official MiMo endpoint', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => completionsWithAnnotations())
    await client({ useNativeWebSearch: false, mimoApiKey: '', ttsBaseURL: 'https://api.xiaomimimo.com/v1' }, fetcher)
      .search('query')
    expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({ 'api-key': 'custom-tts-test-key' })
  })
})

describe('WebSearchClient response handling', () => {
  it('formats real citations and keeps them within the result budget', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      output: [{ type: 'message', content: [{
        type: 'output_text',
        text: '\u8d5b'.repeat(7000),
        annotations: [{ type: 'url_citation', url: 'https://www.fia.com/rules', title: 'FIA', page_age: '2026-09-28' }]
      }] }],
      output_text: '\u8d5b'.repeat(7000)
    })))
    const result = await client({}, fetcher).search('FIA rules')
    expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(8000)
    expect(result).toContain('[FIA](https://www.fia.com/rules) (2026-09-28)')
  })

  it('does not accept a fabricated tool-call as a search result', async () => {
    const faked = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      output: [{ type: 'message', content: [{
        type: 'output_text',
        text: '<\u200btool_call><function=web_search><parameter=query>F1 calendar</parameter></function></\u200btool_call>',
        annotations: []
      }] }]
    })))
    await expect(client({}, faked).search('F1 calendar')).rejects.toThrow('no verifiable sources')
  })

  it('reads a web_search_call result block as a source', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      output: [
        { type: 'web_search_call', status: 'completed',
          results: [{ url: 'https://www.fia.com/news', title: 'FIA news', snippet: 'Update.' }] },
        { type: 'message', content: [{ type: 'output_text', text: 'Summary', annotations: [] }] }
      ]
    })))
    const result = await client({}, fetcher).search('FIA news')
    expect(result).toContain('[FIA news](https://www.fia.com/news)')
    expect(result).toContain('Update.')
  })

  it('rejects local, IPv4, and bracketed IPv6 source URLs', async () => {
    for (const url of ['http://127.0.0.1/private', 'http://[::1]/private', 'https://internal.local/data']) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(responsesWithCitations([{ url, title: 'Untrusted' }]))
      await expect(client({}, fetcher).search('query')).rejects.toThrow('no verifiable sources')
    }
  })

  it('caps unique sources at five and bounds the response body size', async () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ url: `https://source${i}.example/page`, title: `Source ${i}` }))
    const result = await client({}, vi.fn<typeof fetch>().mockResolvedValue(responsesWithCitations(many))).search('query')
    expect(result.match(/\d+\. \[/g)).toHaveLength(5)

    const oversized = vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(96_001), { status: 200 }))
    await expect(client({}, oversized).search('query')).rejects.toThrow('exceeded its size limit')
  })
})

describe('WebSearchClient cache and controls', () => {
  it('keys the cache by target, model and endpoint, never by query alone', async () => {
    let now = 50_000
    let native = true
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () =>
      native ? responsesWithCitations() : completionsWithAnnotations())
    const settings: WebSearchSettings = { ...DEFAULTS, useNativeWebSearch: true }
    const search = new WebSearchClient(() => settings, fetcher, () => now)
    await search.search('same query')
    await search.search('same query')
    expect(fetcher).toHaveBeenCalledTimes(1)

    native = false
    settings.useNativeWebSearch = false
    now += 60_001
    await search.search('same query')
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(String(fetcher.mock.calls[1][0])).toBe('https://api.xiaomimimo.com/v1/chat/completions')
  })

  it('validates query length and controls before network access', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => responsesWithCitations())
    const search = client({}, fetcher)
    await expect(search.search('x'.repeat(501))).rejects.toThrow('Invalid web-search query')
    await expect(search.search('search\nwith controls')).rejects.toThrow('Invalid web-search query')
    await expect(search.search({ query: 'not a string' })).rejects.toThrow('Invalid web-search query')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('cools down new requests and honors caller cancellation', async () => {
    let now = 50_000
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => responsesWithCitations())
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
