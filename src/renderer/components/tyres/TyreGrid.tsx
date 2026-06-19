import { useRaceStore } from '../../store'
import { compoundCName, tempStatus, type Corners } from '@shared/index'

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

function TyreCard({ corner, label, compound, rawId }: { corner: keyof Corners; label: string; compound: string; rawId: number }): React.ReactElement {
  const race = useRaceStore((s) => s.race)
  const tyre = race?.player.tyres
  const wear = tyre ? tyre.wear[corner] : 0
  const surf = tyre ? tyre.surfaceTempC[corner] : 0
  const innerT = tyre ? tyre.innerTempC[corner] : 0
  const brakeT = tyre ? tyre.brakeTempC[corner] : 0
  const cColor = COMPOUND_COLOR[compound] ?? '#666'
  const cName = compoundCName(rawId)
  const { status, color } = tempStatus(surf, compound)
  const wearPct = Math.round(wear)
  // wear bar: 100% = full green (good), 0% = empty (worn out). bar shrinks as tyre wears.
  const wearColor = wear > 70 ? '#FF3B3B' : wear > 40 ? '#FFB020' : '#2DD4BF'

  return (
    <div className="glass-flat p-2">
      <div className="flex items-center justify-between">
        <span className="label text-[8px]">{label}</span>
        <div className="flex items-center gap-1">
          <span
            className="h-3 w-3 rounded-full"
            style={{ background: cColor, boxShadow: `0 0 5px ${cColor}` }}
            title={compound}
          />
          {cName && <span className="text-[8px] font-bold text-white/60">{cName}</span>}
        </div>
      </div>

      {/* wear bar: full = 100% (fresh), empty = 0% (worn out) */}
      <div className="mt-1">
        <div className="flex justify-between text-[7px] text-white/30">
          <span>wear</span><span className="num-mono">{wearPct}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.05]">
          <div
            className="h-full rounded-full transition-[width] duration-300"
            style={{ width: `${wearPct}%`, background: wearColor }}
          />
        </div>
      </div>

      {/* temps */}
      <div className="mt-1 flex flex-col gap-0 text-[8px] leading-tight">
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
        {status === 'cold' ? '过冷' : status === 'hot' ? '过热' : '正常'} · 窗口 85–105°
      </div>
    </div>
  )
}

export function TyreGrid(): React.ReactElement {
  const race = useRaceStore((s) => s.race)
  const compound = race?.player.tyres.compound ?? 'unknown'
  const rawId = race?.player.tyres.rawCompoundId ?? -1

  return (
    <div className="glass p-3">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="label">Tyres</span>
        <span className="text-[8px] text-white/30">{compound}</span>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {LAYOUT.map((c) => (
          <TyreCard key={c.key} corner={c.key} label={c.label} compound={compound} rawId={rawId} />
        ))}
      </div>
    </div>
  )
}
