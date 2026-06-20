import { useMemo } from 'react'
import { useRaceStore } from '../../store'
import { getTrack } from '@shared/index'
import { CALIBRATED_TRACK_MAPS, type CalibratedTrackMap, type TrackBounds, type TrackPoint } from './trackMapAssets'

/**
 * TrackMap renders calibrated F1 world-coordinate map data. Car dots use Motion
 * packet worldX/worldZ directly; lap-distance interpolation is only a startup
 * fallback before Motion arrives.
 */
export function TrackMap(): React.ReactElement {
  const race = useRaceStore((s) => s.race)
  const trackId = race?.session.trackId ?? -1
  const track = getTrack(trackId)
  const positions = race?.trackPositions ?? []
  const trackMap = CALIBRATED_TRACK_MAPS[trackId]
  const geometry = useMemo(() => (trackMap ? buildGeometry(trackMap) : null), [trackMap])
  const marker = geometry ? markerSize(geometry.bounds) : 1

  return (
    <div className="glass relative flex h-full flex-col p-4">
      <div className="mb-1 flex items-center justify-between">
        <span className="label">{track?.name ?? race?.session.trackName ?? 'Track'}</span>
        <span className="text-[9px] text-white/30">{track?.country}</span>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {geometry ? (
          <svg viewBox={geometry.viewBox} className="absolute inset-0 block h-full w-full" preserveAspectRatio="xMidYMid meet">
            <g>
              <polyline
                points={geometry.fusedPoints}
                fill="none"
                stroke="rgba(45,212,191,0.18)"
                strokeWidth={marker * 2.6}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              <polyline
                points={geometry.fusedPoints}
                fill="none"
                stroke="rgba(245,247,250,0.88)"
                strokeWidth={marker * 1.05}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {geometry.pitPoints && (
                <polyline
                  points={geometry.pitPoints}
                  fill="none"
                  stroke="rgba(255,255,255,0.24)"
                  strokeWidth={marker * 0.48}
                  strokeDasharray={`${marker * 0.9} ${marker * 0.75}`}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              )}
              {geometry.sectorPoints.map((line, idx) => (
                <polyline
                  key={idx}
                  points={line}
                  fill="none"
                  stroke={SECTOR_STROKES[idx]}
                  strokeWidth={marker * 0.42}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              ))}
              <line
                x1={geometry.start.x - marker * 1.5}
                y1={geometry.start.y - marker * 1.5}
                x2={geometry.start.x + marker * 1.5}
                y2={geometry.start.y + marker * 1.5}
                stroke="#FF6A00"
                strokeWidth={marker * 0.45}
                strokeLinecap="round"
              />
            </g>

            {positions.map((p) => {
              const pt = pointForPosition(p, geometry)
              if (!pt) return null
              const isP = p.isPlayer
              const colour = teamColorForCar(race?.rivals[p.carIndex]?.team)
              return (
                <g key={p.carIndex}>
                  {isP && (
                    <>
                      <circle cx={pt.x} cy={pt.y} r={marker * 2.9} fill="none" stroke="#FFE600" strokeWidth={marker * 0.32}>
                        <animate attributeName="r" values={`${marker * 2.4};${marker * 3.7};${marker * 2.4}`} dur="1.4s" repeatCount="indefinite" />
                        <animate attributeName="opacity" values="1;0.25;1" dur="1.4s" repeatCount="indefinite" />
                      </circle>
                      <circle cx={pt.x} cy={pt.y} r={marker * 2.05} fill="none" stroke="#FFE600" strokeWidth={marker * 0.34} />
                    </>
                  )}
                  <circle cx={pt.x} cy={pt.y} r={isP ? marker * 1.62 : marker * 1.2} fill={colour} stroke="rgba(0,0,0,0.95)" strokeWidth={marker * 0.42} />
                  <circle cx={pt.x - marker * 0.3} cy={pt.y - marker * 0.3} r={marker * 0.28} fill="rgba(255,255,255,0.65)">
                    {isP && (
                      <animate attributeName="opacity" values="0.9;0;0.9" dur="1.6s" repeatCount="indefinite" />
                    )}
                  </circle>
                </g>
              )
            })}
          </svg>
        ) : (
          <svg viewBox="0 0 100 100" className="absolute inset-0 block h-full w-full" preserveAspectRatio="xMidYMid meet">
            <circle cx="50" cy="50" r="38" fill="none" stroke="rgba(45,212,191,0.15)" strokeWidth="7" />
            <circle cx="50" cy="50" r="38" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="3" strokeDasharray="4 3" />
            {positions.map((p) => {
              const pt = fallbackPointAt(p.lapDistancePct)
              const colour = teamColorForCar(race?.rivals[p.carIndex]?.team)
              return (
                <g key={p.carIndex}>
                  {p.isPlayer && <circle cx={pt.x} cy={pt.y} r="4.4" fill="none" stroke="#FFE600" strokeWidth="0.9" />}
                  <circle cx={pt.x} cy={pt.y} r={p.isPlayer ? 2.7 : 2.1} fill={colour} stroke="rgba(0,0,0,0.95)" strokeWidth="0.9" />
                </g>
              )
            })}
          </svg>
        )}
        <div className="absolute bottom-1 right-2 text-[8px] text-white/25">
          {race?.weather.isRaining ? 'wet' : 'dry'} · {Math.round(race?.weather.trackTempC ?? 0)}°
        </div>
      </div>
    </div>
  )
}

interface TrackGeometry {
  bounds: TrackBounds
  viewBox: string
  fused: TrackPoint[]
  cumulative: number[]
  totalLength: number
  fusedPoints: string
  pitPoints: string | null
  sectorPoints: string[]
  start: { x: number; y: number }
}

const SECTOR_STROKES = [
  'rgba(56,189,248,0.44)',
  'rgba(168,85,247,0.42)',
  'rgba(34,197,94,0.42)'
] as const

function buildGeometry(trackMap: CalibratedTrackMap): TrackGeometry {
  const cumulative = cumulativeDistances(trackMap.fusedLine)
  const totalLength = cumulative[cumulative.length - 1] ?? 0
  return {
    bounds: trackMap.bounds,
    viewBox: viewBoxWithTrackMargin(trackMap.bounds),
    fused: trackMap.fusedLine,
    cumulative,
    totalLength,
    fusedPoints: pointsAttr(trackMap.fusedLine),
    pitPoints: trackMap.pitLine?.length ? pointsAttr(trackMap.pitLine) : null,
    sectorPoints: [trackMap.sector1Line, trackMap.sector2Line, trackMap.sector3Line]
      .filter((line): line is TrackPoint[] => Boolean(line?.length))
      .map(pointsAttr),
    start: point(trackMap.fusedLine[0] ?? [0, 0])
  }
}

function pointForPosition(
  p: { lapDistancePct: number; worldX?: number; worldZ?: number },
  geometry: TrackGeometry
): { x: number; y: number } | null {
  if (isFiniteNumber(p.worldX) && isFiniteNumber(p.worldZ) && withinExpandedBounds(p.worldX, p.worldZ, geometry.bounds)) {
    return { x: p.worldX, y: p.worldZ }
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

function viewBoxWithTrackMargin(bounds: TrackBounds): string {
  const [minX, minY, maxX, maxY] = bounds
  const width = maxX - minX
  const height = maxY - minY
  const padX = Math.max(55, width * 0.1)
  const padY = Math.max(55, height * 0.1)
  return `${minX - padX} ${minY - padY} ${width + padX * 2} ${height + padY * 2}`
}

function markerSize(bounds: TrackBounds): number {
  const [, , maxX, maxY] = bounds
  const [minX, minY] = bounds
  return Math.max(4.2, Math.min(maxX - minX, maxY - minY) * 0.011)
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

const TEAM_COLOURS: Record<number, string> = {
  0: '#00D2BE',
  1: '#DC0000',
  2: '#0600EF',
  3: '#005AFF',
  4: '#006F62',
  5: '#0090FF',
  6: '#2B4562',
  7: '#FFFFFF',
  8: '#FF8700',
  9: '#900000',
  41: '#FFFFFF',
  104: '#FFFFFF',
  129: '#00D2BE',
  142: '#FFFFFF',
  154: '#FFFFFF',
  155: '#00D2BE',
  185: '#00D2BE',
  186: '#DC0000',
  187: '#0600EF',
  188: '#005AFF',
  189: '#006F62',
  190: '#0090FF',
  191: '#2B4562',
  192: '#FFFFFF',
  193: '#FF8700',
  194: '#900000'
}

function teamColorForCar(teamId: string | undefined): string {
  const id = Number(teamId)
  return Number.isFinite(id) ? TEAM_COLOURS[id] ?? '#E6EDF6' : '#E6EDF6'
}
