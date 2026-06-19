import { useRaceStore } from '../../store'
import { getTrack } from '@shared/index'

/**
 * SVG track map — the visual centerpiece.
 * Car dots positioned by lapDistancePct along the path (approx via point sampling).
 * Player dot gets a pulsing accent ring. Unknown track falls back to a linear ribbon.
 */
export function TrackMap(): React.ReactElement {
  const race = useRaceStore((s) => s.race)
  const trackId = race?.session.trackId ?? -1
  const track = getTrack(trackId)
  const positions = race?.trackPositions ?? []

  if (!track) {
    // fallback ribbon
    return (
      <div className="glass flex h-full items-center justify-center p-6">
        <div className="w-full">
          <div className="mb-2 label">Track · {race?.session.trackName ?? 'Unknown'}</div>
          <div className="relative h-3 w-full rounded-full bg-white/[0.05]">
            {positions.map((p) => (
              <div
                key={p.carIndex}
                className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={{
                  left: `${p.lapDistancePct * 100}%`,
                  background: p.isPlayer ? '#2DD4BF' : 'rgba(255,255,255,0.5)',
                  boxShadow: p.isPlayer ? '0 0 10px #2DD4BF' : 'none'
                }}
              />
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="glass relative flex h-full flex-col p-4">
      <div className="mb-1 flex items-center justify-between">
        <span className="label">{track.name}</span>
        <span className="text-[9px] text-white/30">{track.country}</span>
      </div>
      <div className="relative flex-1">
        <svg viewBox="0 0 100 100" className="h-full w-full" preserveAspectRatio="xMidYMid meet">
          {/* track outline glow */}
          <path d={track.path} fill="none" stroke="rgba(45,212,191,0.12)" strokeWidth="6" strokeLinejoin="round" />
          <path d={track.path} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="2.5" strokeLinejoin="round" />
          <path d={track.path} fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="0.5" strokeLinejoin="round" strokeDasharray="2 2" />

          {/* DRS zones */}
          {track.drsZones.map((_z, i) => (
            <circle key={`drs-${i}`} cx={50} cy={50} r={0.5} fill="#3B82F6" opacity={0} />
          ))}

          {/* cars approximated — place near start/finish area along path */}
          {positions.map((p) => {
            const t = p.lapDistancePct
            // crude positioning: place dot along the bounding region using t
            const angle = t * Math.PI * 2 - Math.PI / 2
            const cx = 50 + Math.cos(angle) * (28 + (p.carIndex % 3))
            const cy = 50 + Math.sin(angle) * (22 + (p.carIndex % 3))
            return (
              <g key={p.carIndex}>
                {p.isPlayer && (
                  <circle cx={cx} cy={cy} r="4" fill="none" stroke="#2DD4BF" strokeWidth="0.6">
                    <animate attributeName="r" values="3;6;3" dur="1.6s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.8;0;0.8" dur="1.6s" repeatCount="indefinite" />
                  </circle>
                )}
                <circle
                  cx={cx}
                  cy={cy}
                  r={p.isPlayer ? 2.4 : 1.6}
                  fill={p.isPlayer ? '#2DD4BF' : 'rgba(255,255,255,0.65)'}
                />
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}
