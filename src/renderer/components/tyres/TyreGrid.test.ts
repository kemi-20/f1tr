import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { emptyRaceState } from '../../../main/state/defaults'
import { StateAggregator } from '../../../main/state/StateAggregator'
import type { AnyParsedPacket } from '../../../main/telemetry/UdpReceiver'
import { TyreGrid } from './TyreGrid'

const store = vi.hoisted(() => ({ race: null as ReturnType<typeof emptyRaceState> | null }))
vi.mock('../../store', () => ({ useRaceStore: (select: (state: typeof store) => unknown) => select(store) }))

function damagePacket(value: number): AnyParsedPacket {
  return { m_header: { m_playerCarIndex: 0 }, m_carDamageData: [{
    m_frontLeftWingDamage: value, m_frontRightWingDamage: value, m_rearWingDamage: value,
    m_floorDamage: value, m_sidepodDamage: value
  }] } as unknown as AnyParsedPacket
}

describe('car damage availability', () => {
  beforeEach(() => { store.race = emptyRaceState() })

  it('keeps wings and damage values unknown before a valid damage packet', () => {
    const html = renderToStaticMarkup(createElement(TyreGrid))
    expect(html.match(/damage-wing" style="color:#69747b"/g)).toHaveLength(3)
    expect(html.match(/>--%<\/strong>/g)).toHaveLength(5)
  })

  it('shows healthy wings for an explicit first zero-damage packet and resets for the next session', () => {
    const aggregator = new StateAggregator()
    aggregator.onCarDamage(damagePacket(0))
    store.race = aggregator.state
    expect(store.race.player.damage.telemetryReceived).toBe(true)
    const html = renderToStaticMarkup(createElement(TyreGrid))
    expect(html.match(/damage-wing" style="color:#80FF72"/g)).toHaveLength(3)
    expect(html.match(/>0%<\/strong>/g)).toHaveLength(5)
    aggregator.reset(2026)
    store.race = aggregator.state
    expect(renderToStaticMarkup(createElement(TyreGrid)).match(/damage-wing" style="color:#69747b"/g)).toHaveLength(3)
  })

  it.each([undefined, NaN, -1, 101])('does not mark malformed damage as known (%s)', (value) => {
    const aggregator = new StateAggregator()
    const packet = damagePacket(0)
    packet.m_carDamageData[0].m_rearWingDamage = value
    aggregator.onCarDamage(packet)
    expect(aggregator.state.player.damage.telemetryReceived).toBe(false)
  })

  it('colors confirmed damaged wings', () => {
    const aggregator = new StateAggregator()
    aggregator.onCarDamage(damagePacket(60))
    store.race = aggregator.state
    expect(renderToStaticMarkup(createElement(TyreGrid)).match(/damage-wing" style="color:#FF3030"/g)).toHaveLength(3)
  })
})
