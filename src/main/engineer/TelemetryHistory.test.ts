import { describe, expect, it } from 'vitest'
import { TelemetryHistory } from './TelemetryHistory'

let frame = 0

function carTelemetry2(extra: Record<string, unknown> = {}): Record<string, unknown> {
  frame += 1
  return {
    m_header: { m_sessionUID: 1n, m_frameIdentifier: frame, m_playerCarIndex: 0 },
    ...extra
  }
}

function parse(value: string): Record<string, unknown> {
  return JSON.parse(value) as Record<string, unknown>
}

describe('TelemetryHistory packet queries', () => {
  it('keeps the newest packet sample live while older samples stay at 5-second spacing', () => {
    const history = new TelemetryHistory()
    history.recordPacket(12, carTelemetry2({ m_value: 1 }), 1_000)
    history.recordPacket(12, carTelemetry2({ m_value: 2 }), 1_500)
    history.recordPacket(12, carTelemetry2({ m_value: 3 }), 6_500)

    const latest = parse(history.query({ packet: '12', offset: 0 }))
    expect(latest.ts).toBe(6_500)
    expect((latest.data as Record<string, unknown>).m_value).toBe(3)

    const older = parse(history.query({ packet: '12', offset: 1 }))
    expect(older.ts).toBe(1_500)
    expect((older.data as Record<string, unknown>).m_value).toBe(2)

    expect(parse(history.query({ packet: '12', offset: 2 })).unavailable).toBe(true)
  })

  it('reads a single field path instead of the whole decoded packet', () => {
    const history = new TelemetryHistory()
    history.recordPacket(12, carTelemetry2({ m_tyreSets: { m_fitted: 2, m_name: 'MEDIUM' } }), 1_000)

    const result = parse(history.query({ packet: '12', field: 'm_tyreSets.m_fitted' }))
    expect(result.field).toBe('m_tyreSets.m_fitted')
    expect(result.data).toBe(2)
    expect(JSON.stringify(result)).not.toContain('MEDIUM')
  })

  it('pages array fields and refuses an unbounded array read', () => {
    const history = new TelemetryHistory()
    history.recordPacket(12, carTelemetry2({ m_tyreSetData: Array.from({ length: 100 }, (_, i) => i), m_tyreSets: { m_fitted: 2 } }), 1_000)

    const page = parse(history.query({ packet: '12', field: 'm_tyreSetData', arrayOffset: 10, arrayLimit: 5 }))
    expect(page.data).toMatchObject({ total: 100, offset: 10, items: [10, 11, 12, 13, 14], nextOffset: 15 })

    const tail = parse(history.query({ packet: '12', field: 'm_tyreSetData', arrayOffset: 98, arrayLimit: 5 }))
    expect(tail.data).toMatchObject({ items: [98, 99], nextOffset: null })

    expect(history.query({ packet: '12', arrayOffset: 5 })).toContain('Invalid history query')
    expect(history.query({ packet: '12', field: 'm_tyreSetData', arrayLimit: 65 })).toContain('Invalid history query')
    expect(history.query({ packet: '12', field: 'm_tyreSets.m_fitted', arrayLimit: 2 }))
      .toContain('array paging requires an array field')
  })

  it('refuses oversized samples and points at bounded field reads', () => {
    const history = new TelemetryHistory()
    history.recordPacket(12, carTelemetry2({ m_bulk: Array.from({ length: 8_000 }, () => 123.456) }), 1_000)

    const whole = parse(history.query({ packet: '12' }))
    expect(whole.truncated).toBe(true)
    expect(String(whole.hint)).toContain('field')
    expect(whole.data).toBeUndefined()

    const slice = parse(history.query({ packet: '12', field: 'm_bulk', arrayOffset: 0, arrayLimit: 4 }))
    expect((slice.data as Record<string, unknown>).items).toHaveLength(4)
  })

  it('rejects prototype, malformed and oversized field paths', () => {
    const history = new TelemetryHistory()
    history.recordPacket(12, carTelemetry2({ m_value: 1 }), 1_000)

    for (const field of ['__proto__', 'constructor', 'm_header.__proto__', 'm_value.0', 'm_value ', 'm-value',
      'm_value.m_value.m_value.m_value.m_value.m_value.m_value.m_value.m_value', 'x'.repeat(257)]) {
      expect(history.query({ packet: '12', field })).toBe('Invalid history query')
    }
    expect(history.query({ packet: '12', field: 'm_missing' })).toBe(JSON.stringify({ unavailable: true, packet: '12', field: 'm_missing' }))
  })

  it('rejects prototype and unknown keys on the query object itself', () => {
    const history = new TelemetryHistory()
    history.recordPacket(12, carTelemetry2({ m_value: 1 }), 1_000)

    const proto = JSON.parse('{"packet":"12","__proto__":{"polluted":true}}') as unknown
    expect(history.query(proto)).toBe('Invalid history query')
    expect(history.query({ packet: '12', extra: 1 })).toBe('Invalid history query')
    expect(history.query({ packet: '16' })).toContain('unavailable')
    expect(history.query({ packet: '12', offset: 12 })).toBe('Invalid history query')
    expect(history.query({ packet: '12:0' })).toContain('unavailable')
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('documents normalized packet coverage, sampling and truncation limits', () => {
    const history = new TelemetryHistory()
    history.recordPacket(12, carTelemetry2({ m_value: 1 }), 1_000)

    const inventory = parse(history.inventory(1_000))
    const limitations = String(inventory.limitations)
    expect(limitations).toContain('packets 0-7, 10, 11 and 16')
    expect(limitations).toContain('read_telemetry_packet')
    expect(limitations).toContain('2026')
    expect(limitations).toContain('256 characters')
    expect(limitations).not.toContain('Packet 16 is not decoded')
    expect(inventory.packets).toEqual([{ key: '12', latestTs: 1_000, samples: 1 }])
  })
})
