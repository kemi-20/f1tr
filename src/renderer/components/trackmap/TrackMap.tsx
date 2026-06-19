import { useRef, useEffect, useState } from 'react'
import { useRaceStore } from '../../store'
import { getTrack, fmtGap, compoundLabel } from '@shared/index'

/**
 * TrackMap — the visual centerpiece.
 *
 * If we have a track shape: render the SVG path and place car dots precisely along it
 * via getPointAtLength (point at lapDistancePct * pathLength). Player gets a pulsing ring.
 *
 * Always shows a sector-progress strip + the running order of cars around the player,
 * so even with an unknown track there's something useful on screen.
 */
export function TrackMap(): React.ReactElement {
  const race = useRaceStore((s) => s.race)
  const trackId = race?.session.trackId ?? -1
  const track = getTrack(trackId)
  const positions = race?.trackPositions ?? []
  const pathRef = useRef<SVGPathElement>(null)
  const [pathLen, setPathLen] = useState(0)

  useEffect(() => {
    if (pathRef.current) setPathLen(pathRef.current.getTotalLength())
  }, [track?.path])

  // point at fraction t along the path
  const pointAt = (t: number): { x: number; y: number } | null => {
    if (!pathLen || !pathRef.current) return null
    const clamped = Math.max(0, Math.min(1, t))
    try {
      const p = pathRef.current.getPointAtLength(clamped * pathLen)
      return { x: p.x, y: p.y }
    } catch {
      return null
    }
  }

  const rivals = race ? Object.values(race.rivals) : []
  const playerPos = race?.player.position ?? 0
  // sorted by position, window around player
  const sorted = [...rivals].sort((a, b) => a.position - b.position)
  const start = Math.max(0, sorted.findIndex((r) => r.position === playerPos) - 2)
  const window = sorted.slice(start, start + 6)

  return (
    <div className="glass relative flex h-full flex-col p-4">
      <div className="mb-1 flex items-center justify-between">
        <span className="label">{track?.name ?? race?.session.trackName ?? 'Track'}</span>
        <span className="text-[9px] text-white/30">{track?.country}</span>
      </div>

      {/* track shape */}
      <div className="relative flex-1">
        <svg viewBox="0 0 100 100" className="h-full w-full" preserveAspectRatio="xMidYMid meet">
          {track ? (
            <>
              <path ref={pathRef} d={track.path} fill="none" stroke="rgba(45,212,191,0.1)" strokeWidth="7" strokeLinejoin="round" strokeLinecap="round" />
              <path d={track.path} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
              {/* start/finish line marker */}
              {pointAt(0) && (
                <line
                  x1={pointAt(0)!.x - 3} y1={pointAt(0)!.y - 3}
                  x2={pointAt(0)!.x + 3} y2={pointAt(0)!.y + 3}
                  stroke="#FF6A00" strokeWidth="1.5"
                />
              )}
              {/* cars on the path */}
              {positions.map((p) => {
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
            </>
          ) : (
            // unknown track — a full-lap ring with car dots positioned by lapDistancePct
            <>
              <circle cx="50" cy="50" r="38" fill="none" stroke="rgba(45,212,191,0.1)" strokeWidth="7" />
              <circle cx="50" cy="50" r="38" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="3" strokeDasharray="4 3" />
              {positions.map((p) => {
                const a = p.lapDistancePct * 2 * Math.PI - Math.PI / 2
                const cx = 50 + Math.cos(a) * 38
                const cy = 50 + Math.sin(a) * 38
                return (
                  <circle key={p.carIndex} cx={cx} cy={cy} r={p.isPlayer ? 2.2 : 1.5} fill={p.isPlayer ? '#2DD4BF' : 'rgba(255,255,255,0.7)'} />
                )
              })}
            </>
          )}
        </svg>
        <div className="absolute bottom-1 right-2 text-[8px] text-white/25">
          {race?.weather.isRaining ? '🌧 wet' : '☀ dry'} · {Math.round(race?.weather.trackTempC ?? 0)}°
        </div>
      </div>

      {/* running order around player — always present, informative */}
      <div className="mt-2 border-t border-white/[0.05] pt-2">
        <div className="mb-1 label">Track order</div>
        <div className="flex flex-col gap-0.5">
          {window.length === 0 && <div className="text-[10px] text-white/25">等待车手数据…</div>}
          {window.map((r) => {
            const isP = r.position === playerPos
            return (
              <div key={r.carIndex} className={`flex items-center gap-2 rounded px-1.5 py-0.5 text-[10px] ${isP ? 'bg-accent-carbon/10' : ''}`}>
                <span className="num-mono w-5 text-white/50">{r.position}</span>
                <span className="w-20 truncate text-white/70">{r.name || `car${r.carIndex}`}</span>
                <span className="num-mono w-14 text-right text-white/40">{fmtGap(r.deltaToCarInFrontS)}</span>
                <span className="text-white/30">{compoundLabel(r.tyreCompound)}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
