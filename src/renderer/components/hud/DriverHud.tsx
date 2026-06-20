import { useTelemetryStore } from '../../store'

const MAX_RPM = 13000

/** Rev-light LED strip + big gear + speed + RPM arc. */
export function DriverHud(): React.ReactElement {
  const snap = useTelemetryStore((s) => s.snapshot)

  const rpm = snap?.rpm ?? 0
  const gear = snap?.gear ?? 0
  const speed = snap?.speedKmh ?? 0
  const revPct = Math.min(1, rpm / MAX_RPM)
  const throttle = snap?.throttle ?? 0
  const brake = snap?.brake ?? 0
  const ers = snap?.ersPercent ?? 0
  const drsActive = snap?.drsActive ?? false
  const drsAllowed = snap?.drsAllowed ?? false

  // 15 shift lights
  const litCount = Math.round(revPct * 15)
  const lights = Array.from({ length: 15 }, (_, i) => {
    const on = i < litCount
    let color = '#22c55e' // green (first 5)
    if (i >= 5) color = '#ef4444' // red (middle 5)
    if (i >= 10) color = '#a855f7' // purple (last 5)
    return { on, color }
  })

  return (
    <div className="glass flex h-full flex-col gap-4 p-5">
      {/* shift lights */}
      <div className="flex justify-center gap-1">
        {lights.map((l, i) => (
          <div
            key={i}
            className="h-2 w-5 rounded-full transition-colors duration-75"
            style={{
              background: l.on ? l.color : 'rgba(255,255,255,0.06)',
              boxShadow: l.on ? `0 0 8px ${l.color}` : 'none'
            }}
          />
        ))}
      </div>

      {/* gear + speed */}
      <div className="flex flex-1 items-center justify-around">
        <div className="text-center">
          <div className="num-display text-7xl font-extrabold leading-none text-white">
            {gear === 0 ? 'N' : gear}
          </div>
          <div className="label mt-1">Gear</div>
        </div>
        <div className="text-center">
          <div className="num-display text-5xl font-bold leading-none text-white">
            {Math.round(speed)}
          </div>
          <div className="label mt-1">km/h</div>
        </div>
        <div className="text-center">
          <div className="num-mono text-3xl font-medium leading-none text-white/80">
            {Math.round(rpm).toLocaleString()}
          </div>
          <div className="label mt-1">rpm</div>
        </div>
      </div>

      {/* pedals */}
      <div className="grid grid-cols-2 gap-3">
        <Bar label="Throttle" value={throttle} color="#2DD4BF" />
        <Bar label="Brake" value={brake} color="#FF3B3B" />
      </div>

      {/* ERS + DRS */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <div className="mb-1 flex justify-between">
            <span className="label">ERS</span>
            <span className="num-mono text-xs text-white/60">{Math.round(ers * 100)}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.05]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-accent-carbon to-sky-400 transition-[width] duration-100"
              style={{ width: `${ers * 100}%` }}
            />
          </div>
        </div>
        <div
          className={`chip border ${
            drsActive
              ? 'border-accent-racing bg-accent-racing/20 text-accent-racing blink'
              : drsAllowed
                ? 'border-accent-ember/60 bg-accent-ember/15 text-accent-ember'
                : 'border-white/10 text-white/30'
          }`}
        >
          DRS
        </div>
      </div>
    </div>
  )
}

function Bar({ label, value, color }: { label: string; value: number; color: string }): React.ReactElement {
  return (
    <div>
      <div className="mb-1 flex justify-between">
        <span className="label">{label}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.05]">
        <div
          className="h-full rounded-full transition-[width] duration-75"
          style={{ width: `${value * 100}%`, background: color }}
        />
      </div>
    </div>
  )
}
