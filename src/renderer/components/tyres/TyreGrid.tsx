import { useRaceStore } from '../../store'
import { compoundCName, tyreWearColor, type Corners } from '@shared/index'
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
  const wear = Math.round(tyres?.wear[corner] ?? 0)
  const surface = Math.round(tyres?.surfaceTempC[corner] ?? 0)
  const inner = Math.round(tyres?.innerTempC[corner] ?? 0)
  const brake = Math.round(tyres?.brakeTempC[corner] ?? 0)
  const hasData = tyres != null && (surface > 0 || inner > 0 || brake > 0 || wear > 0 || tyres.compound !== 'unknown')
  const wearText = hasData ? `${wear}%` : '--%'
  const wearColor = hasData ? tyreWearColor(wear) : 'rgba(255,255,255,0.5)'

  return (
    <div className={`tyre-map-corner tyre-map-${corner} tyre-map-${side}`} style={{ '--tyre-temp': wearColor } as CSSProperties}>
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
  const tyres = useRaceStore((s) => s.race?.player.tyres)
  const surface = tyres?.surfaceTempC ?? { fl: 0, fr: 0, rl: 0, rr: 0 }
  const inner = tyres?.innerTempC ?? { fl: 0, fr: 0, rl: 0, rr: 0 }
  const brake = tyres?.brakeTempC ?? { fl: 0, fr: 0, rl: 0, rr: 0 }
  const brakeAvg = Math.round((brake.fl + brake.fr + brake.rl + brake.rr) / 4)
  const carStyle = {
    '--surface-fl': tyreSurfaceColor(surface.fl),
    '--surface-fr': tyreSurfaceColor(surface.fr),
    '--surface-rl': tyreSurfaceColor(surface.rl),
    '--surface-rr': tyreSurfaceColor(surface.rr),
    '--inner-fl': tyreInnerColor(inner.fl),
    '--inner-fr': tyreInnerColor(inner.fr),
    '--inner-rl': tyreInnerColor(inner.rl),
    '--inner-rr': tyreInnerColor(inner.rr),
    '--brake-fl': brakeColor(brake.fl),
    '--brake-fr': brakeColor(brake.fr),
    '--brake-rl': brakeColor(brake.rl),
    '--brake-rr': brakeColor(brake.rr),
    '--brake-avg': brakeColor(brakeAvg)
  } as CSSProperties

  return (
    <svg className="origin-style-car" style={carStyle} viewBox="0 0 180 300" role="img">
      <defs>
        <linearGradient id="carBody" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#2a333d" stopOpacity="0.62" />
          <stop offset="0.52" stopColor="#0a0e13" stopOpacity="0.72" />
          <stop offset="1" stopColor="#26313a" stopOpacity="0.58" />
        </linearGradient>
        <filter id="carGlow" x="-40%" y="-20%" width="180%" height="140%">
          <feGaussianBlur stdDeviation="2.2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <g opacity="0.98">
        <path className="car-shadow" d="M90 28 C116 72 119 220 90 282 C61 220 64 72 90 28 Z" />

        <path className="front-wing-main" d="M26 16 L90 34 L154 16 L154 58 C124 48 56 48 26 58 Z" />
        <path className="front-wing-flap" d="M35 25 L90 40 L145 25" />
        <rect className="wing-endplate" x="16" y="9" width="8" height="55" rx="2" />
        <rect className="wing-endplate" x="156" y="9" width="8" height="55" rx="2" />

        <path className="rear-wing-main" d="M37 254 H143 L151 285 H29 Z" />
        <path className="rear-wing-flap" d="M47 265 H133" />
        <rect className="wing-endplate" x="23" y="248" width="12" height="43" rx="2" />
        <rect className="wing-endplate" x="145" y="248" width="12" height="43" rx="2" />

        <TemperatureWheel corner="fl" x={18} y={75} />
        <TemperatureWheel corner="fr" x={138} y={75} />
        <TemperatureWheel corner="rl" x={18} y={204} />
        <TemperatureWheel corner="rr" x={138} y={204} />

        <path className="suspension suspension-fl" d="M43 97 L78 111 M43 124 L78 132" />
        <path className="suspension suspension-fr" d="M137 97 L102 111 M137 124 L102 132" />
        <path className="suspension suspension-rl" d="M43 225 L76 210 M43 251 L76 230" />
        <path className="suspension suspension-rr" d="M137 225 L104 210 M137 251 L104 230" />

        <path className="floor-plate" d="M66 76 H114 L126 245 H54 Z" />
        <path className="sidepod sidepod-left" d="M72 101 L52 124 L58 201 L75 222 C65 183 64 139 72 101 Z" />
        <path className="sidepod sidepod-right" d="M108 101 L128 124 L122 201 L105 222 C115 183 116 139 108 101 Z" />

        <path className="body-shell" d="M84 32 C84 19 96 19 96 32 L101 88 L119 121 L104 252 L90 282 L76 252 L61 121 L79 88 Z" />
        <path className="nose-highlight" d="M90 30 C94 75 96 122 96 168 C96 217 93 256 90 279 C87 256 84 217 84 168 C84 122 86 75 90 30 Z" />
        <path className="halo" d="M75 98 C78 78 102 78 105 98 C101 89 79 89 75 98 Z" />
        <ellipse className="cockpit" cx="90" cy="119" rx="10" ry="24" />
        <path className="center-stripe" d="M90 31 C88 76 87 122 87 170 C87 219 88 255 90 279 C92 255 93 219 93 170 C93 122 92 76 90 31 Z" />
        <path className="floor-outline" d="M65 108 C47 158 54 226 90 282 C126 226 133 158 115 108" />
        <path className="vent-lines" d="M73 148 H107 M70 160 H110 M68 172 H112 M66 184 H114" />

        <g className="brake-core">
          <path d="M90 137 L111 151 L108 177 L90 191 L72 177 L69 151 Z" />
          <path d="M90 145 L102 154 L100 173 L90 182 L80 173 L78 154 Z" />
        </g>
        <text className="brake-temp-label" x="90" y="134" textAnchor="middle">{brakeAvg > 0 ? `${brakeAvg}°C` : '--°C'}</text>
      </g>
    </svg>
  )
}

function TemperatureWheel({ corner, x, y }: { corner: keyof Corners; x: number; y: number }): React.ReactElement {
  const brakeX = corner === 'fr' || corner === 'rr' ? -10 : 27
  return (
    <g className={`temp-wheel temp-wheel-${corner}`} transform={`translate(${x} ${y})`}>
      <rect className="tyre-surface-band" x="0" y="0" width="24" height="61" rx="5" />
      <rect className="tyre-inner-band" x="6" y="7" width="12" height="47" rx="3" />
      <rect className="brake-temp-block" x={brakeX} y="18" width="7" height="25" rx="2" />
    </g>
  )
}

function tyreSurfaceColor(temp: number): string {
  return tempColor(temp, [
    [45, '#2f8fff'],
    [75, '#20f06b'],
    [96, '#f4e300'],
    [112, '#ff5a1f'],
    [126, '#ff1f2d']
  ])
}

function tyreInnerColor(temp: number): string {
  return tempColor(temp, [
    [55, '#2f8fff'],
    [82, '#20f06b'],
    [102, '#f4e300'],
    [116, '#ff5a1f'],
    [130, '#ff1f2d']
  ])
}

function brakeColor(temp: number): string {
  return tempColor(temp, [
    [250, '#2f8fff'],
    [430, '#20f06b'],
    [650, '#f4e300'],
    [850, '#ff5a1f'],
    [1000, '#ff1f2d']
  ])
}

function tempColor(temp: number, stops: Array<[number, string]>): string {
  if (!Number.isFinite(temp) || temp <= 0) return 'rgba(255,255,255,0.12)'
  if (temp <= stops[0][0]) return stops[0][1]
  for (let i = 1; i < stops.length; i++) {
    const prev = stops[i - 1]
    const next = stops[i]
    if (temp <= next[0]) return mixHex(prev[1], next[1], (temp - prev[0]) / (next[0] - prev[0]))
  }
  return stops[stops.length - 1][1]
}

function mixHex(a: string, b: string, t: number): string {
  const ca = parseHex(a)
  const cb = parseHex(b)
  if (!ca || !cb) return b
  const n = ca.map((v, i) => Math.round(v + (cb[i] - v) * Math.max(0, Math.min(1, t))))
  return `rgb(${n[0]} ${n[1]} ${n[2]})`
}

function parseHex(hex: string): [number, number, number] | null {
  const clean = hex.replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return null
  const value = Number.parseInt(clean, 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
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
