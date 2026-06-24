import { useRaceStore } from '../../store'

function DamageBar({ label, value }: { label: string; value: number }): React.ReactElement {
  const pct = Math.round(value * 100)
  const color = value > 0.5 ? '#FF3B3B' : value > 0.25 ? '#FFB020' : '#2DD4BF'
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 text-[9px] uppercase tracking-wide text-white/40">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.05]">
        <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="num-mono w-8 text-right text-[9px] text-white/50">{pct}</span>
    </div>
  )
}

export function DamagePanel(): React.ReactElement {
  const race = useRaceStore((s) => s.race)
  const dmg = race?.player?.damage

  return (
    <div className="glass p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="label">Damage</span>
        <span className="text-[9px] text-white/30">body</span>
      </div>
      <div className="flex flex-col gap-1.5">
        <DamageBar label="F-Wing L" value={dmg?.frontLeftWing ?? 0} />
        <DamageBar label="F-Wing R" value={dmg?.frontRightWing ?? 0} />
        <DamageBar label="R-Wing" value={dmg?.rearWing ?? 0} />
        <DamageBar label="Floor" value={dmg?.floor ?? 0} />
      </div>
    </div>
  )
}
