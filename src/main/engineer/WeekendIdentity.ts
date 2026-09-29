import type { RaceState } from '@shared/types/state'

export interface WeekendIdentitySnapshot {
  weekendKey: string
  sessionKey: string
  sessionUid: string
  seasonLinkIdentifier: number | null
  weekendLinkIdentifier: number | null
  sessionLinkIdentifier: number | null
  trackId: number | null
  gameMode: number | null
  playerCarIndex: number | null
  gameYear: number | null
  packetFormat: number | null
  sessionType: number
  phase: number
  source: 'f1-links' | 'inferred'
}

export interface WeekendIdentityTransition extends WeekendIdentitySnapshot {
  newWeekend: boolean
  newSession: boolean
  duplicate: boolean
  restart: boolean
  reason: 'initial' | 'same-session' | 'session-change' | 'restart' | 'weekend-change' | 'duplicate'
}

interface Candidate {
  sessionUid: string
  seasonLinkIdentifier: number | null
  weekendLinkIdentifier: number | null
  sessionLinkIdentifier: number | null
  trackId: number | null
  gameMode: number | null
  playerCarIndex: number | null
  gameYear: number | null
  packetFormat: number | null
  sessionType: number
  phase: number
  frame: number | null
}

const MAX_SEEN_SESSIONS = 64

/** Owns the in-memory identity boundary for one F1 race weekend. */
export class WeekendIdentity {
  private active: WeekendIdentitySnapshot | null = null
  private readonly seenSessionUids = new Set<string>()
  private inferredWeekendSequence = 0
  private sessionSequence = 0
  private lastSeenAt = 0
  private lastFrame: number | null = null

  observePacket(packet: Record<string, unknown>, now: number): WeekendIdentityTransition | null {
    const candidate = packetCandidate(packet)
    return candidate ? this.observe(candidate, now, true) : null
  }

  observeState(state: RaceState, now: number): WeekendIdentityTransition {
    const candidate = stateCandidate(state, this.active)
    return this.observe(candidate, now, false)
  }

  /** Starts a new sample epoch after a sustained frame rollback, without losing the weekend. */
  restartState(state: RaceState, now: number): WeekendIdentityTransition {
    const candidate = stateCandidate(state, this.active)
    if (!this.active) return this.observe(candidate, now, false)
    this.sessionSequence++
    const sessionKey = `${this.active.weekendKey}:session:${candidate.sessionLinkIdentifier ?? candidate.sessionType}:${candidate.sessionUid || 'unknown'}:restart-${this.sessionSequence}`
    this.active = { ...this.active, sessionKey, sessionUid: candidate.sessionUid,
      sessionLinkIdentifier: candidate.sessionLinkIdentifier ?? this.active.sessionLinkIdentifier,
      sessionType: candidate.sessionType, phase: candidate.phase }
    this.lastSeenAt = now
    this.lastFrame = candidate.frame
    return { ...this.active, newWeekend: false, newSession: true, duplicate: false,
      restart: true, reason: 'restart' }
  }

  current(): WeekendIdentitySnapshot | null {
    return this.active ? { ...this.active } : null
  }

  isInactiveKnownSession(sessionUid: string): boolean {
    return !!sessionUid && sessionUid !== this.active?.sessionUid && this.seenSessionUids.has(sessionUid)
  }

  reset(): void {
    this.active = null
    this.seenSessionUids.clear()
    this.inferredWeekendSequence = 0
    this.sessionSequence = 0
    this.lastSeenAt = 0
    this.lastFrame = null
  }

  private observe(candidate: Candidate, now: number, packetSource: boolean): WeekendIdentityTransition {
    const active = this.active
    if (active && candidate.sessionUid && candidate.sessionUid !== active.sessionUid &&
      this.seenSessionUids.has(candidate.sessionUid)) {
      return { ...active, newWeekend: false, newSession: false, duplicate: true,
        restart: false, reason: 'duplicate' }
    }

    if (!active) {
      const weekendKey = explicitWeekendKey(candidate) ?? this.newInferredWeekendKey(candidate)
      const snapshot = this.makeSnapshot(candidate, weekendKey)
      this.active = snapshot
      this.noteCandidate(candidate, now)
      return { ...snapshot, newWeekend: true, newSession: true, duplicate: false,
        restart: false, reason: 'initial' }
    }

    const contextChanged = !compatibleContext(active, candidate)
    const identifiersChanged = explicitWeekendChanged(active, candidate)
    const uidChanged = !!candidate.sessionUid && candidate.sessionUid !== active.sessionUid
    const newWeekend = contextChanged || identifiersChanged ||
      (!hasExplicitWeekend(active) && !hasExplicitWeekend(candidate) &&
        shouldInferNewWeekend(active, candidate, Math.max(0, now - this.lastSeenAt), uidChanged))

    if (newWeekend) {
      const weekendKey = explicitWeekendKey(candidate) ?? this.newInferredWeekendKey(candidate)
      const snapshot = this.makeSnapshot(candidate, weekendKey)
      this.active = snapshot
      this.seenSessionUids.clear()
      this.noteCandidate(candidate, now)
      return { ...snapshot, newWeekend: true, newSession: true, duplicate: false,
        restart: false, reason: 'weekend-change' }
    }

    const weekendKey = explicitWeekendKey(candidate) ?? active.weekendKey
    const linkSessionChanged = active.sessionLinkIdentifier !== null &&
      candidate.sessionLinkIdentifier !== null && active.sessionLinkIdentifier !== candidate.sessionLinkIdentifier
    const typeChanged = active.sessionType !== candidate.sessionType
    const newSession = uidChanged || linkSessionChanged || typeChanged
    const restart = newSession && (candidate.sessionType === active.sessionType ||
      (active.sessionLinkIdentifier !== null && candidate.sessionLinkIdentifier !== null && !linkSessionChanged))

    if (!newSession && packetSource && candidate.frame !== null && this.lastFrame !== null &&
      candidate.frame < this.lastFrame - 5) {
      return { ...active, newWeekend: false, newSession: false, duplicate: true,
        restart: false, reason: 'duplicate' }
    }

    const next = newSession
      ? this.makeSnapshot(candidate, weekendKey, active)
      : mergeSnapshot(active, candidate, weekendKey)
    this.active = next
    this.noteCandidate(candidate, now)
    return { ...next, newWeekend: false, newSession, duplicate: false, restart,
      reason: newSession ? (restart ? 'restart' : 'session-change') : 'same-session' }
  }

  private makeSnapshot(candidate: Candidate, weekendKey: string, previous?: WeekendIdentitySnapshot): WeekendIdentitySnapshot {
    this.sessionSequence++
    const hasCurrentLinks = explicitWeekendKey(candidate) !== null
    const source = hasCurrentLinks || previous?.source === 'f1-links' ? 'f1-links' : 'inferred'
    return {
      weekendKey,
      sessionKey: `${weekendKey}:session:${candidate.sessionLinkIdentifier ?? candidate.sessionType}:${candidate.sessionUid || 'unknown'}:${this.sessionSequence}`,
      sessionUid: candidate.sessionUid,
      seasonLinkIdentifier: candidate.seasonLinkIdentifier ?? previous?.seasonLinkIdentifier ?? null,
      weekendLinkIdentifier: candidate.weekendLinkIdentifier ?? previous?.weekendLinkIdentifier ?? null,
      sessionLinkIdentifier: candidate.sessionLinkIdentifier,
      trackId: candidate.trackId ?? previous?.trackId ?? null,
      gameMode: candidate.gameMode ?? previous?.gameMode ?? null,
      playerCarIndex: candidate.playerCarIndex ?? previous?.playerCarIndex ?? null,
      gameYear: candidate.gameYear ?? previous?.gameYear ?? null,
      packetFormat: candidate.packetFormat ?? previous?.packetFormat ?? null,
      sessionType: candidate.sessionType,
      phase: candidate.phase,
      source
    }
  }

  private newInferredWeekendKey(candidate: Candidate): string {
    this.inferredWeekendSequence++
    return `inferred:${candidate.gameYear ?? 'u'}:${candidate.packetFormat ?? 'u'}:${candidate.trackId ?? 'u'}:${candidate.gameMode ?? 'u'}:${candidate.playerCarIndex ?? 'u'}:${this.inferredWeekendSequence}`
  }

  private noteCandidate(candidate: Candidate, now: number): void {
    if (candidate.sessionUid) {
      this.seenSessionUids.add(candidate.sessionUid)
      while (this.seenSessionUids.size > MAX_SEEN_SESSIONS) {
        const oldest = this.seenSessionUids.values().next().value as string | undefined
        if (oldest === undefined) break
        this.seenSessionUids.delete(oldest)
      }
    }
    this.lastSeenAt = now
    if (candidate.frame !== null) this.lastFrame = candidate.frame
  }
}

function packetCandidate(packet: Record<string, unknown>): Candidate | null {
  const header = asRecord(packet.m_header)
  if (!header || !Number.isInteger(packet.m_sessionType) || !Number.isInteger(packet.m_trackId)) return null
  const sessionType = boundedInteger(packet.m_sessionType, 0, 255) ?? 0
  const sessionUid = safeUid(header.m_sessionUID)
  if (!sessionUid) return null
  const seasonLinkIdentifier = positiveLink(packet.m_seasonLinkIdentifier)
  const weekendLinkIdentifier = positiveLink(packet.m_weekendLinkIdentifier)
  return {
    sessionUid,
    seasonLinkIdentifier,
    weekendLinkIdentifier,
    sessionLinkIdentifier: positiveLink(packet.m_sessionLinkIdentifier),
    trackId: boundedInteger(packet.m_trackId, 0, 255),
    gameMode: boundedInteger(packet.m_gameMode, 0, 255),
    playerCarIndex: boundedInteger(header.m_playerCarIndex, 0, 23),
    gameYear: boundedInteger(header.m_gameYear, 1, 9999),
    packetFormat: boundedInteger(header.m_packetFormat, 0, 9999),
    sessionType,
    phase: sessionPhase(sessionType),
    frame: boundedInteger(header.m_overallFrameIdentifier, 0, 0xffffffff)
  }
}

function stateCandidate(state: RaceState, active: WeekendIdentitySnapshot | null): Candidate {
  const session = state.session
  const sessionUid = safeUid(session.sessionUID) ?? ''
  const sameUid = !!active && active.sessionUid === sessionUid
  const stateSessionType = boundedInteger(session.sessionType, 0, 255) ?? 0
  const sessionType = sameUid && stateSessionType === 0 && active.sessionType !== 0
    ? active.sessionType : stateSessionType
  return {
    sessionUid,
    seasonLinkIdentifier: sameUid ? active.seasonLinkIdentifier : null,
    weekendLinkIdentifier: sameUid ? active.weekendLinkIdentifier : null,
    sessionLinkIdentifier: sameUid ? active.sessionLinkIdentifier : null,
    trackId: boundedInteger(session.trackId, 0, 255),
    gameMode: sameUid ? active.gameMode : null,
    playerCarIndex: boundedInteger(state.player.carIndex, 0, 23),
    gameYear: boundedInteger(session.gameYear, 1, 9999),
    packetFormat: boundedInteger(session.packetFormat, 0, 9999),
    sessionType,
    phase: sessionPhase(sessionType),
    frame: boundedInteger(session.overallFrameIdentifier, 0, 0xffffffff)
  }
}

function mergeSnapshot(active: WeekendIdentitySnapshot, candidate: Candidate, weekendKey: string): WeekendIdentitySnapshot {
  const explicit = explicitWeekendKey(candidate) !== null
  return {
    weekendKey,
    sessionKey: active.sessionKey,
    sessionUid: candidate.sessionUid || active.sessionUid,
    seasonLinkIdentifier: candidate.seasonLinkIdentifier ?? active.seasonLinkIdentifier,
    weekendLinkIdentifier: candidate.weekendLinkIdentifier ?? active.weekendLinkIdentifier,
    sessionLinkIdentifier: candidate.sessionLinkIdentifier ?? active.sessionLinkIdentifier,
    trackId: candidate.trackId ?? active.trackId,
    gameMode: candidate.gameMode ?? active.gameMode,
    playerCarIndex: candidate.playerCarIndex ?? active.playerCarIndex,
    gameYear: candidate.gameYear ?? active.gameYear,
    packetFormat: candidate.packetFormat ?? active.packetFormat,
    sessionType: candidate.sessionType,
    phase: candidate.phase,
    source: explicit || active.source === 'f1-links' ? 'f1-links' : 'inferred'
  }
}

function explicitWeekendKey(candidate: Candidate): string | null {
  if (candidate.seasonLinkIdentifier === null || candidate.weekendLinkIdentifier === null) return null
  return `f1:${candidate.gameYear ?? 'u'}:${candidate.packetFormat ?? 'u'}:${candidate.seasonLinkIdentifier}:${candidate.weekendLinkIdentifier}:track-${candidate.trackId ?? 'u'}:mode-${candidate.gameMode ?? 'u'}:player-${candidate.playerCarIndex ?? 'u'}`
}

function hasExplicitWeekend(identity: { seasonLinkIdentifier: number | null; weekendLinkIdentifier: number | null }): boolean {
  return identity.seasonLinkIdentifier !== null && identity.weekendLinkIdentifier !== null
}

function explicitWeekendChanged(active: WeekendIdentitySnapshot, candidate: Candidate): boolean {
  if (!hasExplicitWeekend(active) || candidate.seasonLinkIdentifier === null || candidate.weekendLinkIdentifier === null) return false
  return active.seasonLinkIdentifier !== candidate.seasonLinkIdentifier ||
    active.weekendLinkIdentifier !== candidate.weekendLinkIdentifier
}

function compatibleContext(active: WeekendIdentitySnapshot, candidate: Candidate): boolean {
  return compatible(active.trackId, candidate.trackId) &&
    compatible(active.gameMode, candidate.gameMode) &&
    compatible(active.playerCarIndex, candidate.playerCarIndex) &&
    compatible(active.gameYear, candidate.gameYear) &&
    compatible(active.packetFormat, candidate.packetFormat)
}

function compatible(left: number | null, right: number | null): boolean {
  return left === null || right === null || left === right
}

function shouldInferNewWeekend(active: WeekendIdentitySnapshot, candidate: Candidate, gapMs: number, uidChanged: boolean): boolean {
  if (active.phase === 0 || candidate.phase === 0) return uidChanged || gapMs >= 12 * 60 * 60 * 1000
  if (candidate.phase >= active.phase) return false
  return gapMs >= 8 * 60 * 60 * 1000
}

function sessionPhase(sessionType: number): number {
  if (sessionType >= 1 && sessionType <= 4) return 1
  if (sessionType >= 5 && sessionType <= 14) return 2
  if (sessionType >= 15 && sessionType <= 17) return 3
  return 0
}

function positiveLink(value: unknown): number | null {
  const number = boundedInteger(value, 0, 0xffffffff)
  return number !== null && number > 0 ? number : null
}

function boundedInteger(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max
    ? value : null
}

function safeUid(value: unknown): string | null {
  if (typeof value === 'bigint') return value >= 0n ? value.toString() : null
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? String(value) : null
  if (typeof value === 'string' && value.length > 0 && value.length <= 64 && /^[A-Za-z0-9_-]+$/.test(value)) return value
  return null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null
}
