import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyRaceState } from '../state/defaults'
import { DigestBuilder } from './DigestBuilder'

const firing = {
  ruleId: 'manual',
  kind: 'manual' as const,
  priority: 'normal' as const,
  reasonCode: 'manual',
  reason: 'Driver asked a question',
  ts: 0
}

describe('DigestBuilder event freshness', () => {
  afterEach(() => vi.useRealTimers())

  it('includes recent events and excludes stale or future-dated events', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-28T12:00:00.000Z'))
    const state = emptyRaceState()
    const now = Date.now()
    state.recentEvents = [
      { id: 'old', ts: now - 120_001, type: 'safetyCar', text: 'Old safety car deployment' },
      { id: 'fresh', ts: now - 30_000, type: 'penalty', text: 'Current penalty' },
      { id: 'future', ts: now + 1, type: 'collision', text: 'Future event' }
    ]

    const digest = new DigestBuilder().build(state, firing)

    expect(digest.events).toEqual(['[penalty] Current penalty'])
  })
})
