import { useRaceStore } from '../../store'
import { fmtGap, compoundLabel } from '@shared/index'
import type { RivalState } from '@shared/types/state'

function Row({ r, isPlayer }: { r: RivalState; isPlayer: boolean }): React.ReactElement {
  const tyreColor =
    { soft: '#FF3B3B', medium: '#FFB020', hard: '#E6EDF6', inter: '#2DD4BF', wet: '#3B82F6', unknown: '#666' }[r.tyreCompound] ?? '#666'
  const statusIcon =
    r.status === 'retired' ? 'DNF' : r.status === 'inGarage' ? 'IN' : r.status === 'finished' ? '🏁' : r.pitStatus === 2 ? 'PIT' : ''

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
        {r.gapToPlayerS != null ? fmtGap(r.gapToPlayerS) : '--'}
      </span>
      <span className="num-mono w-5 text-center text-white/30">{r.pitStopCount}</span>
      {r.penaltiesS > 0 && <span className="chip bg-accent-racing/15 text-accent-racing">{r.penaltiesS}s</span>}
      {statusIcon && <span className="ml-auto chip bg-white/[0.06] text-white/50">{statusIcon}</span>}
    </div>
  )
}

export function RivalsPanel(): React.ReactElement {
  const race = useRaceStore((s) => s.race)
  const rivals = race ? Object.values(race.rivals) : []
  const playerIdx = race?.player.carIndex ?? -1

  // sort by position, show window around player
  const sorted = [...rivals].sort((a, b) => a.position - b.position)
  const playerPos = sorted.findIndex((r) => r.carIndex === playerIdx)
  const start = Math.max(0, playerPos - 2)
  const window = sorted.slice(start, start + 7)

  return (
    <div className="glass flex h-full flex-col p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="label">Rivals</span>
        <div className="flex items-center gap-3 text-[9px] text-white/30">
          <span>gap to you</span>
          <span>pits</span>
        </div>
      </div>
      <div className="flex flex-col gap-0.5">
        {window.length === 0 && <div className="py-4 text-center text-xs text-white/25">等待车手数据…</div>}
        {window.map((r) => (
          <Row key={r.carIndex} r={r} isPlayer={r.carIndex === playerIdx} />
        ))}
      </div>
    </div>
  )
}
