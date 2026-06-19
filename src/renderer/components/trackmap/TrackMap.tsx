import { useEffect, useRef, useState, useCallback } from 'react'
import { useRaceStore } from '../../store'
import { getTrack, fmtGap, compoundLabel } from '@shared/index'
import { loadTrackSvg } from './trackSvgLoader'

/**
 * TrackMap — renders the real track SVG (with all transforms intact) via
 * innerHTML, then overlays car dots positioned via lapDistancePct.
 * Falls back to a progress-ring if the SVG isn't available.
 */
export function TrackMap(): React.ReactElement {
  const race = useRaceStore((s) => s.race)
  const trackId = race?.session.trackId ?? -1
  const track = getTrack(trackId)
  const positions = race?.trackPositions ?? []
  const [svgContent, setSvgContent] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [trackPathEl, setTrackPathEl] = useState<SVGPathElement | null>(null)

  // Load SVG when trackId changes
  useEffect(() => {
    if (trackId < 0) return
    void loadTrackSvg(trackId).then((svg) => {
      setSvgContent(svg)
    })
  }, [trackId])

  // After SVG is injected, find the main track path for getPointAtLength
  useEffect(() => {
    if (!svgContent || !containerRef.current) return
    const svg = containerRef.current.querySelector('svg')
    if (!svg) return
    // Set viewBox to 0 0 100 100 and make it fill the container
    svg.setAttribute('viewBox', '0 0 100 100')
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
    svg.setAttribute('width', '100%')
    svg.setAttribute('height', '100%')
    // Find the longest <path> — that's the track outline
    const paths = svg.querySelectorAll('path')
    let longest: SVGPathElement | null = null
    let maxLen = 0
    paths.forEach((p) => {
      let len = 0
      try { len = p.getTotalLength() } catch { return }
      if (len > maxLen) { maxLen = len; longest = p }
    })
    if (longest) {
      setTrackPathEl(longest)
    }
  }, [svgContent])

  const pointAt = useCallback((t: number): { x: number; y: number } | null => {
    if (!trackPathEl) return null
    try {
      const len = trackPathEl.getTotalLength()
      const p = trackPathEl.getPointAtLength(Math.max(0, Math.min(1, t)) * len)
      // coords are in the SVG's local viewBox — need to check if they're 0-100
      return { x: p.x, y: p.y }
    } catch {
      return null
    }
  }, [trackPathEl])

  const rivals = race ? Object.values(race.rivals) : []
  const playerPos = race?.player.position ?? 0
  const sorted = [...rivals].sort((a, b) => a.position - b.position)
  const start = Math.max(0, sorted.findIndex((r) => r.position === playerPos) - 2)
  const raceWindow = sorted.slice(start, start + 6)

  return (
    <div className="glass relative flex h-full flex-col p-4">
      <div className="mb-1 flex items-center justify-between">
        <span className="label">{track?.name ?? race?.session.trackName ?? 'Track'}</span>
        <span className="text-[9px] text-white/30">{track?.country}</span>
      </div>

      {/* track SVG + car dots overlay */}
      <div className="relative flex-1">
        <svg viewBox="0 0 100 100" className="h-full w-full" preserveAspectRatio="xMidYMid meet">
          {/* Render the track SVG inside this viewBox via a nested svg or transform */}
          {svgContent ? (
            <g dangerouslySetInnerHTML={{ __html: extractSvgInner(svgContent) }} />
          ) : (
            // fallback ring
            <>
              <circle cx="50" cy="50" r="38" fill="none" stroke="rgba(45,212,191,0.15)" strokeWidth="7" />
              <circle cx="50" cy="50" r="38" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="3" strokeDasharray="4 3" />
            </>
          )}

          {/* car dots — positioned on the track path */}
          {trackPathEl && positions.map((p) => {
            const pt = pointAt(p.lapDistancePct)
            if (!pt) return null
            const isP = p.isPlayer
            return (
              <g key={p.carIndex}>
                {isP && (
                  <circle cx={pt.x} cy={pt.y} r="3.5" fill="none" stroke="#2DD4BF" strokeWidth="0.8">
                    <animate attributeName="r" values="2.5;5;2.5" dur="1.6s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.9;0;0.9" dur="1.6s" repeatCount="indefinite" />
                  </circle>
                )}
                <circle cx={pt.x} cy={pt.y} r={isP ? 2.2 : 1.5} fill={isP ? '#2DD4BF' : 'rgba(255,255,255,0.7)'} />
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

/** Extract the inner content of an SVG file (strip the outer <svg> tag). */
function extractSvgInner(svgContent: string): string {
  // remove XML declaration and outer <svg> tag
  let inner = svgContent.replace(/<\?xml[^>]*\?>/, '')
  const match = inner.match(/<svg[^>]*>([\s\S]*)<\/svg>/)
  if (match) {
    return match[1]
  }
  return inner
}
