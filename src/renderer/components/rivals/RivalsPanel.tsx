import { useRaceStore } from '../../store'
import { fmtGap, fmtLapTime, compoundLabel } from '@shared/index'
import type { RaceState, RivalState } from '@shared/types/state'

function Row({
  r,
  isPlayer,
  timingMode,
  playerLap
}: {
  r: RivalState
  isPlayer: boolean
  timingMode: boolean
  playerLap: number
}): React.ReactElement {
  const tyreColor =
    { soft: '#FF3B3B', medium: '#FFB020', hard: '#E6EDF6', inter: '#22C55E', wet: '#3B82F6', unknown: '#666' }[r.tyreCompound] ?? '#666'
  const statusIcon =
    r.status === 'retired' ? 'DNF' : r.status === 'inGarage' ? 'IN' : r.status === 'finished' ? '🏁' : r.pitStatus === 2 ? 'PIT' : ''
  const lapDiff = r.lap - playerLap
  const lapDiffText = lapDiff > 0 ? `+${lapDiff}` : `${lapDiff}`
  const wearText = r.tyreWearAvg != null ? `${Math.round(r.tyreWearAvg)}%` : '--'

  return (
    <div
      className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-xs ${
        isPlayer ? 'bg-accent-carbon/[0.08] ring-1 ring-accent-carbon/40' : ''
      }`}
    >
      <span className="num-mono w-6 text-center font-bold text-white/70">{r.position}</span>
      <span className="w-20 truncate font-medium text-white/85">{r.name || '—'}</span>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: tyreColor }} title={r.tyreCompound} />
      <span className="w-5 text-center text-[10px] text-white/40">{compoundLabel(r.tyreCompound)}</span>
      <span className="num-mono w-16 text-right text-white/60">
        {timingMode ? fmtLapTime(r.bestLapTimeS ? r.bestLapTimeS * 1000 : null) : r.gapToPlayerS != null ? fmtGap(r.gapToPlayerS) : '--'}
      </span>
      {!timingMode && (
        <span className="num-mono w-9 text-right text-white/45" title="average tyre wear">
          {wearText}
        </span>
      )}
      <span className="num-mono w-5 text-center text-white/30">{timingMode ? lapDiffText : r.pitStopCount}</span>
      {r.penaltiesS > 0 && <span className="chip bg-accent-racing/15 text-accent-racing">{r.penaltiesS}s</span>}
      {statusIcon && <span className="ml-auto chip bg-white/[0.06] text-white/50">{statusIcon}</span>}
    </div>
  )
}

export function RivalsPanel(): React.ReactElement {
  const race = useRaceStore((s) => s.race)
  const rivals = race ? Object.values(race.rivals) : []
  const playerIdx = race?.player.carIndex ?? -1
  const timingMode = race ? isTimingSession(race) : false
  const playerLap = race?.player.lap ?? 0

  const sorted = rivals
    .filter((r) => r.position > 0)
    .sort((a, b) => a.position - b.position || a.carIndex - b.carIndex)

  return (
    <div className="glass flex h-full flex-col p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="label">Rivals</span>
        <div className="flex items-center gap-3 text-[9px] text-white/30">
          <span>{timingMode ? 'best lap' : 'gap to you'}</span>
          {!timingMode && <span>wear</span>}
          <span>{timingMode ? 'laps +/-' : 'pits'}</span>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="flex flex-col gap-0.5">
          {sorted.length === 0 && <div className="py-4 text-center text-xs text-white/25">等待车手数据…</div>}
          {sorted.map((r) => (
            <Row
              key={r.carIndex}
              r={r}
              isPlayer={r.carIndex === playerIdx}
              timingMode={timingMode}
              playerLap={playerLap}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function isTimingSession(race: RaceState): boolean {
  const { sessionType, sessionTypeLabel } = race.session
  return [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12].includes(sessionType) || /practice|qual|^p[123]$|^q[123]$|^osq$/i.test(sessionTypeLabel)
}
