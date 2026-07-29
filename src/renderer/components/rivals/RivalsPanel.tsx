import { useRaceStore } from '../../store'
import { compoundLabel } from '@shared/index'
import type { RivalState, TyreCompound } from '@shared/types/state'
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

function Row({ r, isPlayer }: { r: RivalState; isPlayer: boolean }): React.ReactElement {
  const mark = TEAM_MARKS[String(r.team)] ?? { label: shortTeam(r.team), color: '#E6EDF6' }
  const tyre = tyreCode(r.tyreCompound)
  const gap = formatPlayerRelativeGap(r.gapToPlayerS)
  const tyreWear = formatTyreWear(r.tyreWearAvg)
  const retired = r.status === 'retired'
  const inPit = r.pitStatus === 1 || r.pitStatus === 2

  return (
    <div className={`broadcast-row ${isPlayer ? 'broadcast-row-player' : ''} ${retired ? 'broadcast-row-muted' : ''}`}>
      <div className={`broadcast-pos ${r.position === 1 ? 'broadcast-pos-leader' : ''}`}>{r.position}</div>
      <div className="broadcast-team" style={{ color: mark.color }} title={mark.label}>
        {mark.logo ? <img src={mark.logo} alt={mark.label} /> : <span>{shortTeam(r.team)}</span>}
      </div>
      <div className="broadcast-code" title={r.name || driverCode(r)}>{driverCode(r)}</div>
      <div className="broadcast-wear" style={{ color: tyreWear.color }} title={tyreWear.title}>{tyreWear.text}</div>
      <div className="broadcast-gap">{inPit ? 'PIT' : gap}</div>
      <div className={`broadcast-tyre tyre-${tyre.toLowerCase()}`}>{tyre}</div>
      {r.penaltiesS > 0 && <div className="broadcast-penalty">{r.penaltiesS}s</div>}
    </div>
  )
}

export function RivalsPanel(): React.ReactElement {
  const race = useRaceStore((s) => s.race)
  const rivals = race ? Object.values(race.rivals) : []
  const playerIdx = race?.player.carIndex ?? -1
  const sorted = rivals
    .filter((r) => r.position > 0)
    .sort((a, b) => a.position - b.position || a.carIndex - b.carIndex)
    .slice(0, race?.packetFormat === 2026 ? 24 : 22)

  return (
    <aside className="broadcast-tower h-full">
      <div className="broadcast-header">
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
          <Row key={r.carIndex} r={r} isPlayer={r.carIndex === playerIdx} />
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

function formatPlayerRelativeGap(gapToPlayerS: number | null): string {
  if (gapToPlayerS == null || !isFinite(gapToPlayerS)) return '--'
  const display = -gapToPlayerS
  const abs = Math.abs(display)
  const sign = display > 0 ? '+' : display < 0 ? '-' : ''
  return `${sign}${abs.toFixed(2)}`
}

function formatTyreWear(wear: number | null): { text: string; color: string; title: string } {
  if (wear == null || !isFinite(wear)) return { text: '--', color: 'rgba(255, 255, 255, 0.34)', title: 'Tyre wear unknown' }
  const rounded = Math.round(Math.max(0, Math.min(100, wear)))
  return { text: `${rounded}%`, color: tyreWearColor(rounded), title: `Tyre wear ${rounded}%` }
}

function tyreWearColor(wear: number): string {
  if (wear >= 90) return '#B000F7'
  if (wear >= 75) return '#E10600'
  if (wear >= 55) return '#FF7A00'
  if (wear >= 35) return '#F7D210'
  return '#49D66A'
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
