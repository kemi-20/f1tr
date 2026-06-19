import { useEffect, useRef, useState, useCallback } from 'react'
import { useRaceStore } from '../../store'
import { getTrack, fmtGap, compoundLabel } from '@shared/index'

/**
 * TrackMap — renders a normalized track path and places car dots along it.
 * Full source SVGs are kept as assets, but the live panel only draws the track
 * outline so embedded white backgrounds/labels never cover the cockpit UI.
 */
export function TrackMap(): React.ReactElement {
  const race = useRaceStore((s) => s.race)
  const trackId = race?.session.trackId ?? -1
  const track = getTrack(trackId)
  const positions = race?.trackPositions ?? []
  const pathRef = useRef<SVGPathElement>(null)
  const [pathLen, setPathLen] = useState(0)

  useEffect(() => {
    setPathLen(0)
    if (!pathRef.current) return
    try {
      setPathLen(pathRef.current.getTotalLength())
    } catch {
      setPathLen(0)
    }
  }, [track?.path])

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
  const hasTrackPath = Boolean(track && pathLen)

  return (
    <div className="glass relative flex h-full flex-col p-4">
      <div className="mb-1 flex items-center justify-between">
        <span className="label">{track?.name ?? race?.session.trackName ?? 'Track'}</span>
        <span className="text-[9px] text-white/30">{track?.country}</span>
      </div>

      {/* track SVG + car dots overlay */}
      <div className="relative flex-1">
        <svg viewBox="0 0 100 100" className="h-full w-full" preserveAspectRatio="xMidYMid meet">
          {track ? (
            <>
              <path ref={pathRef} d={track.path} fill="none" stroke="rgba(45,212,191,0.12)" strokeWidth="7" strokeLinejoin="round" strokeLinecap="round" />
              <path d={track.path} fill="none" stroke="rgba(255,255,255,0.26)" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
              {pointAt(0) && (
                <line
                  x1={pointAt(0)!.x - 3} y1={pointAt(0)!.y - 3}
                  x2={pointAt(0)!.x + 3} y2={pointAt(0)!.y + 3}
                  stroke="#FF6A00" strokeWidth="1.5"
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

function fallbackPointAt(t: number): { x: number; y: number } {
  const a = Math.max(0, Math.min(1, t)) * 2 * Math.PI - Math.PI / 2
  return { x: 50 + Math.cos(a) * 38, y: 50 + Math.sin(a) * 38 }
}
