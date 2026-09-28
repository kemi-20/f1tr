import { describe, expect, it } from 'vitest'
import { emptyRaceState } from '../state/defaults'
import { StrategyObservations } from './StrategyObservations'
import type { RivalState } from '@shared/types/state'

function sample(pit = 0, loss = 0, time = 1000) {
  const s = emptyRaceState()
  s.lastPacketMs = time
  s.session.sessionUID = 'one'
  s.session.overallFrameIdentifier = time
  s.session.trackLengthM = 5000
  s.session.trackFlag = 'green'
  s.player.carIndex = 0
  s.player.lap = 3
  s.player.lapDistancePct = 0.98
  s.player.pitStatus = pit
  for (const id of [1, 2]) {
    s.rivals[id] = {
      carIndex: id, position: id + 1, lap: 3, lapDistancePct: id === 1 ? 0.02 : 0.94,
      gapToPlayerS: -5 * id + loss, pitStopCount: 0, pitStatus: 0, status: 'running'
    } as RivalState
  }
  return s
}

describe('StrategyObservations', () => {
  it('uses wrapped physical distance, independent of race order and lap count', () => {
    const s = sample()
    // Same lap, just over the line: physically 200m AHEAD of the player.
    s.rivals[1].lapDistancePct = 0.02
    s.rivals[1].name = 'A. Rival'
    // Rival 2 is 200m behind, on the same lap.
    s.rivals[2].lapDistancePct = 0.94
    s.rivals[2].name = 'B. Other'
    const report = new StrategyObservations().report(s).join('\n')
    expect(report).toContain('Physical traffic ahead: A. RIVAL P2, 200m ahead on track')
    expect(report).toContain('Physical traffic behind:')
    expect(report).toContain('200m behind on track')
    expect(report).toContain('NOT a time gap')
  })

  it.each(['GREEN', 'VSC', 'SC'] as const)('keeps %s gap-loss observations separate', regime => {
    const analysis = new StrategyObservations()
    for (const s of [sample(), sample(1, 0, 2000), sample(0, 18, 3000)]) {
      s.session.isSafetyCar = regime === 'SC'
      s.session.isVirtualSafetyCar = regime === 'VSC'
      analysis.observe(s, s.lastPacketMs)
    }
    const report = analysis.report(sample()).join('\n')
    expect(report).toContain(`${regime} stop observation L3: relative gap loss 18.00-18.00s`)
    expect(report).toContain('NOT calibrated net pit loss')
    for (const other of ['GREEN', 'VSC', 'SC'].filter(x => x !== regime)) {
      expect(report).toContain(`${other} pit-loss observation: unavailable`)
    }
  })

  it.each(['flag', 'pit', 'gap', 'lap', 'stale', 'flashback', 'session', 'frame'])(
    'rejects non-comparable %s changes', reason => {
      const analysis = new StrategyObservations()
      analysis.observe(sample(), 1000)
      analysis.observe(sample(1, 0, 2000), 2000)
      const end = sample(0, 18, 3000)
      if (reason === 'flag') end.session.isSafetyCar = true
      if (reason === 'pit') end.rivals[1].pitStopCount = 1
      if (reason === 'gap') end.rivals[1].gapToPlayerS = Number.NaN
      if (reason === 'lap') end.rivals[1].lap = 4
      if (reason === 'stale') end.lastPacketMs = 0
      if (reason === 'flashback') end.flashbackActive = true
      if (reason === 'session') end.session.sessionUID = 'new'
      if (reason === 'frame') end.session.overallFrameIdentifier = 1
      analysis.observe(end, 3000)
      expect(analysis.report(end).join('\n')).not.toContain('stop observation L')
    }
  )

  it('does not treat missing or invalid positions as physical traffic', () => {
    const s = sample()
    s.rivals[1].lapDistancePct = Number.NaN
    s.rivals[2].pitStatus = 1
    expect(new StrategyObservations().report(s).join('\n')).not.toContain('Physical traffic')
  })
})
