import { useRaceStore } from '../../store'
import { compoundCName, tempStatus, tyreTempWindow, type Corners } from '@shared/index'

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
  inter: '#22C55E',
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
  const { status, color } = tempStatus(innerT, compound)
  const wearPct = Math.round(wear)
  // remaining life: 100 = full bar (fresh), 0 = empty bar (worn out)
  const remainingPct = 100 - wearPct
  // bar colour follows inner/core tyre temperature: cold=blue, ideal=green, hot=red
  const { color: barColor } = tempStatus(innerT, compound)
  const [lo, hi] = tyreTempWindow(compound)

  return (
    <div className="glass-flat p-3">
      <div className="flex items-center justify-between">
        <span className="label text-[11px]">{label} · <span className="num-mono text-white/70">{remainingPct}%</span></span>
        <div className="flex items-center gap-1">
          <span
            className="h-3 w-3 rounded-full"
            style={{ background: cColor, boxShadow: `0 0 5px ${cColor}` }}
            title={compound}
          />
          {cName && <span className="text-[9px] font-bold text-white/65">{cName}</span>}
        </div>
      </div>

      {/* wear bar: remaining life. full=100% (no wear), empty=0% (fully worn).
          colour = inner tyre temperature status (cold/ideal/hot). */}
      <div className="mt-1">
        <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.05]">
          <div
            className="h-full rounded-full transition-[width] duration-300"
            style={{ width: `${remainingPct}%`, background: barColor }}
          />
        </div>
      </div>

      {/* temps */}
      <div className="mt-2 flex flex-col gap-0.5 text-[11px] leading-tight">
        <div className="flex justify-between">
          <span className="text-white/30">表温</span>
          <span className="num-mono text-white/60">{Math.round(surf)}°</span>
        </div>
        <div className="flex justify-between">
          <span className="text-white/30">内温</span>
          <span className="num-mono font-semibold" style={{ color }}>{Math.round(innerT)}°</span>
        </div>
        <div className="flex justify-between">
          <span className="text-white/30">刹车</span>
          <span className="num-mono text-white/50">{Math.round(brakeT)}°</span>
        </div>
      </div>
      <div className="mt-1 text-[9px] text-white/30">
        {status === 'cold' ? '过冷' : status === 'hot' ? '过热' : '正常'} · 内温窗口 {lo}–{hi}°
      </div>
    </div>
  )
}

export function TyreGrid(): React.ReactElement {
  const race = useRaceStore((s) => s.race)
  const compound = race?.player.tyres.compound ?? 'unknown'
  const rawId = race?.player.tyres.rawCompoundId ?? -1

  return (
    <div className="glass p-4">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="label">Tyres</span>
        <span className="text-[9px] font-semibold text-white/40">{compoundTitle(compound, rawId)}</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {LAYOUT.map((c) => (
          <TyreCard key={c.key} corner={c.key} label={c.label} compound={compound} rawId={rawId} />
        ))}
      </div>
    </div>
  )
}

function compoundTitle(compound: string, rawId: number): string {
  const cName = compoundCName(rawId)
  if (compound === 'wet') return 'W 全雨胎'
  if (compound === 'inter') return 'I 半雨胎'
  if (compound === 'soft') return cName ? `S 软胎 · ${cName}` : 'S 软胎'
  if (compound === 'medium') return cName ? `M 中胎 · ${cName}` : 'M 中胎'
  if (compound === 'hard') return cName ? `H 硬胎 · ${cName}` : 'H 硬胎'
  return '未知胎'
}
