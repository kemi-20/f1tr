import { afterEach, expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { F1TelemetryClient } from '@z0mt3c/f1-telemetry-client'
import { StateAggregator } from '../src/main/state/StateAggregator'
import { TelemetryService } from '../src/main/telemetry/TelemetryService'
import { EngineerService, manualFiring } from '../src/main/engineer/EngineerService'
import { MiMoTtsClient } from '../src/main/tts/MiMoTtsClient'
import { DigestBuilder } from '../src/main/engineer/DigestBuilder'
import { DEFAULT_CONFIG } from '../src/shared/types/config'
import { emptyRaceState } from '../src/main/state/defaults'

vi.mock('../src/main/logging/Logger.ts', () => ({ logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../src/main/ipc/sender.ts', () => ({ Sender: { send: vi.fn() } }))
afterEach(() => vi.restoreAllMocks())

function packet(id: number) {
  const bytes = Buffer.alloc(F1TelemetryClient.getPacketSize(2025, id))
  bytes.writeUInt16LE(2025, 0)
  bytes.writeUInt8(id, 6)
  return F1TelemetryClient.parseBufferMessage(bytes, true).data as any
}

it('clears current rain without inventing a track-water measurement', () => {
  const a = new StateAggregator()
  const p = packet(1)
  p.m_sessionType = 15
  p.m_weather = 4
  a.onSession(p)
  expect(a.state.weather.wetnessKnown).toBe(false)
  p.m_weather = 0
  p.m_weatherForecastSamples[0].m_rainPercentage = 0
  for (let i = 0; i < 100; i++) a.onSession(p)
  expect(a.state.weather.isRaining).toBe(false)
  expect(a.state.weather.wetnessKnown).toBe(false)
  const digest = new DigestBuilder().build(a.state, manualFiring())
  expect(digest.player.drs).toBe('no')
  expect(digest.weather.wet).toBeNull()
  expect(digest.player.dmg.wingL).toBe('unknown')
})

it('honors FLBK with increasing overall frame counter', () => {
  const svc = new TelemetryService(20777, DEFAULT_CONFIG.triggers, 60, 'auto', () => {})
  const bytes = Buffer.alloc(F1TelemetryClient.getPacketSize(2025, 3))
  bytes.writeUInt16LE(2025, 0)
  bytes.writeUInt8(3, 6)
  bytes.writeBigUInt64LE(1n, 7)
  bytes.write('FLBK', 29, 'ascii')
  bytes.writeUInt32LE(200, 33)
  bytes.writeFloatLE(4, 37)
  ;(svc as any).receiver.handleMessage(bytes)
  expect(svc.triggers.isFlashbackActive()).toBe(true)
  expect(svc.aggregator.state.flashbackActive).toBe(true)
})

it('runs critical alerts before retaining a queued manual prompt', async () => {
  const service = new EngineerService()
  let rejectFirst: (error: Error) => void = () => {}
  const generate = vi.fn().mockImplementationOnce(() => new Promise((_r, reject) => { rejectFirst = reject }))
    .mockResolvedValue('manual response')
  const cancel = vi.fn(() => rejectFirst(Object.assign(new Error('cancelled'), { name: 'AbortError' })))
  service.setBackend({ generate, cancel })
  const state = emptyRaceState()
  state.session.sessionType = 15
  service.enqueue(state, manualFiring('first'))
  service.enqueue(state, manualFiring('second'))
  service.enqueue(state, { ruleId: 'red_flag', kind: 'event', priority: 'critical', reasonCode: 'red_flag', reason: 'Red flag', ts: Date.now() })
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(generate).toHaveBeenCalledTimes(3)
  expect(generate.mock.calls[1][1].reasonCode).toBe('red_flag')
  expect(generate.mock.calls[2][1].reason).toBe('second')
  expect(generate.mock.calls.some(call => call[1].reasonCode === 'red_flag')).toBe(true)
})

it('refuses to forward credentials or content through HTTP 307', async () => {
  let received = ''
  const target = createServer((req, res) => {
    received = String(req.headers['api-key'] ?? '')
    req.resume()
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.end('data: [DONE]\n\n')
  })
  await new Promise<void>(resolve => target.listen(0, '127.0.0.1', resolve))
  const origin = createServer((req, res) => {
    req.resume()
    res.writeHead(307, { location: `http://127.0.0.1:${(target.address() as any).port}/collect` })
    res.end()
  })
  await new Promise<void>(resolve => origin.listen(0, '127.0.0.1', resolve))
  try {
    const tts = new MiMoTtsClient({ baseURL: `http://127.0.0.1:${(origin.address() as any).port}/v1`, apiKey: 'review-sentinel-NOT-A-REAL-KEY', model: 'test' })
    await expect(tts.synthesize('test', 'test', 'test', () => {})).rejects.toThrow()
    expect(received).toBe('')
  } finally {
    origin.closeAllConnections(); target.closeAllConnections()
    await Promise.all([new Promise<void>(resolve => origin.close(() => resolve())), new Promise<void>(resolve => target.close(() => resolve()))])
  }
})

it('rejects older same-session telemetry before refreshing its timestamp', () => {
  const a = new StateAggregator()
  const p = packet(6)
  p.m_header.m_frameIdentifier = 100
  p.m_carTelemetryData[0].m_speed = 300
  a.onCarTelemetry(p)
  p.m_header.m_frameIdentifier = 90
  p.m_carTelemetryData[0].m_speed = 100
  a.onCarTelemetry(p)
  expect(a.state.player.speedKmh).toBe(300)
})
