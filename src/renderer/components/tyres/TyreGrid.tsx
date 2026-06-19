import { useRaceStore } from '../../store'
import { tyreTempWindow, tempStatus, type Corners } from '@shared/index'

const LAYOUT: { key: keyof Corners; label: string }[] = [
  { key: 'fl', label: 'FL · 左前' },
  { key: 'fr', label: 'FR · 右前' },
  { key: 'rl', label: 'RL · 左后' },
  { key: 'rr', label: 'RR · 右后' }
]

const COMPOUND_COLOR: Record<string, string> = {
  soft: '#FF3B3B',
  medium: '#FFB020',
  hard: '#E6EDF6',
  inter: '#2DD4BF',
  wet: '#3B82F6',
  unknown: '#666'
}
const COMPOUND_SHORT: Record<string, string> = {
  soft: 'S',
  medium: 'M',
  hard: 'H',
  inter: 'I',
  wet: 'W',
  unknown: '?'
}

function TyreCard({ corner, label, compound }: { corner: keyof Corners; label: string; compound: string }): React.ReactElement {
  const race = useRaceStore((s) => s.race)
  const tyre = race?.player.tyres
  const wear = tyre ? tyre.wear[corner] : 0
  const surf = tyre ? tyre.surfaceTempC[corner] : 0
  const innerT = tyre ? tyre.innerTempC[corner] : 0
  const brakeT = tyre ? tyre.brakeTempC[corner] : 0
  const blister = tyre ? tyre.blisters[corner] : 0
  const cColor = COMPOUND_COLOR[compound] ?? '#666'
  const cShort = COMPOUND_SHORT[compound] ?? '?'
  const [loT, hiT] = tyreTempWindow(compound)
  const { status, color } = tempStatus(surf, compound)

  const wearPct = Math.round(wear)
  const R = 22
  const circ = 2 * Math.PI * R
  const dash = (wearPct / 100) * circ

  return (
    <div className="glass-flat flex flex-col items-center gap-0.5 p-1.5">
      <div className="flex w-full items-center justify-between">
        <span className="label text-[8px]">{label}</span>
        {/* compound chip merged into the top-right corner — replaces the separate color dot */}
        <span
          className="flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-bold text-ink-950"
          style={{ background: cColor, boxShadow: `0 0 6px ${cColor}` }}
          title={compound}
        >
          {cShort}
        </span>
      </div>
      <div className="relative h-[52px] w-[52px]">
        <svg viewBox="0 0 52 52" className="h-full w-full -rotate-90">
          <circle cx="26" cy="26" r={R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="4" />
          <circle
            cx="26" cy="26" r={R}
            fill="none" stroke={color} strokeWidth="4" strokeLinecap="round"
            strokeDasharray={`${dash} ${circ}`}
            style={{ transition: 'stroke-dasharray 0.3s ease, stroke 0.3s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="num-display text-base font-bold text-white">{wearPct}</span>
          <span className="text-[7px] text-white/40">wear</span>
        </div>
      </div>
      <div className="flex w-full flex-col gap-0 text-[8px] leading-tight">
        <div className="flex justify-between">
          <span className="text-white/30">表温</span>
          <span className="num-mono" style={{ color }}>{Math.round(surf)}°</span>
        </div>
        <div className="flex justify-between">
          <span className="text-white/30">内温</span>
          <span className="num-mono text-white/50">{Math.round(innerT)}°</span>
        </div>
        <div className="flex justify-between">
          <span className="text-white/30">刹车</span>
          <span className="num-mono text-white/50">{Math.round(brakeT)}°</span>
        </div>
      </div>
      <div className="text-[7px] text-white/25">
        {status === 'cold' ? '过冷' : status === 'hot' ? '过热' : '理想'} {loT}–{hiT}°
      </div>
      {blister > 5 && (
        <span className="text-[7px] text-accent-ember" title="blisters">◆{Math.round(blister)}</span>
      )}
    </div>
  )
}

export function TyreGrid(): React.ReactElement {
  const race = useRaceStore((s) => s.race)
  const compound = race?.player.tyres.compound ?? 'unknown'

  return (
    <div className="glass p-3">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="label">Tyres</span>
        <span className="text-[8px] text-white/30">wear · 温度 · {compound}</span>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {LAYOUT.map((c) => (
          <TyreCard key={c.key} corner={c.key} label={c.label} compound={compound} />
        ))}
      </div>
    </div>
  )
}
