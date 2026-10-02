import { expect, it } from 'vitest'
import { PacketOrder } from '../src/main/telemetry/PacketOrder'
import type { AnyParsedPacket } from '../src/main/telemetry/UdpReceiver'

function packet(id: number, frame: number, overall: number, uid = 1n, code?: string): AnyParsedPacket {
  return { m_header: { m_packetId: id, m_frameIdentifier: frame, m_overallFrameIdentifier: overall, m_sessionUID: uid },
    m_eventStringCode: code } as AnyParsedPacket
}

it('orders each packet stream independently and rejects duplicate state packets', () => {
  const order = new PacketOrder()
  expect(order.accept(packet(6, 100, 100))).toBe(true)
  expect(order.accept(packet(6, 100, 100))).toBe(false)
  expect(order.accept(packet(6, 90, 90))).toBe(false)
  expect(order.accept(packet(1, 90, 90))).toBe(true)
  expect(order.accept(packet(6, 101, 101))).toBe(true)
})

it('accepts replayed game frames with increasing overall counters but rejects pre-replay packets', () => {
  const order = new PacketOrder()
  expect(order.accept(packet(6, 1000, 1000))).toBe(true)
  expect(order.accept(packet(3, 1000, 1001, 1n, 'FLBK'))).toBe(true)
  expect(order.accept(packet(3, 1000, 1001, 1n, 'FLBK'))).toBe(false)
  expect(order.accept(packet(6, 200, 1002))).toBe(true)
  expect(order.accept(packet(1, 999, 999))).toBe(false)
  expect(order.accept(packet(3, 201, 1003, 1n, 'FTLP'))).toBe(true)
  expect(order.accept(packet(3, 201, 1003, 1n, 'OVTK'))).toBe(true)
})

it('allows a new session while refusing delayed packets from a retired session', () => {
  const order = new PacketOrder()
  expect(order.accept(packet(6, 100, 100))).toBe(true)
  expect(order.accept(packet(6, 1, 1, 2n))).toBe(true)
  expect(order.accept(packet(1, 200, 200, 1n))).toBe(false)
  expect(order.accept(packet(6, 2, 2, 2n))).toBe(true)
})

it('starts a new frame epoch only after explicit FLBK when overall counters are absent', () => {
  const order = new PacketOrder()
  expect(order.accept(packet(6, 1000, 0))).toBe(true)
  expect(order.accept(packet(6, 200, 0))).toBe(false)
  expect(order.accept(packet(3, 1001, 0, 1n, 'FLBK'))).toBe(true)
  expect(order.accept(packet(6, 200, 0))).toBe(true)
})
