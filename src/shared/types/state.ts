/**
 * Canonical RaceState — the full-resolution live race picture, held in main process only.
 * A lossy projection (Digest) is what actually crosses to the LLM.
 */

export type PacketFormat = 2025 | 2026
export type LapPhase = 'garage' | 'out' | 'flying' | 'cooling' | 'in' | 'unknown'

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
  /** Raw m_lapDistance in metres. The engineer's sector/zone reasoning is anchored here. */
  distanceFromStartM: number | null
  /** Raw m_totalDistance in metres: cumulative laps + distance, the only lap-aware position. */
  totalDistanceM: number | null
  currentSector: number // m_sector from LapData: 0=sector1, 1=sector2, 2=sector3
  onTrack: boolean
  currentLapTimeS: number | null
  currentLapInvalid?: boolean
  driverStatus?: number
  lapPhase?: LapPhase
  lapPhaseEvidence?: string
  lapDataUpdatedAt?: number
  lastLapTimeS: number | null
  bestLapTimeS: number | null
  speedKmh: number
  gear: number
  rpm: number
  engineTempC: number
  ersPercent: number // 0..1 deployment store
  drsActive: boolean
  drsAllowed: boolean
  regulations2026: boolean
  activeAeroMode: 'corner' | 'straight' | null
  activeAeroAvailable: boolean
  activeAeroActivationDistanceM: number
  overtakeAvailable: boolean
  overtakeActive: boolean
  overtakeActivationDistanceM: number
  throttle: number
  brake: number
  revLightsPercent: number
  fuelRemainingKg: number | null
  fuelRemainingLaps: number | null // raw MFD value: signed surplus/deficit to finish in race sessions
  fuelMix: 0 | 1 | 2 | 3
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
  driverStatus?: number
  currentLapInvalid?: boolean
  lapPhase?: LapPhase
  lapPhaseEvidence?: string
  lapDataUpdatedAt?: number
  carIndex: number
  driverId?: number
  driverCode?: string
  name: string
  team: string
  teamName?: string
  teamColor?: string
  raceNumber: number
  carClass: number
  position: number
  gridPosition: number
  lap: number
  lapDistancePct: number
  /** Raw m_lapDistance in metres. */
  distanceFromStartM: number | null
  /** Raw m_totalDistance in metres: cumulative laps + distance, the only lap-aware position. */
  totalDistanceM: number | null
  /** Signed cumulative race-distance difference; >0 means further into the race, not necessarily physically ahead. */
  separationFromPlayerM: number | null
  /** Signed shortest distance on the circuit; >0 means physically ahead, independent of laps completed. */
  trackRelativeSeparationM: number | null
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
  tyreWearAvg: number | null // 0..100 average from CarDamage m_tyresWear
  resultStatus: number
  status: 'running' | 'retired' | 'finished' | 'inGarage' | 'unknown'
  relationToPlayer: 'ahead' | 'behind' | 'same'
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
  trackFlag: 'none' | 'green' | 'blue' | 'yellow' | 'red'
  activeFlagZones: number
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
    | 'yellowFlag'
    | 'blueFlag'
    | 'greenFlag'
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
