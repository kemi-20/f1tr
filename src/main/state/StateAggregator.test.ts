import { describe, expect, it } from 'vitest'
import { constants, F1TelemetryClient } from '@z0mt3c/f1-telemetry-client'
import { StateAggregator } from './StateAggregator'
import { DigestBuilder } from '../engineer/DigestBuilder'
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

describe('2026 telemetry state', () => {
  it('combines split gap time and preserves millisecond lap times', () => {
    const aggregator = new StateAggregator()
    const packet = parsedPacket(2026, 2)
    packet.m_lapData[0].m_carPosition = 2
    packet.m_lapData[0].m_lastLapTimeInMS = 92345
    packet.m_lapData[0].m_currentLapTimeInMS = 20123
    packet.m_lapData[0].m_deltaToCarInFrontMinutes = 1
    packet.m_lapData[0].m_deltaToCarInFrontInMS = 15250
    packet.m_lapData[1].m_carPosition = 1

    aggregator.onLapData(packet)

    expect(aggregator.state.player.lastLapTimeS).toBe(92.345)
    expect(aggregator.state.player.currentLapTimeS).toBe(20.123)
    expect(aggregator.state.rivals[1].gapToPlayerS).toBe(75.25)
  })

  it('passes 2026 active aero and overtake state into the engineer digest', () => {
    const aggregator = new StateAggregator()
    aggregator.reset(2026)
    const telemetry = parsedPacket(2026, 16)
    Object.assign(telemetry.m_carTelemetry2Data[0], {
      m_2026Regulations: 1,
      m_activeAeroMode: 1,
      m_activeAeroAvailable: 1,
      m_activeAeroActivationDistance: 180,
      m_overtakeAvailable: 1,
      m_overtakeActive: 0,
      m_overtakeActivationDistance: 220
    })
    aggregator.onCarTelemetry2(telemetry)

    const digest = new DigestBuilder().build(aggregator.state, {
      ruleId: 'test',
      kind: 'manual',
      reasonCode: 'test',
      reason: 'test',
      priority: 'normal',
      ts: 0
    })
    const text = new DigestBuilder().toText(digest)
    expect(text).toContain('active aero straight mode available in 180m')
    expect(text).toContain('overtake available in 220m')
    expect(text).not.toContain('DRS ')
  })

  it('resolves 2026 drivers and teams from participant ids when names are absent', () => {
    const aggregator = new StateAggregator()
    const packet = parsedPacket(2026, 4)
    Object.assign(packet.m_participants[0], {
      m_driverId: 188,
      m_teamId: 485,
      m_name: '',
      m_raceNumber: 41
    })

    aggregator.onParticipants(packet)

    const rival = aggregator.state.rivals[0]
    expect(rival.name).toBe('Arvid Lindblad')
    expect(rival.driverCode).toBe('LIN')
    expect(rival.team).toBe('485')
    expect(rival.teamName).toBe('Audi 26')
    expect(rival.teamColor).toBe('#ff2d00')
  })
})
