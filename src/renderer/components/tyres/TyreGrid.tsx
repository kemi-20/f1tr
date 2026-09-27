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
    <svg className="origin-style-car" style={carStyle} viewBox="0 0 220 580" role="img" aria-label="F1 car thermal map">
      <title>Tyre surface, core, brake and engine temperatures</title>
      <g strokeLinejoin="round">
        {/* Multi-element front wing and curved endplates. */}
        <path className="front-wing-main" d="M18 26 Q64 17 97 28 H123 Q156 17 202 26 L199 67 Q161 71 128 56 H92 Q59 71 21 67 Z" />
        <path className="front-wing-flap" d="M23 37 Q60 29 94 39 M126 39 Q160 29 197 37 M23 48 Q58 42 94 49 M126 49 Q162 42 197 48 M25 60 Q60 55 91 56 M129 56 Q160 55 195 60" />
        <path className="wing-endplate" d="M14 23 H21 L25 70 H18 Z M199 23 H206 L202 70 H195 Z" />

        {/* Floor edge, venturi entrances and diffuser remain distinct from bodywork. */}
        <path className="floor-plate" d="M81 191 L58 218 L48 259 L46 411 L66 457 L83 496 H137 L154 457 L174 411 L172 259 L162 218 L139 191 Z" />
        <path className="floor-outline" d="M63 227 L54 267 L53 402 L72 449 M157 227 L166 267 L167 402 L148 449 M67 234 L62 270 M76 225 L71 264 M144 225 L149 264 M153 234 L158 270" />
        <path className="floor-plate" d="M75 469 H145 L155 520 H65 Z" />
        <path className="vent-lines" d="M79 480 L75 518 M94 480 L92 518 M110 481 V520 M126 480 L128 518 M141 480 L145 518" />

        {/* Double wishbones: inboard junctions, outboard brake temperature. */}
        <path className="suspension suspension-fl" d="M48 139 L96 119 M48 144 L95 185 M48 148 L97 155" />
        <path className="suspension suspension-fr" d="M172 139 L124 119 M172 144 L125 185 M172 148 L123 155" />
        <path className="suspension suspension-rl" d="M48 462 L96 425 M48 468 L99 493 M48 465 L98 457" />
        <path className="suspension suspension-rr" d="M172 462 L124 425 M172 468 L121 493 M172 465 L122 457" />

        <path className="body-shell" d="M104 30 Q110 25 116 30 L122 114 L133 176 L138 219 L132 252 L127 283 L127 339 L137 397 L124 449 L119 501 H101 L96 449 L83 397 L93 339 V283 L88 252 L82 219 L87 176 L98 114 Z" />
        <path className="nose-highlight" d="M105 37 H115 L118 112 L124 166 Q110 158 96 166 L102 112 Z" />
        <path className="center-stripe" d="M110 38 V180 M110 283 V318 M110 398 V498" />
        <path className="sidepod" d="M88 248 Q65 241 58 266 Q55 316 64 354 Q72 384 92 405 L99 384 L95 308 Z M132 248 Q155 241 162 266 Q165 316 156 354 Q148 384 128 405 L121 384 L125 308 Z" />
        <path className="car-intake" d="M60 263 Q71 251 89 257 L91 271 Q72 267 60 278 Z M160 263 Q149 251 131 257 L129 271 Q148 267 160 278 Z" />
        <path className="floor-outline" d="M62 290 Q63 347 88 384 M158 290 Q157 347 132 384" />
        <path className="vent-lines" d="M69 303 L85 307 M70 313 L86 317 M71 323 L87 327 M73 333 L88 337 M151 303 L135 307 M150 313 L134 317 M149 323 L133 327 M147 333 L132 337" />

        {/* Recessed cockpit, helmet, halo arch and centre pillar. */}
        <path className="cockpit" d="M94 198 Q110 187 126 198 L127 235 Q125 259 110 266 Q95 259 93 235 Z" />
        <ellipse className="driver-helmet" cx="110" cy="238" rx="9" ry="12" />
        <path className="halo" d="M87 231 L86 209 Q86 186 110 186 Q134 186 134 209 L133 231 M110 188 V216" />
        <path className="car-intake" d="M102 276 Q110 263 118 276 L116 289 H104 Z" />
        <path className="mirror-arm" d="M86 225 L66 218 M134 225 L154 218" />
        <rect className="wing-endplate" x="53" y="208" width="18" height="10" rx="3" />
        <rect className="wing-endplate" x="149" y="208" width="18" height="10" rx="3" />

        {/* Compact engine thermal overlay, separate from aerodynamic silhouette. */}
        <g className="engine-core">
          <path d="M98 350 H122 L129 360 V382 L119 395 H101 L91 382 V360 Z" />
          <path d="M102 357 H118 V386 H102 Z" />
        </g>
        <text className="engine-caption" x="110" y="319" textAnchor="middle">ENGINE</text>
        <text className="engine-temp-label" x="110" y="342" textAnchor="middle">{engineTemp > 0 ? `${engineTemp}°C` : '--°C'}</text>
        <path className="car-intake" d="M105 501 H115 V519 H105 Z" />

        <path className="rear-wing-main" d="M44 521 Q110 514 176 521 V553 Q110 562 44 553 Z" />
        <path className="rear-wing-flap" d="M50 533 Q110 528 170 533 M50 544 Q110 548 170 544" />
        <path className="wing-endplate" d="M38 516 H46 V560 H38 Z M174 516 H182 V560 H174 Z" />
        <path className="mirror-arm" d="M101 495 V532 M119 495 V532" />

        <TemperatureWheel corner="fl" x={16} y={112} />
        <TemperatureWheel corner="fr" x={176} y={112} />
        <TemperatureWheel corner="rl" x={12} y={431} />
        <TemperatureWheel corner="rr" x={176} y={431} />
      </g>
    </svg>
  )
}

function TemperatureWheel({ corner, x, y }: { corner: keyof Corners; x: number; y: number }): React.ReactElement {
  const brakeX = corner === 'fr' || corner === 'rr' ? -10 : 27
  return (
    <g className={`temp-wheel temp-wheel-${corner}`} transform={`translate(${x} ${y}) scale(${corner === 'rl' || corner === 'rr' ? '1.3 1.2' : '1.15 1'})`}>
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
