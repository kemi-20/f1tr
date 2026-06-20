/**
 * Canonical RaceState — the full-resolution live race picture, held in main process only.
 * A lossy projection (Digest) is what actually crosses to the LLM.
 */

export type PacketFormat = 2025 | 2026

export type TyreCompound = 'soft' | 'medium' | 'hard' | 'inter' | 'wet' | 'unknown'

/** Wheel array order is ALWAYS [RL, RR, FL, FR] per the F1 spec. */
export interface Corners {
  rl: number
  rr: number
  fl: number
  fr: number
}

export interface TyreState {
  compound: TyreCompound
  rawCompoundId: number // raw m_actualTyreCompound value (16=C5, 17=C4, etc.) for C-name display
  ageLaps: number
  wear: Corners // 0..100 from CarDamage m_tyresWear
  blisters: Corners // 0..100, F1 25 m_tyreBlisters
  surfaceTempC: Corners // CarTelemetry m_tyresSurfaceTemperature
  innerTempC: Corners // CarTelemetry m_tyresInnerTemperature
  brakeTempC: Corners // CarTelemetry m_brakesTemperature
}

export interface DamageState {
  frontLeftWing: number // 0..1 (from m_frontLeftWingDamage, 0-100)
  frontRightWing: number // 0..1 (from m_frontRightWingDamage, 0-100)
  rearWing: number
  floor: number
  sidepodL: number
  sidepodR: number
}

export interface PowerUnitState {
  engine: number // remaining life 0..1
  gearbox: number
  es: number // energy store
  ce: number // control electronics
  turbo: number // TC
  mguh: number // MGU-H
  exhaust: number
}

export interface SetupState {
  // CarSetups packet (ID 5) — player's tuning, mostly static per session
  frontWing: number
  rearWing: number
  onThrottleDiff: number
  offThrottleDiff: number
  camberFL: number
  camberFR: number
  camberRL: number
  camberRR: number
  antiRollFront: number
  antiRollRear: number
  brakePressure: number
  brakeBias: number
  frontTyrePressure: number
  rearTyrePressure: number
  ballast: number
  fuelLoad: number
}

export interface PlayerCarState {
  carIndex: number
  position: number
  lap: number
  lapDistancePct: number
  onTrack: boolean
  currentLapTimeS: number | null
  lastLapTimeS: number | null
  bestLapTimeS: number | null
  sectors: (number | null)[]
  sectorSplitDelta: (number | null)[] // vs best
  speedKmh: number
  gear: number
  rpm: number
  ersPercent: number // 0..1 deployment store
  drsActive: boolean
  drsAllowed: boolean
  throttle: number
  brake: number
  revLightsPercent: number
  fuelRemainingKg: number | null
  fuelMix: 0 | 1 | 2 | 3
  fuelTargetDeltaS: number | null
  pitStatus: number
  pitTimerS: number | null
  pitStopCount: number
  penaltiesS: number
  tyres: TyreState
  damage: DamageState
  powerUnit: PowerUnitState
  setup: SetupState | null
}

export interface RivalState {
  carIndex: number
  name: string
  team: string
  raceNumber: number
  carClass: number
  position: number
  gridPosition: number
  lap: number
  lapDistancePct: number
  bestLapTimeS: number | null
  lastLapTimeS: number | null
  currentLapTimeS: number | null
  deltaToCarInFrontS: number | null
  deltaToCarBehindS: number | null
  gapToPlayerS: number | null // derived sign: + = ahead by that much
  pitStopCount: number
  pitStatus: number
  penaltiesS: number
  tyreCompound: TyreCompound
  resultStatus: number
  status: 'running' | 'retired' | 'finished' | 'inGarage' | 'unknown'
  relationToPlayer: 'ahead' | 'behind' | 'leader' | 'lapped' | 'lapping' | 'same'
}

export interface WeatherState {
  airTempC: number
  trackTempC: number
  rainPercentage: number
  wetness: number
  predictedWetness: number
  weatherCode: number
  predictedCode: number
  isRaining: boolean
  rainOnset: boolean // rising-edge flag for current tick
}

export interface SessionState {
  sessionType: number
  sessionTypeLabel: string
  trackId: number
  trackName: string
  totalLaps: number | null
  currentLap: number
  sessionTimeLeftS: number | null
  sessionDurationS: number | null
  safetyCarPhase: number
  isSafetyCar: boolean
  isVirtualSafetyCar: boolean
  isRedFlag: boolean
  pitSpeedLimitKmh: number
  trackLengthM: number
  gameYear: number
  packetFormat: PacketFormat
  sessionUID: string
  overallFrameIdentifier: number
  lastUpdateMs: number
}

export interface RecentEvent {
  id: string
  ts: number
  type:
    | 'fastestLap'
    | 'retirement'
    | 'sessionEnded'
    | 'penalty'
    | 'raceWinner'
    | 'safetyCar'
    | 'vsc'
    | 'redFlag'
    | 'weatherChange'
    | 'pitEntered'
    | 'pitExited'
    | 'collision'
    | 'damage'
    | 'overtake'
    | 'spin'
  carIndex?: number
  text: string
}

export interface TrackPosition {
  carIndex: number
  lapDistancePct: number
  speedKmh: number
  isPlayer: boolean
  worldX?: number
  worldY?: number
  worldZ?: number
}

export interface RaceState {
  session: SessionState
  weather: WeatherState
  player: PlayerCarState
  rivals: Record<number, RivalState>
  trackPositions: TrackPosition[]
  recentEvents: RecentEvent[] // ring buffer, last ~12
  packetFormat: PacketFormat
  lastPacketMs: number
  packetsReceived: number
  packetsDropped: number
  flashbackActive: boolean
}
