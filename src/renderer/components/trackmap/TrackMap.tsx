import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { MapPin } from 'lucide-react'
import { useRaceStore, usePositionStore, useConfigStore } from '../../store'
import { getTrack } from '@shared/index'
import { CALIBRATED_TRACK_MAPS, type CalibratedTrackMap, type TrackBounds, type TrackPoint } from './trackMapAssets'
import { teamColorForCar } from '../rivals/teamMeta'

/**
 * TrackMap renders calibrated F1 world-coordinate map data. Car dots use Motion
 * packet worldX/worldZ directly; lap-distance interpolation is only a startup
 * fallback before Motion arrives.
 */
export function TrackMap(): React.ReactElement {
  const race = useRaceStore((s) => s.race)
  const pitwall = useConfigStore((s) => s.config?.ui.style === 'pitwall')
  const reduceMotion = useConfigStore((s) => s.config?.ui.reduceMotion ?? false)
  const [systemReduced, setSystemReduced] = useState(false)
  const finishId = useId().replace(/:/g, '')
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = (): void => setSystemReduced(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  const trackId = race?.session.trackId ?? -1
  const track = getTrack(trackId)
  const livePositions = usePositionStore(s => s.positions)
  const positions = livePositions?.sessionUID === race?.session.sessionUID && livePositions?.trackId === trackId
    ? livePositions.positions : race?.trackPositions ?? []
  const trackMap = CALIBRATED_TRACK_MAPS[trackId]
  const viewport = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 600, height: 360 })
  useEffect(() => {
    const element = viewport.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0) setSize({ width, height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const geometry = useMemo(() => (trackMap ? buildGeometry(trackMap, size) : null), [trackMap, size])
  const marker = geometry?.marker ?? 1

  return (
    <section className="glass trackmap-panel relative flex h-full flex-col p-4" aria-label="赛道位置">
      <div className={pitwall ? 'pitwall-section-heading trackmap-heading' : 'mb-1 flex items-center justify-between'}>
        {pitwall ? <h2>TRACK POSITION <span>{track?.name ?? race?.session.trackName ?? '--'}</span></h2> : <span className="label">{track?.name ?? race?.session.trackName ?? 'Track'}</span>}
        <span className="trackmap-country text-[9px] text-white/30">{track?.country}</span>
      </div>

      <div ref={viewport} className="relative min-h-0 flex-1 overflow-hidden">
        {geometry ? (
          <svg viewBox={geometry.viewBox} className="absolute inset-0 block h-full w-full" preserveAspectRatio="xMidYMid meet">
            <defs><pattern id={finishId} width={marker * 0.7} height={marker * 0.7} patternUnits="userSpaceOnUse"><rect width={marker * 0.7} height={marker * 0.7} fill="#fff" /><rect width={marker * 0.35} height={marker * 0.35} fill="#101113" /><rect x={marker * 0.35} y={marker * 0.35} width={marker * 0.35} height={marker * 0.35} fill="#101113" /></pattern></defs>
            <g>
              <polyline
                points={geometry.fusedPoints}
                fill="none"
                stroke="rgba(6,12,18,0.96)"
                strokeWidth={marker * 2.7}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              <polyline
                points={geometry.fusedPoints}
                fill="none"
                stroke="rgba(250,252,255,0.98)"
                strokeWidth={marker * 1.95}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {geometry.pitPoints && (
                <polyline
                  points={geometry.pitPoints}
                  fill="none"
                  stroke="rgba(255,255,255,0.58)"
                  strokeWidth={marker * 0.6}
                  strokeDasharray={`${marker * 0.9} ${marker * 0.75}`}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              )}
              {geometry.sectorPoints.map((line, idx) => (
                <polyline
                  key={idx}
                  className="trackmap-sector"
                  points={line}
                  fill="none"
                  stroke={SECTOR_STROKES[idx]}
                  strokeWidth={marker * 1.15}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              ))}
              {pitwall ? <rect x={geometry.start.x - marker * 2} y={geometry.start.y - marker * 0.65} width={marker * 4} height={marker * 1.3}
                fill={`url(#${finishId})`} transform={`rotate(${geometry.startAngle} ${geometry.start.x} ${geometry.start.y})`} /> : <line
                x1={geometry.start.x - marker * 1.5}
                y1={geometry.start.y - marker * 1.5}
                x2={geometry.start.x + marker * 1.5}
                y2={geometry.start.y + marker * 1.5}
                stroke="#FF6A00"
                strokeWidth={marker * 0.45}
                strokeLinecap="round"
              />}
            </g>

            {[...positions].sort((a, b) => Number(a.isPlayer) - Number(b.isPlayer)).map((p) => {
              const pt = pointForPosition(p, geometry)
              if (!pt) return null
              const isP = p.isPlayer
              const rival = race?.rivals[p.carIndex]
              const colour = teamColorForCar(rival?.team, rival?.teamColor)
              return (
                <g key={`${race?.session.sessionUID}:${p.carIndex}`} style={{
                  transform: `translate(${pt.x}px, ${pt.y}px)`,
                  transition: livePositions?.flashbackActive || reduceMotion || systemReduced ? 'none' : 'transform 50ms linear'
                }}>
                  <title>{rival?.name || `Car ${p.carIndex + 1}`}{isP ? ' · YOUR CAR' : ''}{rival?.position ? ` · P${rival.position}` : ''}</title>
                  {isP && (
                    <>
                      <circle r={marker * 3.5} fill="none" stroke="#FFE600" strokeWidth={marker * 0.38}>
                        {!pitwall && !reduceMotion && !systemReduced && <>
                          <animate attributeName="r" values={`${marker * 2.9};${marker * 4.3};${marker * 2.9}`} dur="1.4s" repeatCount="indefinite" />
                          <animate attributeName="opacity" values="1;0.25;1" dur="1.4s" repeatCount="indefinite" />
                        </>}
                      </circle>
                      <circle r={marker * 2.6} fill="none" stroke="#FFE600" strokeWidth={marker * 0.42} />
                    </>
                  )}
                  <circle r={isP ? marker * 2.05 : marker * 1.6} fill={colour} stroke="#071017" strokeWidth={marker * 0.55} />
                </g>
              )
            })}
          </svg>
        ) : pitwall ? (
          <div className="trackmap-empty"><MapPin size={32} /><strong>{race ? '赛道地图不可用' : '等待赛道数据'}</strong><span>{race ? race.session.trackName : 'F1 25 / 26'}</span></div>
        ) : (
          <svg viewBox="0 0 100 100" className="absolute inset-0 block h-full w-full" preserveAspectRatio="xMidYMid meet">
            <circle cx="50" cy="50" r="38" fill="none" stroke="rgba(45,212,191,0.15)" strokeWidth="7" />
            <circle cx="50" cy="50" r="38" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="3" strokeDasharray="4 3" />
            {positions.map((p) => {
              const pt = fallbackPointAt(p.lapDistancePct)
              const rival = race?.rivals[p.carIndex]
              const colour = teamColorForCar(rival?.team, rival?.teamColor)
              return (
                <g key={p.carIndex}>
                  {p.isPlayer && <circle cx={pt.x} cy={pt.y} r="5.4" fill="none" stroke="#FFE600" strokeWidth="1.1" />}
                  <circle cx={pt.x} cy={pt.y} r={p.isPlayer ? 3.3 : 2.7} fill={colour} stroke="#071017" strokeWidth="1" />
                </g>
              )
            })}
          </svg>
        )}
        <div className="trackmap-weather absolute bottom-1 right-2 text-[8px] text-white/25">
          {race ? `${race.weather.isRaining ? 'WET' : 'DRY'} · ${Math.round(race.weather.trackTempC)}°` : '--'}
        </div>
      </div>
      {pitwall && <footer className="trackmap-legend"><span><i className="legend-player" />YOUR CAR</span><span><i className="legend-team" />TEAM COLOUR</span><span className="legend-sector">S1 <b /> S2 <b /> S3 <b /></span><span>PIT LANE <i className="legend-pit" /></span></footer>}
    </section>
  )
}

interface TrackGeometry {
  marker: number
  bounds: TrackBounds
  sourceBounds: TrackBounds
  sourceFused: TrackPoint[]
  project: (p: TrackPoint) => TrackPoint
  viewBox: string
  fused: TrackPoint[]
  cumulative: number[]
  totalLength: number
  fusedPoints: string
  pitPoints: string | null
  sectorPoints: string[]
  start: { x: number; y: number }
  startAngle: number
}

const SECTOR_STROKES = [
  'rgba(56,189,248,0.44)',
  'rgba(168,85,247,0.42)',
  'rgba(34,197,94,0.42)'
] as const

function buildGeometry(trackMap: CalibratedTrackMap, size: { width: number; height: number }): TrackGeometry {
  const project = displayProjection(trackMap, size)
  const fused = trackMap.fusedLine.map(project)
  const bounds = lineBounds([...fused, ...(trackMap.pitLine ?? []).map(project)])
  // Reserve screen-space room for the player halo, independent of track length.
  const scale = Math.min(Math.max(1, size.width - 40) / Math.max(1, bounds[2] - bounds[0]), Math.max(1, size.height - 40) / Math.max(1, bounds[3] - bounds[1]))
  const marker = 4 / scale
  const padding = 20 / scale
  const cumulative = cumulativeDistances(fused)
  const totalLength = cumulative[cumulative.length - 1] ?? 0
  return {
    marker,
    bounds,
    sourceBounds: trackMap.bounds,
    sourceFused: trackMap.fusedLine,
    project,
    viewBox: `${bounds[0] - padding} ${bounds[1] - padding} ${bounds[2] - bounds[0] + padding * 2} ${bounds[3] - bounds[1] + padding * 2}`,
    fused,
    cumulative,
    totalLength,
    fusedPoints: pointsAttr(fused),
    pitPoints: trackMap.pitLine?.length ? pointsAttr(trackMap.pitLine.map(project)) : null,
    sectorPoints: [trackMap.sector1Line, trackMap.sector2Line, trackMap.sector3Line]
      .filter((line): line is TrackPoint[] => Boolean(line?.length))
      .map(line => pointsAttr(line.map(project))),
    start: point(fused[0] ?? [0, 0]),
    startAngle: fused.length > 1 ? Math.atan2(fused[1][1] - fused[0][1], fused[1][0] - fused[0][0]) * 180 / Math.PI + 90 : 0
  }
}

function displayProjection(trackMap: CalibratedTrackMap, size: { width: number; height: number }): (p: TrackPoint) => TrackPoint {
  const [minX, minY, maxX, maxY] = trackMap.bounds
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const lines = [...trackMap.fusedLine, ...(trackMap.pitLine ?? [])]
  let bestScale = 0
  let bestProject = (p: TrackPoint): TrackPoint => p
  // Rotation only: preserve shape and use the identical transform for live cars.
  for (let degrees = -90; degrees <= 90; degrees += 3) {
    const angle = degrees * Math.PI / 180
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const project = ([x, y]: TrackPoint): TrackPoint => [cos * (x - cx) - sin * (y - cy), sin * (x - cx) + cos * (y - cy)]
    const bounds = lineBounds(lines.map(project))
    const scale = Math.min(Math.max(1, size.width - 40) / Math.max(1, bounds[2] - bounds[0]), Math.max(1, size.height - 40) / Math.max(1, bounds[3] - bounds[1]))
    if (scale > bestScale * 1.005) {
      bestScale = scale
      bestProject = project
    }
  }
  return bestProject
}

function lineBounds(points: TrackPoint[]): TrackBounds {
  return [
    Math.min(...points.map(p => p[0])),
    Math.min(...points.map(p => p[1])),
    Math.max(...points.map(p => p[0])),
    Math.max(...points.map(p => p[1]))
  ]
}

function pointForPosition(
  p: { lapDistancePct: number; worldX?: number; worldZ?: number; motionUpdatedAt?: number },
  geometry: TrackGeometry
): { x: number; y: number } | null {
  if (
    p.motionUpdatedAt != null && Date.now() - p.motionUpdatedAt >= 0 && Date.now() - p.motionUpdatedAt <= 2000 &&
    isFiniteNumber(p.worldX) &&
    isFiniteNumber(p.worldZ) &&
    withinExpandedBounds(p.worldX, p.worldZ, geometry.sourceBounds) &&
    isNearTrackLine(p.worldX, p.worldZ, geometry)
  ) {
    return point(geometry.project([p.worldX, p.worldZ]))
  }
  return pointAtLapFraction(geometry, p.lapDistancePct)
}

function pointAtLapFraction(geometry: TrackGeometry, lapDistancePct: number): { x: number; y: number } | null {
  if (geometry.fused.length === 0 || geometry.totalLength <= 0) return null
  const target = clamp01(lapDistancePct) * geometry.totalLength
  let lo = 0
  let hi = geometry.cumulative.length - 1
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (geometry.cumulative[mid] < target) lo = mid + 1
    else hi = mid
  }
  const idx = Math.max(1, lo)
  const prevLen = geometry.cumulative[idx - 1] ?? 0
  const nextLen = geometry.cumulative[idx] ?? prevLen
  const a = geometry.fused[idx - 1] ?? geometry.fused[0]
  const b = geometry.fused[idx] ?? a
  const t = nextLen > prevLen ? (target - prevLen) / (nextLen - prevLen) : 0
  return {
    x: a[0] + (b[0] - a[0]) * t,
    y: a[1] + (b[1] - a[1]) * t
  }
}

function cumulativeDistances(points: TrackPoint[]): number[] {
  const distances: number[] = []
  let total = 0
  for (let i = 0; i < points.length; i++) {
    if (i > 0) total += distance(points[i - 1], points[i])
    distances.push(total)
  }
  return distances
}

function pointsAttr(points: TrackPoint[]): string {
  return points.map((p) => `${p[0]},${p[1]}`).join(' ')
}

function withinExpandedBounds(x: number, y: number, bounds: TrackBounds): boolean {
  const [minX, minY, maxX, maxY] = bounds
  const padX = (maxX - minX) * 0.18
  const padY = (maxY - minY) * 0.18
  return x >= minX - padX && x <= maxX + padX && y >= minY - padY && y <= maxY + padY
}

function isNearTrackLine(x: number, y: number, geometry: TrackGeometry): boolean {
  if (geometry.fused.length < 2) return false
  const [minX, minY, maxX, maxY] = geometry.sourceBounds
  const shortestSide = Math.min(maxX - minX, maxY - minY)
  const tolerance = Math.max(22, shortestSide * 0.045)
  const toleranceSq = tolerance * tolerance

  for (let i = 1; i < geometry.sourceFused.length; i++) {
    if (distanceToSegmentSq(x, y, geometry.sourceFused[i - 1], geometry.sourceFused[i]) <= toleranceSq) {
      return true
    }
  }
  return false
}

function distanceToSegmentSq(x: number, y: number, a: TrackPoint, b: TrackPoint): number {
  const ax = a[0]
  const ay = a[1]
  const bx = b[0]
  const by = b[1]
  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return (x - ax) * (x - ax) + (y - ay) * (y - ay)
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / lenSq))
  const px = ax + t * dx
  const py = ay + t * dy
  return (x - px) * (x - px) + (y - py) * (y - py)
}

function distance(a: TrackPoint, b: TrackPoint): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1])
}

function point(p: TrackPoint): { x: number; y: number } {
  return { x: p[0], y: p[1] }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function fallbackPointAt(t: number): { x: number; y: number } {
  const a = clamp01(t) * 2 * Math.PI - Math.PI / 2
  return { x: 50 + Math.cos(a) * 38, y: 50 + Math.sin(a) * 38 }
}
