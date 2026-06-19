import { useRaceStore } from '../../store'
import { compoundLabel, tyreTempWindow, tempStatus, type Corners } from '@shared/index'

const CORNERS: (keyof Corners)[] = ['rl', 'rr', 'fl', 'fr']
const CORNER_LABEL: Record<keyof Corners, string> = { rl: 'RL', rr: 'RR', fl: 'FL', fr: 'FR' }

const COMPOUND_COLOR: Record<string, string> = {
  soft: '#FF3B3B',
  medium: '#FFB020',
  hard: '#E6EDF6',
  inter: '#2DD4BF',
  wet: '#3B82F6',
  unknown: '#666'
}

function TyreCard({ corner, compound }: { corner: keyof Corners; compound: string }): React.ReactElement {
  const race = useRaceStore((s) => s.race)
  const tyre = race?.player.tyres
  const wear = tyre ? tyre.wear[corner] : 0
  const surf = tyre ? tyre.surfaceTempC[corner] : 0
  const blister = tyre ? tyre.blisters[corner] : 0
  const compoundColor = COMPOUND_COLOR[compound] ?? '#666'
  const [loT, hiT] = tyreTempWindow(compound)
  const { status, color } = tempStatus(surf, compound)

  const wearPct = Math.round(wear)
  const R = 26
  const circ = 2 * Math.PI * R
  const dash = (wearPct / 100) * circ

  return (
    <div className="glass-flat flex flex-col items-center gap-1 p-2">
      <div className="flex w-full items-center justify-between">
        <span className="label">{CORNER_LABEL[corner]}</span>
        <span
          className="h-2 w-2 rounded-full"
          style={{ background: compoundColor, boxShadow: `0 0 6px ${compoundColor}` }}
          title={compound}
        />
      </div>
      <div className="relative h-[64px] w-[64px]">
        <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90">
          <circle cx="32" cy="32" r={R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="5" />
          <circle
            cx="32"
            cy="32"
            r={R}
            fill="none"
            stroke={color}
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circ}`}
            style={{ transition: 'stroke-dasharray 0.3s ease, stroke 0.3s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="num-display text-lg font-bold text-white">{wearPct}</span>
          <span className="text-[8px] text-white/40">wear</span>
        </div>
      </div>
      <div className="num-mono text-[10px]" style={{ color }}>
        {Math.round(surf)}°C
      </div>
      <div className="flex items-center gap-1 text-[9px]">
        <span className="chip bg-white/[0.05] text-white/60">{compoundLabel(compound)}</span>
      </div>
      <div className="text-[8px] text-white/30">
        ideal {loT}–{hiT}°C · {status === 'cold' ? '过冷' : status === 'hot' ? '过热' : '理想'}
      </div>
      {blister > 5 && (
        <span className="chip bg-accent-ember/15 text-accent-ember" title="blisters">
          ◆ {Math.round(blister)}
        </span>
      )}
    </div>
  )
}

export function TyreGrid(): React.ReactElement {
  const race = useRaceStore((s) => s.race)
  const compound = race?.player.tyres.compound ?? 'unknown'

  return (
    <div className="glass p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="label">Tyres</span>
        <span className="text-[9px] text-white/30">wear · surf temp · 窗口</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {CORNERS.map((c) => (
          <TyreCard key={c} corner={c} compound={compound} />
        ))}
      </div>
    </div>
  )
}
