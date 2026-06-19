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
  const [pathLen, setPathLen] = useState(0)
  const trackSvg = useMemo(() => parseTrackSvg(TRACK_SVG_RAW[trackId]), [trackId])

  useEffect(() => {
    setPathLen(0)
    if (!pathRef.current) return
    try {
      setPathLen(pathRef.current.getTotalLength())
    } catch {
      setPathLen(0)
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
            const pt = hasTrackPath ? pointAt(p.lapDistancePct) : fallbackPointAt(p.lapDistancePct)
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

function fallbackPointAt(t: number): { x: number; y: number } {
  const a = Math.max(0, Math.min(1, t)) * 2 * Math.PI - Math.PI / 2
  return { x: 50 + Math.cos(a) * 38, y: 50 + Math.sin(a) * 38 }
}
