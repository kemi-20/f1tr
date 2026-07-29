import { useTelemetryStore } from '../../store'

const MAX_RPM = 13000

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
    <section className="telemetry-hud flex h-full flex-col gap-4 p-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="label">Telemetry</div>
          <div className="hud-mode">LIVE CAR</div>
        </div>
        <div
          className={`hud-drs ${
            drsActive ? 'hud-drs-active' : drsAllowed ? 'hud-drs-ready' : ''
          }`}
        >
          DRS
        </div>
      </div>

      <div className="rev-lights">
        {lights.map((l, i) => (
          <div
            key={i}
            className="rev-light transition-colors duration-75"
            style={{
              background: l.on ? l.color : 'rgba(255,255,255,0.06)',
              boxShadow: l.on ? `0 0 8px ${l.color}` : 'none'
            }}
          />
        ))}
      </div>

      <div className="hud-primary">
        <div className="hud-gear">
          <div className="num-display font-extrabold leading-none text-white">
            {gear === 0 ? 'N' : gear}
          </div>
          <div className="label mt-1">Gear</div>
        </div>
        <div className="hud-speed">
          <div className="num-display font-bold leading-none text-white">
            {Math.round(speed)}
          </div>
          <div className="label mt-1">km/h</div>
        </div>
        <div className="hud-rpm">
          <div className="num-mono font-medium leading-none text-white/80">
            {Math.round(rpm).toLocaleString()}
          </div>
          <div className="label mt-1">rpm</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Bar label="Throttle" value={throttle} color="#2DD4BF" />
        <Bar label="Brake" value={brake} color="#FF3B3B" />
      </div>

      <div>
        <div className="mb-1 flex justify-between">
          <span className="label">ERS Deploy</span>
          <span className="num-mono text-xs text-white/60">{Math.round(ers * 100)}%</span>
        </div>
        <div className="hud-bar">
          <div
            className="h-full bg-gradient-to-r from-accent-carbon to-sky-400 transition-[width] duration-100"
            style={{ width: `${ers * 100}%` }}
          />
        </div>
      </div>
    </section>
  )
}

function Bar({ label, value, color }: { label: string; value: number; color: string }): React.ReactElement {
  return (
    <div>
      <div className="mb-1 flex justify-between">
        <span className="label">{label}</span>
      </div>
      <div className="hud-bar">
        <div
          className="h-full transition-[width] duration-75"
          style={{ width: `${value * 100}%`, background: color }}
        />
      </div>
    </div>
  )
}
