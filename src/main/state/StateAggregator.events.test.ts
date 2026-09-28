import { describe, it, expect } from 'vitest'
import { constants, F1TelemetryClient } from '@z0mt3c/f1-telemetry-client'
import { StateAggregator } from './StateAggregator'
import type { AnyParsedPacket } from '../telemetry/UdpReceiver'

function parsedPacket(format: 2025 | 2026, id: number): AnyParsedPacket {
  const name = (constants.PACKET_ID_TO_PACKET as Record<number, string>)[id]
  const size = (constants.PACKET_SIZES as Record<string, Record<number, number>>)[name][format]
  const buffer = Buffer.alloc(size)
  buffer.writeUInt16LE(format, 0)
  buffer.writeUInt8(id, 6)
  const parsed = F1TelemetryClient.parseBufferMessage(buffer, true)
  if (!parsed?.data) throw new Error(`Cannot parse ${format}/${id}`)
  return parsed.data as AnyParsedPacket
}

function eventPacket(
  code: string,
  details: Record<string, number>,
  frame: number,
  uid = 42n
): AnyParsedPacket {
  const packet = parsedPacket(2025, 3)
  packet.m_header.m_sessionUID = uid
  packet.m_header.m_overallFrameIdentifier = frame
  packet.m_eventStringCode = code
  packet.m_eventDetails = details
  return packet
}

describe('StateAggregator — event field mapping', () => {
  it('reads both cars for OVTK instead of the non-existent vehicleIdx', () => {
    const aggregator = new StateAggregator()
    aggregator.onParticipants(namedGrid(['VER', 'NOR', 'LEC']))
    aggregator.onEvent(eventPacket('OVTK', { overtakingVehicleIdx: 1, beingOvertakenVehicleIdx: 0 }, 100))

    const event = aggregator.state.recentEvents.at(-1)!
    expect(event.type).toBe('overtake')
    expect(event.text).toBe('NOR overtook VER')
    expect(event.carIndex).toBe(1)
  })

  it('keeps reporting later overtakes (no session-wide single-fire)', () => {
    const aggregator = new StateAggregator()
    aggregator.onParticipants(namedGrid(['VER', 'NOR', 'LEC', 'HAM']))
    aggregator.onEvent(eventPacket('OVTK', { overtakingVehicleIdx: 2, beingOvertakenVehicleIdx: 1 }, 100))
    aggregator.onEvent(eventPacket('OVTK', { overtakingVehicleIdx: 3, beingOvertakenVehicleIdx: 2 }, 900))
    aggregator.onEvent(eventPacket('OVTK', { overtakingVehicleIdx: 2, beingOvertakenVehicleIdx: 1 }, 1500))

    expect(aggregator.state.recentEvents.filter((e) => e.type === 'overtake')).toHaveLength(3)
  })

  it('drops a duplicated datagram of the same event packet', () => {
    const aggregator = new StateAggregator()
    aggregator.onParticipants(namedGrid(['VER', 'NOR']))
    const packet = eventPacket('OVTK', { overtakingVehicleIdx: 1, beingOvertakenVehicleIdx: 0 }, 100)
    aggregator.onEvent(packet)
    aggregator.onEvent(packet)

    expect(aggregator.state.recentEvents.filter((e) => e.type === 'overtake')).toHaveLength(1)
  })

  it('attributes a collision to the player when they are one of the two cars', () => {
    const aggregator = new StateAggregator()
    aggregator.onParticipants(namedGrid(['VER', 'NOR', 'LEC']))
    aggregator.state.player.carIndex = 1

    aggregator.onEvent(eventPacket('COLL', { vehicle1Idx: 1, vehicle2Idx: 2 }, 300))

    const event = aggregator.state.recentEvents.at(-1)!
    expect(event.type).toBe('collision')
    expect(event.carIndex).toBe(1)
    expect(event.text).toBe('Collision: you and LEC')
  })

  it('labels a collision between two other cars without tagging the player', () => {
    const aggregator = new StateAggregator()
    aggregator.onParticipants(namedGrid(['VER', 'NOR', 'LEC']))
    aggregator.state.player.carIndex = 0

    aggregator.onEvent(eventPacket('COLL', { vehicle1Idx: 1, vehicle2Idx: 2 }, 300))

    const event = aggregator.state.recentEvents.at(-1)!
    expect(event.carIndex).toBe(1)
    expect(event.text).toBe('Collision between NOR and LEC')
  })

  it('reports every penalty a driver receives, not just the first', () => {
    const aggregator = new StateAggregator()
    aggregator.onParticipants(namedGrid(['VER', 'NOR']))
    aggregator.onEvent(eventPacket('PENA', { vehicleIdx: 0, penaltyType: 1, infringementType: 23, lapNum: 5 }, 400))
    aggregator.onEvent(eventPacket('PENA', { vehicleIdx: 0, penaltyType: 1, infringementType: 23, lapNum: 18 }, 1400))

    expect(aggregator.state.recentEvents.filter((e) => e.type === 'penalty')).toHaveLength(2)
  })

  it('reports a second retirement only once per car but allows another car to retire', () => {
    const aggregator = new StateAggregator()
    aggregator.onParticipants(namedGrid(['VER', 'NOR', 'LEC']))
    aggregator.onEvent(eventPacket('RTMT', { vehicleIdx: 1 }, 500))
    aggregator.onEvent(eventPacket('RTMT', { vehicleIdx: 1 }, 600))
    aggregator.onEvent(eventPacket('RTMT', { vehicleIdx: 2 }, 700))

    expect(aggregator.state.recentEvents.filter((e) => e.type === 'retirement')).toHaveLength(2)
  })
})

describe('StateAggregator — safety car lifecycle', () => {
  it('announces a second safety car period as well as the first', () => {
    const aggregator = new StateAggregator()
    const uid = 7n

    aggregator.onSession(sessionPacket(uid, 10, 1)) // SC deployed
    aggregator.onSession(sessionPacket(uid, 20, 0)) // green
    aggregator.onSession(sessionPacket(uid, 30, 1)) // SC again

    const deployed = aggregator.state.recentEvents.filter((e) => e.text === 'Safety Car deployed')
    expect(deployed).toHaveLength(2)
  })
})

function sessionPacket(uid: bigint, frame: number, safetyCarStatus: number): AnyParsedPacket {
  const packet = parsedPacket(2025, 1)
  packet.m_header.m_sessionUID = uid
  packet.m_header.m_overallFrameIdentifier = frame
  packet.m_safetyCarStatus = safetyCarStatus
  packet.m_marshalZones = []
  return packet
}

/** Build a participants packet whose rivals carry the given driver codes. */
function namedGrid(codes: string[]): AnyParsedPacket {
  const packet = parsedPacket(2025, 4)
  for (let i = 0; i < codes.length; i++) {
    Object.assign(packet.m_participants[i], { m_name: codes[i], m_driverId: 0, m_teamId: 0, m_raceNumber: i + 1 })
  }
  return packet
}
