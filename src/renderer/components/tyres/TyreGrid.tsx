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
  const race = useRaceStore((s) => s.race)
  const tyres = race?.player.tyres
  const surface = tyres?.surfaceTempC ?? { fl: 0, fr: 0, rl: 0, rr: 0 }
  const inner = tyres?.innerTempC ?? { fl: 0, fr: 0, rl: 0, rr: 0 }
  const brake = tyres?.brakeTempC ?? { fl: 0, fr: 0, rl: 0, rr: 0 }
  const engineTemp = Math.round(race?.player.engineTempC ?? 0)
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
    '--engine-temp': engineColor(engineTemp)
  } as CSSProperties

  return (
    <svg className="origin-style-car" style={carStyle} viewBox="0 0 180 320" role="img">
      <defs>
        <linearGradient id="carBody" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#e7edf4" stopOpacity="0.28" />
          <stop offset="0.5" stopColor="#56616d" stopOpacity="0.13" />
          <stop offset="1" stopColor="#e7edf4" stopOpacity="0.22" />
        </linearGradient>
        <linearGradient id="carSpine" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.35" />
          <stop offset="0.45" stopColor="#ffffff" stopOpacity="0.08" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0.28" />
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
        <ellipse className="car-shadow" cx="90" cy="169" rx="48" ry="135" />

        <path className="front-wing-main" d="M31 18 L90 34 L149 18 L149 62 C126 54 108 52 90 52 C72 52 54 54 31 62 Z" />
        <path className="front-wing-flap" d="M39 29 L90 43 L141 29 M42 47 C66 40 114 40 138 47" />
        <rect className="wing-endplate" x="20" y="12" width="8" height="55" rx="2" />
        <rect className="wing-endplate" x="152" y="12" width="8" height="55" rx="2" />

        <path className="rear-wing-main" d="M35 273 H145 L154 306 H26 Z" />
        <path className="rear-wing-flap" d="M45 283 H135 M50 294 H130" />
        <rect className="wing-endplate" x="22" y="265" width="11" height="45" rx="2" />
        <rect className="wing-endplate" x="147" y="265" width="11" height="45" rx="2" />

        <TemperatureWheel corner="fl" x={16} y={78} />
        <TemperatureWheel corner="fr" x={140} y={78} />
        <TemperatureWheel corner="rl" x={16} y={216} />
        <TemperatureWheel corner="rr" x={140} y={216} />

        <path className="suspension suspension-fl" d="M43 99 L75 113 M43 127 L76 136 M46 112 H75" />
        <path className="suspension suspension-fr" d="M137 99 L105 113 M137 127 L104 136 M134 112 H105" />
        <path className="suspension suspension-rl" d="M43 237 L75 220 M43 263 L75 241 M46 250 H73" />
        <path className="suspension suspension-rr" d="M137 237 L105 220 M137 263 L105 241 M134 250 H107" />

        <path className="floor-plate" d="M66 76 H114 L128 264 L90 296 L52 264 Z" />
        <path className="floor-outline" d="M60 92 C46 139 46 216 61 262 M120 92 C134 139 134 216 119 262" />
        <path className="sidepod sidepod-left" d="M73 114 L55 139 L60 216 L76 238 C67 194 66 151 73 114 Z" />
        <path className="sidepod sidepod-right" d="M107 114 L125 139 L120 216 L104 238 C113 194 114 151 107 114 Z" />

        <path className="body-shell" d="M86 36 C86 24 94 24 94 36 L99 94 L113 130 L105 258 L90 293 L75 258 L67 130 L81 94 Z" />
        <path className="nose-highlight" d="M90 36 C94 84 96 127 96 171 C96 221 93 262 90 292 C87 262 84 221 84 171 C84 127 86 84 90 36 Z" />
        <path className="halo" d="M75 105 C78 85 102 85 105 105 C100 96 80 96 75 105 Z" />
        <ellipse className="cockpit" cx="90" cy="126" rx="9" ry="22" />
        <path className="center-stripe" d="M90 38 C88 84 87 126 87 174 C87 226 88 263 90 292 C92 263 93 226 93 174 C93 126 92 84 90 38 Z" />
        <path className="vent-lines" d="M72 161 H108 M70 174 H110 M68 187 H112 M68 201 H112 M71 215 H109" />
        <path className="plank-lines" d="M82 70 H98 M78 86 H102 M73 247 H107 M68 260 H112" />

        <g className="engine-core">
          <path d="M90 145 L111 158 L107 184 L90 198 L73 184 L69 158 Z" />
          <path d="M90 153 L101 161 L99 180 L90 188 L81 180 L79 161 Z" />
        </g>
        <text className="engine-temp-label" x="90" y="141" textAnchor="middle">{engineTemp > 0 ? `${engineTemp}°C` : '--°C'}</text>
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

function engineColor(temp: number): string {
  return tempColor(temp, [
    [70, '#2f8fff'],
    [95, '#20f06b'],
    [108, '#f4e300'],
    [118, '#ff5a1f'],
    [128, '#ff1f2d']
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
