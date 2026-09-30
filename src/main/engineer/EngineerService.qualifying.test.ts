import { afterEach, describe, expect, it, vi } from 'vitest'
import { EngineerService, manualFiring } from './EngineerService'
import { emptyRaceState } from '../state/defaults'
import type { TriggerFiring } from '@shared/types/triggers'
import { Sender } from '../ipc/sender'
import type { RivalState } from '@shared/types/state'

vi.mock('../ipc/sender', () => ({ Sender: { send: vi.fn() } }))
vi.mock('../logging/Logger', () => ({ logger: { info: vi.fn(), error: vi.fn() } }))

afterEach(() => vi.useRealTimers())

describe('qualifying radio at playback time', () => {
  it('rechecks measured closing before speaking and drops a warning when the car stops approaching', () => {
    vi.useFakeTimers()
    const start = Date.now()
    const service = new EngineerService()
    const speak = vi.fn()
    const state = emptyRaceState()
    Object.assign(state.session, { sessionUID: 'test', trackId: 29, trackLengthM: 5000, sessionType: 5 })
    Object.assign(state.player, { carIndex: 0, onTrack: true, pitStatus: 0, lapPhase: 'out', lap: 2 })
    state.rivals[1] = { carIndex: 1, name: 'Fast car', status: 'running', pitStatus: 0,
      lapPhase: 'flying', currentLapInvalid: false, lap: 2, bestLapTimeS: 90 } as RivalState
    service.setStateProvider(() => state)
    service.setSpeakHandler(speak)
    for (let i = 0; i < 3; i++) {
      const now = start + i * 500
      vi.setSystemTime(now)
      state.lastPacketMs = now
      state.session.overallFrameIdentifier = i + 1
      Object.assign(state.player, { lapDataUpdatedAt: now, distanceFromStartM: 100 + i * 10 })
      Object.assign(state.rivals[1], { lapDataUpdatedAt: now, distanceFromStartM: 4800 + i * 50 })
      service.telemetryHistory.observe(state, now)
    }
    const firing: TriggerFiring = { ruleId: 'qualifying_yield_1', reasonCode: 'qualifying_yield',
      reason: '', priority: 'critical', kind: 'threshold', ts: Date.now() }
    service.acceptRadio('Fast car approaching; leave room safely.', firing)
    expect(speak).toHaveBeenCalledTimes(1)
    vi.setSystemTime(start + 1500)
    state.player.lapDataUpdatedAt = Date.now()
    state.rivals[1].lapDataUpdatedAt = Date.now()
    state.player.distanceFromStartM = 150
    state.rivals[1].distanceFromStartM = 4910
    state.session.overallFrameIdentifier++
    expect(() => service.acceptRadio('Repeat old warning', firing)).toThrow('fresh relative motion')
    expect(speak).toHaveBeenCalledTimes(1)
  })

  it('does not show automatic prose when the model makes no radio call', async () => {
    const state = emptyRaceState()
    const service = new EngineerService()
    const firing: TriggerFiring = { ruleId: 'heartbeat', reasonCode: 'heartbeat', reason: '',
      priority: 'low', kind: 'heartbeat', ts: Date.now() }
    vi.mocked(Sender.send).mockClear()
    service.setBackend({ generate: async (_text, _firing, onDelta) => {
      onDelta('Warm the tyres and keep it clean.')
      return 'Warm the tyres and keep it clean.'
    } })
    await service.advise(state, firing)
    expect(vi.mocked(Sender.send).mock.calls.some(([channel]) =>
      channel === 'engineer:text' || channel === 'engineer:advice')).toBe(false)
  })
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
