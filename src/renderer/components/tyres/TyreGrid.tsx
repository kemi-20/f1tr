import { useRaceStore } from '../../store'
import { compoundCName, tyreWearColor, type Corners } from '@shared/index'
import { teamColorForCarOrNull } from '../rivals/teamMeta'
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
  const player = race?.rivals[race.player.carIndex]
  const statusAccent = teamColorForCarOrNull(player?.team, player?.teamColor) ?? 'rgb(var(--accent-carbon-rgb))'

  return (
    <section className="car-status-panel h-full" style={{ '--status-accent': statusAccent } as CSSProperties}>
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
  const color = damageColor(value)
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

function damageColor(value: number | undefined): string {
  if (value == null || !Number.isFinite(value) || value < 0 || value > 1) return '#69747b'
  const pct = Math.round(value * 100)
  return pct > 45 ? '#FF3030' : pct > 20 ? '#FFD400' : '#80FF72'
}

function CarSilhouette(): React.ReactElement {
  const race = useRaceStore((s) => s.race)
  const tyres = race?.player.tyres
  const surface = tyres?.surfaceTempC ?? { fl: 0, fr: 0, rl: 0, rr: 0 }
  const inner = tyres?.innerTempC ?? { fl: 0, fr: 0, rl: 0, rr: 0 }
  const brake = tyres?.brakeTempC ?? { fl: 0, fr: 0, rl: 0, rr: 0 }
  const engineTemp = Math.round(race?.player.engineTempC ?? 0)
  const damage = race?.player.damage
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
    <svg className="origin-style-car" style={carStyle} viewBox="-4 10 228 554" role="img" aria-label="F1 car thermal map">
      <title>Tyre surface, core, brake and engine temperatures</title>
      <g strokeLinejoin="round">
        {/* Swept split wing: retain a clear silhouette at dashboard scale. */}
        <path className="front-wing-main damage-wing" style={{ color: damageColor(damage?.frontLeftWing) }} d="M101 19 Q83 19 65 28 L17 51 L18 88 Q41 87 61 79 L91 64 L103 58 Z" />
        <path className="front-wing-main damage-wing" style={{ color: damageColor(damage?.frontRightWing) }} d="M119 19 Q137 19 155 28 L203 51 L202 88 Q179 87 159 79 L129 64 L117 58 Z" />
        <path className="front-wing-flap" d="M22 63 L68 42 Q83 34 99 33 M198 63 L152 42 Q137 34 121 33 M23 78 Q43 76 61 68 L94 52 M197 78 Q177 76 159 68 L126 52" />
        <path className="wing-endplate" d="M14 50 L20 48 L23 90 L16 92 Z M200 48 L206 50 L204 92 L197 90 Z" />
        <path className="front-wing-flap" d="M91 64 L99 84 H121 L129 64" />

        {/* Floor edge, venturi entrances and diffuser remain distinct from bodywork. */}
        <path className="floor-plate" d="M81 191 L43 214 L35 251 L35 408 L54 447 L78 496 H142 L166 447 L185 408 L185 251 L177 214 L139 191 L150 235 L155 270 H65 L70 235 Z" />
        <path className="floor-outline" d="M47 230 L42 267 V402 L65 449 M173 230 L178 267 V402 L155 449 M51 244 L49 300 M60 241 L57 288 M160 241 L163 288 M169 244 L171 300" />
        <path className="floor-plate" d="M75 469 H145 L155 520 H65 Z" />
        <path className="vent-lines" d="M79 480 L75 518 M94 480 L92 518 M110 481 V520 M126 480 L128 518 M141 480 L145 518" />

        {/* Double wishbones: inboard junctions, outboard brake temperature. */}
        <path className="suspension suspension-fl" d="M48 139 L96 119 M48 144 L95 185 M48 148 L97 155" />
        <path className="suspension suspension-fr" d="M172 139 L124 119 M172 144 L125 185 M172 148 L123 155" />
        <path className="suspension suspension-rl" d="M48 462 L96 425 M48 468 L99 493 M48 465 L98 457" />
        <path className="suspension suspension-rr" d="M172 462 L124 425 M172 468 L121 493 M172 465 L122 457" />

        <path className="body-shell" d="M100 29 Q100 13 110 13 Q120 13 120 29 L121 87 L122 114 L133 176 L138 219 L132 252 L127 283 L127 339 L137 397 L124 449 L119 501 H101 L96 449 L83 397 L93 339 V283 L88 252 L82 219 L87 176 L98 114 L99 87 Z" />
        <path className="nose-highlight" d="M105 30 Q110 21 115 30 L116 90 L118 112 L124 166 Q110 158 96 166 L102 112 L104 90 Z" />
        <path className="center-stripe" d="M110 32 V180 M110 283 V318 M110 398 V498" />
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

        {/* Stepped thermal schematic with distinct cylinder banks and lower housing. */}
        <g className="engine-core">
          <path className="engine-housing" d="M100 351 H120 V358 H130 V369 H135 L131 386 H123 L120 397 H115 V405 H105 V397 H100 L97 386 H89 L85 369 H90 V358 H100 Z" />
          <path className="engine-bank" d="M95 363 H103 L106 383 H98 L94 375 Z M117 363 H125 L126 375 L122 383 H114 Z" />
          <path className="engine-spine" d="M106 357 H114 V385 L111 397 H109 L106 385 Z" />
          <path className="engine-detail" d="M96 368 H103 M97 374 H104 M99 380 H105 M117 368 H124 M116 374 H123 M115 380 H121 M102 390 H118" />
        </g>
        <text className="engine-caption" x="110" y="319" textAnchor="middle">ENGINE</text>
        <text className="engine-temp-label" x="110" y="342" textAnchor="middle">{engineTemp > 0 ? `${engineTemp}°C` : '--°C'}</text>
        <path className="car-intake" d="M105 501 H115 V519 H105 Z" />

        <path className="rear-wing-main damage-wing" style={{ color: damageColor(damage?.rearWing) }} d="M44 521 Q110 514 176 521 V553 Q110 562 44 553 Z" />
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
  const outerX = corner === 'fr' || corner === 'rr' ? 0 : -10
  return (
    <g className={`temp-wheel temp-wheel-${corner}`} transform={`translate(${x} ${y}) scale(${corner === 'rl' || corner === 'rr' ? '1.3 1.2' : '1.15 1'})`}>
      <rect className="tyre-surface-band" x={outerX} y="-3" width="34" height="67" rx="6" />
      <rect className="tyre-inner-band" x={outerX + 7} y="5" width="20" height="51" rx="3" />
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
  // Display reference only, not a verified game overheating/damage threshold.
  return tempColor(temp, [
    [70, '#2f8fff'],
    [95, '#20f06b'],
    [125, '#20f06b'],
    [135, '#f4e300'],
    [145, '#ff5a1f'],
    [155, '#ff1f2d']
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
