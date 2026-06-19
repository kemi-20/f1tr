import type { Priority } from './audio'

export type TriggerKind = 'event' | 'threshold' | 'heartbeat'

export interface TriggerFiring {
  ruleId: string
  kind: TriggerKind
  priority: Priority
  reasonCode: string // machine token e.g. 'tyre_wear_70'
  reason: string // human text for the digest
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  contextHint?: Record<string, any>
  ts: number
}

export interface TriggerConfig {
  tyreWearLevels: number[] // [50, 70, 90]
  tyreHotC: number
  tyreColdC: number
  defendGapS: number
  defendClosingS: number
  attackGapS: number
  pitWindowLeadLaps: number
  lowFuelKg: number
  lowFuelLapMultiplier: number
  ersLowPct: number
  stintEndLapRatio: number
  positionChangeDelta: number
  damageWingThreshold: number
  damageSuspThreshold: number
  rainImminentPct: number
  heartbeatIntervalS: number
  globalMinGapS: number
  perRuleCooldownS: Record<string, number>
  suppressFirstLap: boolean
  suppressLastLapLowPriority: boolean
}
