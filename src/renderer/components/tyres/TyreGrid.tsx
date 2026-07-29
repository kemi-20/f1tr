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
  const hasData = tyres != null && (surface > 0 || inner > 0 || brake > 0 || wear > 0 || tyres.compound !== 'unknown')
  const temp = tempStatus(inner, compound)
  const wearText = hasData ? `${wear}%` : '--%'
  const tempColor = hasData ? temp.color : 'rgba(255,255,255,0.5)'

  return (
    <div className={`tyre-map-corner tyre-map-${corner} tyre-map-${side}`} style={{ '--tyre-temp': tempColor } as CSSProperties}>
      <div className="tyre-corner-label">{label}</div>
      <div className="tyre-wear">{wearText}</div>
      <div className="tyre-wear-caption">WORN</div>
      <div className="tyre-metric">SURF&nbsp; {hasData ? surface : '--'}°C</div>
      <div className="tyre-metric">IN&nbsp;&nbsp;&nbsp; {hasData ? inner : '--'}°C</div>
      <div className="tyre-metric">BRAKE {hasData ? brake : '--'}°C</div>
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
    <svg className="origin-style-car" viewBox="0 0 180 300" role="img">
      <defs>
        <linearGradient id="carBody" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#151b22" />
          <stop offset="0.5" stopColor="#05080d" />
          <stop offset="1" stopColor="#10151c" />
        </linearGradient>
        <filter id="carGlow" x="-40%" y="-20%" width="180%" height="140%">
          <feGaussianBlur stdDeviation="2.2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <path className="car-shadow" d="M90 28 C116 72 119 220 90 282 C61 220 64 72 90 28 Z" />

      <path className="front-wing-main" d="M22 68 C63 55 117 55 158 68 L158 90 C116 76 64 76 22 90 Z" />
      <path className="front-wing-flap" d="M31 76 C68 66 112 66 149 76" />
      <rect className="wing-endplate" x="8" y="63" width="9" height="38" rx="2" />
      <rect className="wing-endplate" x="163" y="63" width="9" height="38" rx="2" />

      <path className="rear-wing-main" d="M18 232 C61 246 119 246 162 232 L162 255 C119 270 61 270 18 255 Z" />
      <path className="rear-wing-flap" d="M31 241 C69 251 111 251 149 241" />
      <rect className="wing-endplate" x="6" y="226" width="11" height="44" rx="2" />
      <rect className="wing-endplate" x="163" y="226" width="11" height="44" rx="2" />

      <rect className="tyre-shape" x="42" y="105" width="25" height="72" rx="11" />
      <rect className="tyre-shape" x="113" y="105" width="25" height="72" rx="11" />
      <rect className="tyre-shape" x="41" y="206" width="26" height="74" rx="11" />
      <rect className="tyre-shape" x="113" y="206" width="26" height="74" rx="11" />

      <path className="sidepod sidepod-left" d="M73 106 C58 132 56 191 73 229 C61 206 54 162 61 125 C63 116 67 110 73 106 Z" />
      <path className="sidepod sidepod-right" d="M107 106 C122 132 124 191 107 229 C119 206 126 162 119 125 C117 116 113 110 107 106 Z" />

      <path className="body-shell" d="M83 43 C83 27 97 27 97 43 L101 104 C116 131 119 202 106 248 C101 266 95 279 90 286 C85 279 79 266 74 248 C61 202 64 131 79 104 Z" />
      <path className="nose-highlight" d="M90 38 C95 78 98 124 98 168 C98 217 94 256 90 276 C86 256 82 217 82 168 C82 124 85 78 90 38 Z" />
      <path className="halo" d="M76 99 C78 79 102 79 104 99 C101 91 79 91 76 99 Z" />
      <ellipse className="cockpit" cx="90" cy="118" rx="9" ry="22" />
      <path className="center-stripe" d="M90 37 C88 76 87 121 87 168 C87 214 88 253 90 276 C92 253 93 214 93 168 C93 121 92 76 90 37 Z" />
      <path className="floor-outline" d="M67 112 C49 158 54 229 90 286 C126 229 131 158 113 112" />
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
