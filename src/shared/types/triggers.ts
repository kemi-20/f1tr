import type { Priority } from './audio'

export type TriggerKind = 'event' | 'threshold' | 'heartbeat' | 'manual'

export interface TriggerFiring {
  ruleId: string
  kind: TriggerKind
  priority: Priority
  reasonCode: string // machine token e.g. 'tyre_wear_70'
  reason: string // human text for the digest
  ts: number
}

export interface TriggerConfig {
  tyreWearLevels: number[] // [50, 70, 90]
  tyreHotC: number
  tyreColdC: number
  defendGapS: number
  attackGapS: number
  lowFuelKg: number
  positionChangeDelta: number
  rainImminentPct: number
  heartbeatIntervalS: number
  globalMinGapS: number
  perRuleCooldownS: Record<string, number>
  suppressFirstLap: boolean
  suppressLastLapLowPriority: boolean
}
