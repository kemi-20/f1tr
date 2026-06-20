import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useRaceStore } from '../../store'
import { getTrack, fmtGap, compoundLabel } from '@shared/index'
import { TRACK_SVG_RAW } from './trackSvgAssets'

/**
 * TrackMap — renders the original high-resolution SVG for each circuit and
 * overlays live car dots in the same SVG coordinate system.
 */
export function TrackMap(): React.ReactElement {
  const race = useRaceStore((s) => s.race)
  const trackId = race?.session.trackId ?? -1
  const track = getTrack(trackId)
  const positions = race?.trackPositions ?? []
  const pathRef = useRef<SVGPathElement>(null)
  const worldBoundsRef = useRef<ObservedWorldBounds>({ trackId: -1 })
  const [pathLen, setPathLen] = useState(0)
  const [pathBox, setPathBox] = useState<Rect | null>(null)
  const trackSvg = useMemo(() => parseTrackSvg(TRACK_SVG_RAW[trackId]), [trackId])

  useEffect(() => {
    setPathLen(0)
    setPathBox(null)
    if (!pathRef.current) return
    try {
      setPathLen(pathRef.current.getTotalLength())
      const box = pathRef.current.getBBox()
      setPathBox({ x: box.x, y: box.y, width: box.width, height: box.height })
    } catch {
      setPathLen(0)
      setPathBox(null)
    }
  }, [trackSvg?.probePath, track?.path])

  const pointAt = useCallback((t: number): { x: number; y: number } | null => {
    if (!pathLen || !pathRef.current) return null
    try {
      const p = pathRef.current.getPointAtLength(Math.max(0, Math.min(1, t)) * pathLen)
      return { x: p.x, y: p.y }
    } catch {
      return null
    }
  }, [pathLen])

  const rivals = race ? Object.values(race.rivals) : []
  const playerPos = race?.player.position ?? 0
  const sorted = [...rivals].sort((a, b) => a.position - b.position)
  const start = Math.max(0, sorted.findIndex((r) => r.position === playerPos) - 2)
  const raceWindow = sorted.slice(start, start + 6)
  const hasTrackPath = Boolean(pathLen && (trackSvg?.probePath || track?.path))
  const viewBox = trackSvg?.viewBox ?? '0 0 100 100'
  const probePath = trackSvg?.probePath ?? track?.path ?? ''
  const marker = markerSize(viewBox)
  const worldProjector = buildWorldProjector(trackId, positions, pathBox, pointAt, worldBoundsRef)

  return (
    <div className="glass relative flex h-full flex-col p-4">
      <div className="mb-1 flex items-center justify-between">
        <span className="label">{track?.name ?? race?.session.trackName ?? 'Track'}</span>
        <span className="text-[9px] text-white/30">{track?.country}</span>
      </div>

      {/* track SVG + car dots overlay */}
      <div className="relative flex-1">
        <svg viewBox={viewBox} className="h-full w-full" preserveAspectRatio="xMidYMid meet">
          {trackSvg ? (
            <>
              <g className="track-svg-original" dangerouslySetInnerHTML={{ __html: trackSvg.inner }} />
              <path ref={pathRef} d={probePath} fill="none" stroke="none" pointerEvents="none" opacity="0" />
            </>
          ) : track ? (
            <>
              <path ref={pathRef} d={probePath} fill="none" stroke="rgba(45,212,191,0.12)" strokeWidth="7" strokeLinejoin="round" strokeLinecap="round" />
              <path d={track.path} fill="none" stroke="rgba(255,255,255,0.26)" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
              {pointAt(0) && (
                <line
                  x1={pointAt(0)!.x - marker * 1.4} y1={pointAt(0)!.y - marker * 1.4}
                  x2={pointAt(0)!.x + marker * 1.4} y2={pointAt(0)!.y + marker * 1.4}
                  stroke="#FF6A00" strokeWidth={marker * 0.5}
                />
              )}
            </>
          ) : (
            <>
              <circle cx="50" cy="50" r="38" fill="none" stroke="rgba(45,212,191,0.15)" strokeWidth="7" />
              <circle cx="50" cy="50" r="38" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="3" strokeDasharray="4 3" />
            </>
          )}

          {/* car dots — positioned on the track path */}
          {positions.map((p) => {
            const pt = worldProjector?.(p) ?? (hasTrackPath ? pointAt(p.lapDistancePct) : fallbackPointAt(p.lapDistancePct))
            if (!pt) return null
            const isP = p.isPlayer
            return (
              <g key={p.carIndex}>
                {isP && (
                  <circle cx={pt.x} cy={pt.y} r={marker * 1.5} fill="none" stroke="#2DD4BF" strokeWidth={marker * 0.3}>
                    <animate attributeName="r" values={`${marker * 1.2};${marker * 2.4};${marker * 1.2}`} dur="1.6s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.9;0;0.9" dur="1.6s" repeatCount="indefinite" />
                  </circle>
                )}
                <circle cx={pt.x} cy={pt.y} r={isP ? marker * 1.1 : marker * 0.75} fill={isP ? '#2DD4BF' : 'rgba(255,255,255,0.7)'} />
              </g>
            )
          })}
        </svg>
        <div className="absolute bottom-1 right-2 text-[8px] text-white/25">
          {race?.weather.isRaining ? '🌧 wet' : '☀ dry'} · {Math.round(race?.weather.trackTempC ?? 0)}°
        </div>
      </div>

      {/* running order */}
      <div className="mt-2 border-t border-white/[0.05] pt-2">
        <div className="mb-1 label">Track order</div>
        <div className="flex flex-col gap-0.5">
          {raceWindow.length === 0 && <div className="text-[10px] text-white/25">等待车手数据…</div>}
          {raceWindow.map((r) => {
            const isP = r.position === playerPos
            return (
              <div key={r.carIndex} className={`flex items-center gap-2 rounded px-1.5 py-0.5 text-[10px] ${isP ? 'bg-accent-carbon/10' : ''}`}>
                <span className="num-mono w-5 text-white/50">{r.position}</span>
                <span className="w-20 truncate text-white/70">{r.name || `car${r.carIndex}`}</span>
                <span className="num-mono w-14 text-right text-white/40">{fmtGap(r.gapToPlayerS)}</span>
                <span className="text-white/30">{compoundLabel(r.tyreCompound)}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

interface ParsedTrackSvg {
  viewBox: string
  inner: string
  probePath: string
}

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

interface ObservedWorldBounds {
  trackId: number
  minX?: number
  maxX?: number
  minZ?: number
  maxZ?: number
}

type Point = { x: number; y: number }
type Projector = (p: { worldX?: number; worldZ?: number }) => Point | null

function parseTrackSvg(raw?: string): ParsedTrackSvg | null {
  if (!raw || typeof DOMParser === 'undefined') return null
  const doc = new DOMParser().parseFromString(raw, 'image/svg+xml')
  const svg = doc.documentElement
  if (!svg || svg.tagName.toLowerCase() !== 'svg') return null

  const viewBox = svg.getAttribute('viewBox') ?? inferViewBox(svg) ?? '0 0 100 100'
  const paths = Array.from(svg.querySelectorAll('path'))
    .map((path) => path.getAttribute('d') ?? '')
    .filter(Boolean)
  return {
    viewBox,
    inner: svg.innerHTML,
    probePath: pickLongestPath(paths)
  }
}

function inferViewBox(svg: Element): string | null {
  const width = parseFloat(svg.getAttribute('width') ?? '')
  const height = parseFloat(svg.getAttribute('height') ?? '')
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? `0 0 ${width} ${height}` : null
}

function pickLongestPath(paths: string[]): string {
  return paths.reduce((best, path) => (path.length > best.length ? path : best), '')
}

function markerSize(viewBox: string): number {
  const [, , w, h] = viewBox.split(/[\s,]+/).map(Number)
  const base = Math.min(w || 100, h || 100)
  return Math.max(0.8, base * 0.009)
}

function buildWorldProjector(
  trackId: number,
  positions: Array<{ lapDistancePct: number; worldX?: number; worldZ?: number }>,
  pathBox: Rect | null,
  pointAt: (t: number) => Point | null,
  boundsRef: React.MutableRefObject<ObservedWorldBounds>
): Projector | null {
  if (!pathBox || pathBox.width <= 0 || pathBox.height <= 0) return null
  if (boundsRef.current.trackId !== trackId) boundsRef.current = { trackId }
  const bounds = boundsRef.current

  for (const p of positions) {
    if (!isFiniteNumber(p.worldX) || !isFiniteNumber(p.worldZ)) continue
    bounds.minX = bounds.minX == null ? p.worldX : Math.min(bounds.minX, p.worldX)
    bounds.maxX = bounds.maxX == null ? p.worldX : Math.max(bounds.maxX, p.worldX)
    bounds.minZ = bounds.minZ == null ? p.worldZ : Math.min(bounds.minZ, p.worldZ)
    bounds.maxZ = bounds.maxZ == null ? p.worldZ : Math.max(bounds.maxZ, p.worldZ)
  }

  if (!isFiniteNumber(bounds.minX) || !isFiniteNumber(bounds.maxX) || !isFiniteNumber(bounds.minZ) || !isFiniteNumber(bounds.maxZ)) return null
  const worldWidth = bounds.maxX - bounds.minX
  const worldDepth = bounds.maxZ - bounds.minZ
  if (worldWidth < 20 || worldDepth < 20) return null

  const calibratedBounds: Required<ObservedWorldBounds> = {
    trackId: bounds.trackId,
    minX: bounds.minX,
    maxX: bounds.maxX,
    minZ: bounds.minZ,
    maxZ: bounds.maxZ
  }
  const candidates = makeProjectors(calibratedBounds, pathBox)
  const scored = candidates
    .map((project) => ({ project, score: scoreProjector(project, positions, pointAt) }))
    .filter((x) => Number.isFinite(x.score))
    .sort((a, b) => a.score - b.score)
  return scored[0]?.project ?? candidates[0] ?? null
}

function makeProjectors(bounds: Required<ObservedWorldBounds>, box: Rect): Projector[] {
  const variants: Projector[] = []
  for (const swap of [false, true]) {
    for (const invertX of [false, true]) {
      for (const invertY of [false, true]) {
        variants.push((p) => {
          if (!isFiniteNumber(p.worldX) || !isFiniteNumber(p.worldZ)) return null
          const axisX = swap ? p.worldZ : p.worldX
          const axisY = swap ? p.worldX : p.worldZ
          const minX = swap ? bounds.minZ : bounds.minX
          const maxX = swap ? bounds.maxZ : bounds.maxX
          const minY = swap ? bounds.minX : bounds.minZ
          const maxY = swap ? bounds.maxX : bounds.maxZ
          return {
            x: mapAxis(axisX, minX, maxX, box.x, box.x + box.width, invertX),
            y: mapAxis(axisY, minY, maxY, box.y, box.y + box.height, invertY)
          }
        })
      }
    }
  }
  return variants
}

function scoreProjector(
  project: Projector,
  positions: Array<{ lapDistancePct: number; worldX?: number; worldZ?: number }>,
  pointAt: (t: number) => Point | null
): number {
  let score = 0
  let count = 0
  for (const p of positions) {
    const projected = project(p)
    const expected = pointAt(p.lapDistancePct)
    if (!projected || !expected) continue
    const dx = projected.x - expected.x
    const dy = projected.y - expected.y
    score += dx * dx + dy * dy
    count++
  }
  return count >= 3 ? score / count : Infinity
}

function mapAxis(v: number, inMin: number, inMax: number, outMin: number, outMax: number, invert: boolean): number {
  const t = (v - inMin) / Math.max(1e-6, inMax - inMin)
  const u = invert ? 1 - t : t
  return outMin + u * (outMax - outMin)
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function fallbackPointAt(t: number): { x: number; y: number } {
  const a = Math.max(0, Math.min(1, t)) * 2 * Math.PI - Math.PI / 2
  return { x: 50 + Math.cos(a) * 38, y: 50 + Math.sin(a) * 38 }
}
