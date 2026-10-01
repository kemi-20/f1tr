import { useConfigStore, useRaceStore } from '../../store'
import { compoundLabel, tyreWearColor } from '@shared/index'
import type { RivalState, TyreCompound } from '@shared/types/state'
import { formatBestLapDelta, isQualifyingOrPracticeSession, rankRivalsByBestLap } from '@shared/util/qualifyingRanking'
import { teamColorForCar, teamMetaFor } from './teamMeta'

function Row({
  r,
  isPlayer,
  lapRank,
  lapDeltaS,
  useLapRanking,
  showName
}: {
  r: RivalState
  isPlayer: boolean
  lapRank: number | null
  lapDeltaS: number | null
  useLapRanking: boolean
  showName?: boolean
}): React.ReactElement {
  const mark = teamMetaFor(r.team) ?? { label: r.teamName || shortTeam(r.team), color: r.teamColor || '#E6EDF6' }
  const tyre = tyreCode(r.tyreCompound)
  const gap = useLapRanking ? formatBestLapDelta(lapDeltaS) : formatPlayerRelativeGap(r.gapToPlayerS)
  const tyreWear = formatTyreWear(r.tyreWearAvg)
  const retired = r.status === 'retired'
  const inPit = r.pitStatus === 1 || r.pitStatus === 2
  const displayPosition = useLapRanking ? lapRank : r.position
  const isLeader = useLapRanking ? lapRank === 1 : r.position === 1

  return (
    <div className={`broadcast-row ${isPlayer ? 'broadcast-row-player' : ''} ${retired ? 'broadcast-row-muted' : ''}`}>
      <div className={`broadcast-pos ${isLeader ? 'broadcast-pos-leader' : ''}`}>{displayPosition ?? '--'}</div>
      <div className="broadcast-team" style={{ color: teamColorForCar(r.team, r.teamColor) }} title={mark.label}>
        {mark.logo ? <img src={mark.logo} alt={mark.label} /> : <span>{shortTeam(mark.label)}</span>}
      </div>
      <div className="broadcast-code" title={r.name || driverCode(r)}>{showName ? r.name || r.driverCode || driverCode(r) : r.driverCode || driverCode(r)}</div>
      <div className="broadcast-wear" style={{ color: tyreWear.color }} title={tyreWear.title}>{tyreWear.text}</div>
      <div className="broadcast-gap">{!useLapRanking && inPit ? 'PIT' : gap}</div>
      <div className={`broadcast-tyre tyre-${tyre.toLowerCase()}`}>{tyre}</div>
      {r.penaltiesS > 0 && <div className="broadcast-penalty">{r.penaltiesS}s</div>}
    </div>
  )
}

export function RivalsPanel(): React.ReactElement {
  const race = useRaceStore((s) => s.race)
  const pitwall = useConfigStore((s) => s.config?.ui.style === 'pitwall')
  const rivals = race ? Object.values(race.rivals) : []
  const playerIdx = race?.player.carIndex ?? -1
  const maxRows = race?.packetFormat === 2026 ? 24 : 22
  const useLapRanking = race != null && isQualifyingOrPracticeSession(
    race.session.sessionType,
    race.session.sessionTypeLabel
  )
  const positionedRivals = rivals.filter((r) => r.position > 0)
  const sorted = positionedRivals
    .sort((a, b) => a.position - b.position || a.carIndex - b.carIndex)
    .slice(0, maxRows)
  const lapRanked = useLapRanking && race
    ? rankRivalsByBestLap(positionedRivals, playerIdx, race.player.bestLapTimeS).slice(0, maxRows)
    : null
  const rows = lapRanked ?? sorted.map((r) => ({ rival: r, rank: r.position, deltaS: null }))
  const playerRow = rows.find(({ rival }) => rival.carIndex === playerIdx)

  return (
    <aside className="broadcast-tower h-full">
      {pitwall && <>
        <header className="pitwall-section-heading"><h2>LIVE TIMING</h2><span>{useLapRanking ? 'BEST LAP Δ' : 'RACE GAP Δ'}</span></header>
        <div className="timing-columns" aria-hidden="true"><span>POS</span><span /><span>DRIVER</span><span>WEAR</span><span>GAP</span><span>TYRE</span></div>
      </>}
      <div className="broadcast-body">
        {rows.length === 0 && <div className="broadcast-empty">等待车手数据</div>}
        {rows.map(({ rival: r, rank, deltaS }) => (
          <Row
            key={r.carIndex}
            r={r}
            isPlayer={r.carIndex === playerIdx}
            lapRank={rank}
            lapDeltaS={deltaS}
            useLapRanking={useLapRanking}
            showName={pitwall}
          />
        ))}
      </div>
      {pitwall && <footer className="timing-player">
        <span className="label">YOUR CAR</span>
        {playerRow ? <Row r={playerRow.rival} isPlayer lapRank={playerRow.rank} lapDeltaS={playerRow.deltaS} useLapRanking={useLapRanking} showName /> : <span className="timing-player-empty">等待玩家数据</span>}
      </footer>}
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
