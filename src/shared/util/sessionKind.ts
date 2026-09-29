import type { SessionState } from '../types/state'

export type SessionKind = 'practice' | 'qualifying' | 'race' | 'time-trial' | 'unknown'

/** F1 25 UDP session IDs; F1 26 follows the same sequence where observed. */
export function sessionKind(session: Pick<SessionState, 'sessionType' | 'sessionTypeLabel'>): SessionKind {
  const type = session.sessionType
  if (type >= 1 && type <= 4) return 'practice'
  if (type >= 5 && type <= 14) return 'qualifying'
  if (type >= 15 && type <= 17) return 'race'
  if (type === 18) return 'time-trial'
  const label = session.sessionTypeLabel.trim()
  if (/^(?:practice|p[123]|short p)$/i.test(label)) return 'practice'
  if (/^(?:qualifying|q[123]|short q|osq|sprint shootout|sq[123])$/i.test(label)) return 'qualifying'
  if (/^race(?: [23])?$/i.test(label)) return 'race'
  if (/^(?:tt|time trial)$/i.test(label)) return 'time-trial'
  return 'unknown'
}
