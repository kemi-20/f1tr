import { useRaceStore } from '../../store'
import { compoundCName, tempStatus, type Corners } from '@shared/index'
import type { CSSProperties } from 'react'

const CORNERS: Array<{ key: keyof Corners; label: string; side: 'left' | 'right' }> = [
  { key: 'fl', label: 'FL', side: 'left' },
  { key: 'fr', label: 'FR', side: 'right' },
  { key: 'rl', label: 'RL', side: 'left' },
  { key: 'rr', label: 'RR', side: 'right' }
]

export function TyreGrid(): React.ReactElement {
  const race = useRaceStore((s) => s.race)
  const tyres = race?.player.tyres
  const dmg = race?.player?.damage
  const playerName = race ? race.rivals[race.player.carIndex]?.name || 'DRIVER' : 'DRIVER'
  const compound = tyres?.compound ?? 'unknown'
  const rawId = tyres?.rawCompoundId ?? -1
  const teamColor = teamColorForCar(race?.rivals[race.player.carIndex]?.team)

  return (
    <section className="car-status-panel h-full" style={{ '--team-color': teamColor } as CSSProperties}>
      <header className="car-status-header">
        <div className="car-status-title">CAR STATUS</div>
        <div className="car-status-driver">{playerName}</div>
      </header>
      <div className="car-status-accent" />
      <div className="car-status-meta">TYRE AGE {Math.round(tyres?.ageLaps ?? 0)} LAPS · {compoundTitle(compound, rawId)}</div>

      <div className="car-status-body">
        <div className="tyre-map">
          <div className="car-status-section">TYRE MAP</div>
          <div className="tyre-map-grid">
            {CORNERS.map((c) => (
              <TyreInfo key={c.key} corner={c.key} label={c.label} side={c.side} />
            ))}
            <div className="car-graphic" aria-hidden="true">
              <CarSilhouette />
            </div>
          </div>
        </div>

        <div className="car-status-separator" />

        <div className="damage-map">
          <div className="car-status-section">DAMAGE</div>
          <DamageLine label="FL WING" value={dmg?.frontLeftWing ?? 0} />
          <DamageLine label="FR WING" value={dmg?.frontRightWing ?? 0} />
          <DamageLine label="REAR WING" value={dmg?.rearWing ?? 0} />
          <DamageLine label="FLOOR" value={dmg?.floor ?? 0} />
          <DamageLine label="DIFFUSER" value={Math.max(dmg?.floor ?? 0, dmg?.rearWing ?? 0) * 0.72} />
          <DamageLine label="SIDEPOD" value={Math.max(dmg?.sidepodL ?? 0, dmg?.sidepodR ?? 0)} />
        </div>
      </div>
    </section>
  )
}

function TyreInfo({ corner, label, side }: { corner: keyof Corners; label: string; side: 'left' | 'right' }): React.ReactElement {
  const race = useRaceStore((s) => s.race)
  const tyres = race?.player.tyres
  const compound = tyres?.compound ?? 'unknown'
  const wear = Math.round(tyres?.wear[corner] ?? 0)
  const surface = Math.round(tyres?.surfaceTempC[corner] ?? 0)
  const inner = Math.round(tyres?.innerTempC[corner] ?? 0)
  const brake = Math.round(tyres?.brakeTempC[corner] ?? 0)
  const remaining = Math.max(0, 100 - wear)
  const temp = tempStatus(inner, compound)

  return (
    <div className={`tyre-map-corner tyre-map-${corner} tyre-map-${side}`} style={{ '--tyre-temp': temp.color } as CSSProperties}>
      <div className="tyre-corner-label">{label}</div>
      <div className="tyre-wear">{remaining}%</div>
      <div className="tyre-metric">SURF&nbsp; {surface}°C</div>
      <div className="tyre-metric">IN&nbsp;&nbsp;&nbsp; {inner}°C</div>
      <div className="tyre-metric">BRAKE {brake}°C</div>
    </div>
  )
}

function DamageLine({ label, value }: { label: string; value: number }): React.ReactElement {
  const pct = Math.round(value * 100)
  const color = pct > 45 ? '#FF3030' : pct > 20 ? '#FFD400' : '#80FF72'
  return (
    <div className="damage-line">
      <div className="damage-line-head">
        <span>{label}</span>
        <strong style={{ color }}>{pct}%</strong>
      </div>
      <div className="damage-track">
        <div className="damage-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  )
}

function CarSilhouette(): React.ReactElement {
  return (
    <svg viewBox="0 0 150 260" role="img">
      <path d="M67 35 C67 18 83 18 83 35 L88 96 C103 118 107 158 99 203 C96 224 87 241 75 248 C63 241 54 224 51 203 C43 158 47 118 62 96 Z" fill="rgba(7,10,15,0.86)" stroke="rgba(255,255,255,0.28)" strokeWidth="1.5" />
      <path d="M72 34 C72 24 78 24 78 34 L81 94 C82 117 84 194 75 225 C66 194 68 117 69 94 Z" fill="rgba(255,255,255,0.03)" stroke="var(--team-color)" strokeOpacity="0.75" strokeWidth="1.2" />
      <path d="M31 58 C59 48 91 48 119 58 L119 75 C91 67 59 67 31 75 Z" fill="rgba(255,255,255,0.035)" stroke="rgba(255,255,255,0.25)" strokeWidth="1.2" />
      <path d="M27 196 C58 205 92 205 123 196 L123 213 C92 222 58 222 27 213 Z" fill="rgba(255,255,255,0.035)" stroke="rgba(255,255,255,0.25)" strokeWidth="1.2" />
      <rect x="18" y="55" width="7" height="28" rx="2" fill="rgba(255,255,255,0.12)" />
      <rect x="125" y="55" width="7" height="28" rx="2" fill="rgba(255,255,255,0.12)" />
      <rect x="16" y="192" width="8" height="31" rx="2" fill="rgba(255,255,255,0.12)" />
      <rect x="126" y="192" width="8" height="31" rx="2" fill="rgba(255,255,255,0.12)" />
      <rect x="37" y="85" width="18" height="67" rx="8" fill="#F4E300" />
      <rect x="95" y="85" width="18" height="67" rx="8" fill="#F4E300" />
      <rect x="38" y="172" width="19" height="66" rx="8" fill="#F4E300" />
      <rect x="93" y="172" width="19" height="66" rx="8" fill="#F4E300" />
    </svg>
  )
}

function compoundTitle(compound: string, rawId: number): string {
  const cName = compoundCName(rawId)
  if (compound === 'wet') return 'W FULL WET'
  if (compound === 'inter') return 'I INTER'
  if (compound === 'soft') return cName ? `SOFT · ${cName}` : 'SOFT'
  if (compound === 'medium') return cName ? `MEDIUM · ${cName}` : 'MEDIUM'
  if (compound === 'hard') return cName ? `HARD · ${cName}` : 'HARD'
  return 'UNKNOWN TYRE'
}

const TEAM_COLOURS: Record<number, string> = {
  0: '#00D2BE',
  1: '#DC0000',
  2: '#3671C6',
  3: '#64C4FF',
  4: '#229971',
  5: '#0090FF',
  6: '#6692FF',
  7: '#FFFFFF',
  8: '#FF8000',
  9: '#B6BABD',
  129: '#00D2BE',
  185: '#00D2BE',
  186: '#DC0000',
  187: '#3671C6',
  188: '#64C4FF',
  189: '#229971',
  190: '#0090FF',
  191: '#6692FF',
  192: '#FFFFFF',
  193: '#FF8000',
  194: '#B6BABD'
}

function teamColorForCar(teamId: string | undefined): string {
  const id = Number(teamId)
  return Number.isFinite(id) ? TEAM_COLOURS[id] ?? '#FF2F62' : '#FF2F62'
}
