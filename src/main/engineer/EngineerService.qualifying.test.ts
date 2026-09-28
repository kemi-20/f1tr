import { afterEach, describe, expect, it, vi } from 'vitest'
import { EngineerService, manualFiring } from './EngineerService'
import { emptyRaceState } from '../state/defaults'
import type { TriggerFiring } from '@shared/types/triggers'

vi.mock('../ipc/sender', () => ({ Sender: { send: vi.fn() } }))
vi.mock('../logging/Logger', () => ({ logger: { info: vi.fn(), error: vi.fn() } }))

afterEach(() => vi.useRealTimers())

describe('qualifying radio at playback time', () => {
  it('holds an out-lap response when the driver starts flying while the model thinks', async () => {
    vi.useFakeTimers()
    const state = emptyRaceState()
    Object.assign(state.session, { sessionType: 5, sessionTimeLeftS: 100 })
    Object.assign(state.player, { onTrack: true, lapPhase: 'out', lapDataUpdatedAt: Date.now() })
    const service = new EngineerService()
    const speak = vi.fn()
    service.setStateProvider(() => state)
    service.setSpeakHandler(speak)
    const firing: TriggerFiring = { ruleId: 'tyre_cold', reasonCode: 'tyre_cold', reason: '', priority: 'normal', kind: 'threshold', ts: Date.now() }
    service.setBackend({ generate: async () => {
      state.player.lapPhase = 'flying'
      expect(() => service.acceptRadio('Warm your tyres', firing)).toThrow('Radio held')
      return ''
    } })
    await service.advise(state, firing)
    expect(speak).not.toHaveBeenCalled()
    service.acceptRadio('Your answer', manualFiring())
    expect(speak).toHaveBeenCalledTimes(1)
  })

  it('interrupts queued ordinary radio on push-lap entry but preserves requested replies', () => {
    const state = emptyRaceState()
    state.session.sessionType = 5
    Object.assign(state.player, { onTrack: true, lapPhase: 'out', lapDataUpdatedAt: Date.now() })
    const service = new EngineerService()
    const interrupt = vi.fn()
    service.setStateProvider(() => state)
    service.setInterruptHandler(interrupt)
    const firing: TriggerFiring = { ruleId: 'heartbeat', reasonCode: 'heartbeat', reason: '', priority: 'low', kind: 'heartbeat', ts: Date.now() }
    service.acceptRadio('Prepare your next lap', firing)
    state.player.lapPhase = 'flying'
    service.observeRadioState(state)
    service.observeRadioState(state)
    expect(interrupt).toHaveBeenCalledTimes(1)
    service.acceptRadio('Driver requested answer', manualFiring())
    service.observeRadioState(state)
    expect(interrupt).toHaveBeenCalledTimes(1)
  })
})
