import { describe, expect, it } from 'vitest'
import { constants } from '@z0mt3c/f1-telemetry-client'
import { UdpReceiver } from './UdpReceiver'

const packetSizes = constants.PACKET_SIZES as Record<string, Record<number, number> | undefined>
const packetNames = constants.PACKET_ID_TO_PACKET as Record<number, string | undefined>

function packet(format: 2025 | 2026, id: number): Buffer {
  const name = packetNames[id]
  const size = name && packetSizes[name]?.[format]
  if (!size) throw new Error(`No packet size for ${format}/${id}`)
  const data = Buffer.alloc(size)
  data.writeUInt16LE(format, 0)
  data.writeUInt8(id, 6)
  return data
}

function deliver(receiver: UdpReceiver, data: Buffer): void {
  ;(receiver as unknown as { handleMessage(data: Buffer): void }).handleMessage(data)
}

describe('UDP format boundary', () => {
  it('forces loopback when constructed with a non-local bind address', () => {
    const receiver = new UdpReceiver(20777, 'auto', '192.168.0.42')

    expect((receiver as unknown as { host: string }).host).toBe('127.0.0.1')
  })

  it.each([2025, 2026] as const)('decodes %i session and lap packets', (format) => {
    const receiver = new UdpReceiver()
    const ids: number[] = []
    receiver.onDecoded = (id) => ids.push(id)
    deliver(receiver, packet(format, 1))
    deliver(receiver, packet(format, 2))
    expect(ids).toEqual([1, 2])
    expect(receiver.currentFormat).toBe(format)
    expect(receiver.packetsDropped).toBe(0)
  })

  it('decodes the 2026 active-aero packet with all 24 cars', () => {
    const receiver = new UdpReceiver()
    let carCount = 0
    receiver.on(constants.PACKETS.carTelemetry2, (data) => {
      carCount = data.m_carTelemetry2Data.length
    })
    deliver(receiver, packet(2026, 16))
    expect(carCount).toBe(24)
    expect(receiver.packetsReceived).toBe(1)
  })

  it('rejects unsupported formats, overrides, and truncated datagrams', () => {
    const receiver = new UdpReceiver(20777, 2026)
    const wrongFormat = packet(2025, 2)
    const unsupported = packet(2026, 2)
    unsupported.writeUInt16LE(2024, 0)
    deliver(receiver, wrongFormat)
    deliver(receiver, unsupported)
    deliver(receiver, packet(2026, 16).subarray(0, 50))
    deliver(receiver, Buffer.alloc(28))
    expect(receiver.packetsReceived).toBe(0)
    expect(receiver.packetsDropped).toBe(4)
  })
})
