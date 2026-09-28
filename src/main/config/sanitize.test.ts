import { describe, it, expect } from 'vitest'
import { sanitizeConfigPatch } from './sanitize'

describe('sanitizeConfigPatch', () => {
  it('drops unknown keys and removed fields', () => {
    const out = sanitizeConfigPatch({ llm: { audioSupported: true, hasSecret: true, keySource: 'env', evil: 1 } })
    expect(out.llm).toBeUndefined()
  })

  it('rejects out-of-range and non-finite numbers instead of persisting them', () => {
    expect(sanitizeConfigPatch({ telemetry: { port: 0 } }).telemetry).toBeUndefined()
    expect(sanitizeConfigPatch({ telemetry: { port: 70_000 } }).telemetry).toBeUndefined()
    expect(sanitizeConfigPatch({ telemetry: { port: Number.NaN } }).telemetry).toBeUndefined()
    expect(sanitizeConfigPatch({ llm: { contextLimit: -5 } }).llm).toBeUndefined()
    expect(sanitizeConfigPatch({ audio: { volume: 5 } }).audio).toBeUndefined()
  })

  it('keeps valid values and clamps nothing silently to a different meaning', () => {
    const out = sanitizeConfigPatch({ telemetry: { port: 20_777, rendererPaintHz: 12 }, llm: { reasoningEffort: 'max' } })
    expect(out.telemetry).toEqual({ port: 20_777, rendererPaintHz: 12 })
    expect(out.llm).toEqual({ reasoningEffort: 'max' })
  })

  it('allows only the loopback UDP bind address', () => {
    expect(sanitizeConfigPatch({ telemetry: { host: '0.0.0.0' } }).telemetry).toBeUndefined()
    expect(sanitizeConfigPatch({ telemetry: { host: '::' } }).telemetry).toBeUndefined()
    expect(sanitizeConfigPatch({ telemetry: { host: '127.0.0.1' } }).telemetry).toEqual({ host: '127.0.0.1' })
    expect(sanitizeConfigPatch({ telemetry: { host: '192.168.0.42' } }).telemetry).toBeUndefined()
    expect(sanitizeConfigPatch({ telemetry: { host: 'http://evil/x' } }).telemetry).toBeUndefined()
  })

  it('rejects non-http endpoints and keys containing whitespace', () => {
    expect(sanitizeConfigPatch({ llm: { baseURL: 'file:///etc/passwd' } }).llm).toBeUndefined()
    expect(sanitizeConfigPatch({ llm: { baseURL: 'https://api.example.com/v1' } }).llm).toEqual({ baseURL: 'https://api.example.com/v1' })
    expect(sanitizeConfigPatch({ llm: { apiKeyOverride: 'sk bad key' } }).llm).toBeUndefined()
    expect(sanitizeConfigPatch({ llm: { apiKeyOverride: '' } }).llm).toEqual({ apiKeyOverride: '' })
  })

  it('normalises language fields against the shipped catalogs', () => {
    const out = sanitizeConfigPatch({ language: { mode: 'en', voice: 'Mia', engineerStyle: 'nope' } })
    expect(out.language).toEqual({ mode: 'en', voice: 'Mia', engineerStyle: 'gp' })
    // a Chinese voice cannot be selected while the mode is English — only mode survives
    expect(sanitizeConfigPatch({ language: { mode: 'en', voice: '冰糖' } }).language).toEqual({ mode: 'en' })
  })

  it('accepts only keyboard-event-style hotkeys and hex colours', () => {
    expect(sanitizeConfigPatch({ hotkeys: { pushToTalk: 'Space' } }).hotkeys).toEqual({ pushToTalk: 'Space' })
    expect(sanitizeConfigPatch({ hotkeys: { pushToTalk: 'rm -rf /' } }).hotkeys).toBeUndefined()
    expect(sanitizeConfigPatch({ ui: { accent: '#00D2BE' } }).ui).toEqual({ accent: '#00D2BE' })
    expect(sanitizeConfigPatch({ ui: { accent: 'red;filter:url(x)' } }).ui).toBeUndefined()
  })

  it('returns an empty patch for junk input', () => {
    expect(sanitizeConfigPatch(null)).toEqual({})
    expect(sanitizeConfigPatch('nope')).toEqual({})
    expect(sanitizeConfigPatch([1, 2])).toEqual({})
    expect(sanitizeConfigPatch({ triggers: 'nope' })).toEqual({})
  })
})
