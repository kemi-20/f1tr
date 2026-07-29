import { useRaceStore } from '../../store'
import { compoundLabel, fmtGap, fmtLapTime } from '@shared/index'
import type { RaceState, RivalState, TyreCompound } from '@shared/types/state'
import f1Logo from '../../assets/team-logos/F1_Logo.png'
import mercedesLogo from '../../assets/team-logos/Mercedes_Logo.png'
import ferrariLogo from '../../assets/team-logos/Ferrari_Logo.png'
import redBullLogo from '../../assets/team-logos/Red_Bull_Logo.png'
import williamsLogo from '../../assets/team-logos/Williams_Logo.png'
import astonMartinLogo from '../../assets/team-logos/Aston_Martin_Logo.png'
import alpineLogo from '../../assets/team-logos/Alpine_Logo.png'
import rbLogo from '../../assets/team-logos/RB_Logo.png'
import haasLogo from '../../assets/team-logos/Haas_Logo.png'
import mclarenLogo from '../../assets/team-logos/McLaren_Logo.png'
import kickLogo from '../../assets/team-logos/Kick_Logo.png'

const TEAM_MARKS: Record<string, { label: string; color: string; logo?: string }> = {
  '0': { label: 'Mercedes', color: '#00D2BE', logo: mercedesLogo },
  '1': { label: 'Ferrari', color: '#DC0000', logo: ferrariLogo },
  '2': { label: 'Red Bull', color: '#3671C6', logo: redBullLogo },
  '3': { label: 'Williams', color: '#64C4FF', logo: williamsLogo },
  '4': { label: 'Aston Martin', color: '#229971', logo: astonMartinLogo },
  '5': { label: 'Alpine', color: '#0090FF', logo: alpineLogo },
  '6': { label: 'Racing Bulls', color: '#6692FF', logo: rbLogo },
  '7': { label: 'Haas', color: '#FFFFFF', logo: haasLogo },
  '8': { label: 'McLaren', color: '#FF8000', logo: mclarenLogo },
  '9': { label: 'Kick Sauber', color: '#B6BABD', logo: kickLogo },
  '129': { label: 'Mercedes', color: '#00D2BE', logo: mercedesLogo },
  '185': { label: 'Mercedes', color: '#00D2BE', logo: mercedesLogo },
  '186': { label: 'Ferrari', color: '#DC0000', logo: ferrariLogo },
  '187': { label: 'Red Bull', color: '#3671C6', logo: redBullLogo },
  '188': { label: 'Williams', color: '#64C4FF', logo: williamsLogo },
  '189': { label: 'Aston Martin', color: '#229971', logo: astonMartinLogo },
  '190': { label: 'Alpine', color: '#0090FF', logo: alpineLogo },
  '191': { label: 'Racing Bulls', color: '#6692FF', logo: rbLogo },
  '192': { label: 'Haas', color: '#FFFFFF', logo: haasLogo },
  '193': { label: 'McLaren', color: '#FF8000', logo: mclarenLogo },
  '194': { label: 'Kick Sauber', color: '#B6BABD', logo: kickLogo }
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
      <div className="broadcast-team" style={{ color: mark.color }} title={mark.label}>
        {mark.logo ? <img src={mark.logo} alt={mark.label} /> : <span>{shortTeam(r.team)}</span>}
      </div>
      <div className="broadcast-code" title={r.name || driverCode(r)}>{driverCode(r)}</div>
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
        <img className="broadcast-f1-logo" src={f1Logo} alt="Formula 1" />
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
  const mapped = DRIVER_CODES[r.raceNumber]
  if (mapped) return mapped
  return r.raceNumber ? `#${r.raceNumber}` : '---'
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

const DRIVER_CODES: Record<number, string> = {
  1: 'VER',
  4: 'NOR',
  5: 'BOR',
  6: 'HAD',
  10: 'GAS',
  12: 'ANT',
  14: 'ALO',
  16: 'LEC',
  18: 'STR',
  22: 'TSU',
  23: 'ALB',
  27: 'HUL',
  30: 'LAW',
  31: 'OCO',
  33: 'VER',
  43: 'COL',
  44: 'HAM',
  55: 'SAI',
  63: 'RUS',
  81: 'PIA',
  87: 'BEA'
}
