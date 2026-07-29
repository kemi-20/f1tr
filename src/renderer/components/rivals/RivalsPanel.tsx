import { useRaceStore } from '../../store'
import { compoundLabel, fmtGap, fmtLapTime } from '@shared/index'
import type { RaceState, RivalState, TyreCompound } from '@shared/types/state'

const TEAM_MARKS: Record<string, { label: string; color: string }> = {
  '0': { label: 'M', color: '#00D2BE' },
  '1': { label: 'F', color: '#DC0000' },
  '2': { label: 'R', color: '#3671C6' },
  '3': { label: 'W', color: '#64C4FF' },
  '4': { label: 'A', color: '#229971' },
  '5': { label: 'A', color: '#0090FF' },
  '6': { label: 'RB', color: '#6692FF' },
  '7': { label: 'H', color: '#FFFFFF' },
  '8': { label: 'M', color: '#FF8000' },
  '9': { label: 'K', color: '#B6BABD' },
  '129': { label: 'M', color: '#00D2BE' },
  '185': { label: 'M', color: '#00D2BE' },
  '186': { label: 'F', color: '#DC0000' },
  '187': { label: 'R', color: '#3671C6' },
  '188': { label: 'W', color: '#64C4FF' },
  '189': { label: 'A', color: '#229971' },
  '190': { label: 'A', color: '#0090FF' },
  '191': { label: 'RB', color: '#6692FF' },
  '192': { label: 'H', color: '#FFFFFF' },
  '193': { label: 'M', color: '#FF8000' },
  '194': { label: 'K', color: '#B6BABD' }
}

function Row({ r, isPlayer, timingMode }: { r: RivalState; isPlayer: boolean; timingMode: boolean }): React.ReactElement {
  const mark = TEAM_MARKS[String(r.team)] ?? { label: shortTeam(r.team), color: '#E6EDF6' }
  const tyre = tyreCode(r.tyreCompound)
  const center = timingMode
    ? r.bestLapTimeS
      ? fmtLapTime(r.bestLapTimeS * 1000)
      : '--'
    : r.position === 1
      ? 'Leader'
      : r.deltaToCarInFrontS != null
        ? `+${r.deltaToCarInFrontS.toFixed(1)}`
        : r.gapToPlayerS != null
          ? fmtGap(Math.abs(r.gapToPlayerS))
          : '--'
  const retired = r.status === 'retired'
  const inPit = r.pitStatus === 1 || r.pitStatus === 2

  return (
    <div className={`broadcast-row ${isPlayer ? 'broadcast-row-player' : ''} ${retired ? 'broadcast-row-muted' : ''}`}>
      <div className={`broadcast-pos ${r.position === 1 ? 'broadcast-pos-leader' : ''}`}>{r.position}</div>
      <div className="broadcast-team" style={{ color: mark.color }}>
        {mark.label}
      </div>
      <div className="broadcast-code">{driverCode(r)}</div>
      <div className="broadcast-gap">{inPit ? 'PIT' : center}</div>
      <div className={`broadcast-tyre tyre-${tyre.toLowerCase()}`}>{tyre}</div>
      {r.penaltiesS > 0 && <div className="broadcast-penalty">{r.penaltiesS}s</div>}
    </div>
  )
}

export function RivalsPanel(): React.ReactElement {
  const race = useRaceStore((s) => s.race)
  const rivals = race ? Object.values(race.rivals) : []
  const playerIdx = race?.player.carIndex ?? -1
  const timingMode = race ? isTimingSession(race) : false
  const sorted = rivals
    .filter((r) => r.position > 0)
    .sort((a, b) => a.position - b.position || a.carIndex - b.carIndex)
    .slice(0, race?.packetFormat === 2026 ? 24 : 22)

  return (
    <aside className="broadcast-tower h-full">
      <div className="broadcast-header">
        <div className="broadcast-logo">F1</div>
        <div className="broadcast-subtitle">FIA Formula 1 World Championship</div>
        <div className="broadcast-divider" />
        <div className="broadcast-lap">
          <span>LAP</span>
          <strong>{race?.session.currentLap ?? 0}</strong>
          <span>/</span>
          <span>{race?.session.totalLaps ?? '--'}</span>
        </div>
      </div>

      <div className="broadcast-body">
        {sorted.length === 0 && <div className="broadcast-empty">等待车手数据</div>}
        {sorted.map((r) => (
          <Row key={r.carIndex} r={r} isPlayer={r.carIndex === playerIdx} timingMode={timingMode} />
        ))}
      </div>
    </aside>
  )
}

function driverCode(r: RivalState): string {
  const letters = (r.name || '').replace(/[^A-Za-z]/g, '').toUpperCase()
  if (letters.length >= 3) return letters.slice(0, 3)
  return r.raceNumber ? String(r.raceNumber).padStart(2, '0') : '---'
}

function shortTeam(team: string): string {
  const clean = String(team || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  return clean.slice(0, 2) || '-'
}

function tyreCode(compound: TyreCompound): string {
  const label = compoundLabel(compound)
  return label === '?' ? '' : label
}

function isTimingSession(race: RaceState): boolean {
  const { sessionType, sessionTypeLabel } = race.session
  return [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12].includes(sessionType) || /practice|qual|^p[123]$|^q[123]$|^osq$/i.test(sessionTypeLabel)
}
