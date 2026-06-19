import { useRaceStore } from '../../store'
import { useHealthStore } from '../../store'
import { useConfigStore } from '../../store'
import { fmtLapTime } from '@shared/index'

export function TopStrip(): React.ReactElement {
  const race = useRaceStore((s) => s.race)
  const health = useHealthStore()
  const openSettings = useConfigStore((s) => s.openSettings)
  const session = race?.session
  const player = race?.player

  const sc = session?.isSafetyCar ? 'SC' : session?.isVirtualSafetyCar ? 'VSC' : session?.isRedFlag ? 'RED' : null

  const timeLeft = session?.sessionTimeLeftS
  const timeLeftStr = timeLeft != null ? `${Math.floor(timeLeft / 60)}:${String(Math.floor(timeLeft % 60)).padStart(2, '0')}` : '--:--'

  return (
    <div className="glass relative flex items-center justify-between overflow-hidden px-5 py-3">
      <div className="flex items-center gap-5">
        <div className="flex items-center gap-2">
          <div>
            <div className="num-display text-lg font-bold text-white">{session?.trackName ?? '—'}</div>
            <div className="label">{session?.sessionTypeLabel ?? 'awaiting data'}</div>
          </div>
          <button
            onClick={openSettings}
            className="ml-1 rounded-md p-1.5 text-white/40 transition hover:bg-white/[0.06] hover:text-white"
            title="设置"
          >
            ⚙
          </button>
        </div>
        <div className="h-8 w-px bg-white/[0.08]" />
        <div>
          <div className="num-display text-lg font-bold text-white">
            {session?.currentLap ?? 0}
            <span className="text-sm text-white/40">/{session?.totalLaps ?? '?'}</span>
          </div>
          <div className="label">lap</div>
        </div>
        <div>
          <div className="num-mono text-lg font-medium text-white">{timeLeftStr}</div>
          <div className="label">remaining</div>
        </div>
      </div>

      {/* center: position + gaps */}
      <div className="flex items-center gap-6">
        <div className="text-center">
          <div className="num-display text-3xl font-extrabold text-accent-carbon">{player?.position ?? '—'}</div>
          <div className="label">pos</div>
        </div>
        <div className="text-center">
          <div className="num-mono text-sm text-white/80">
            {player?.lastLapTimeS ? fmtLapTime(player.lastLapTimeS) : '--'}
          </div>
          <div className="label">last</div>
        </div>
        <div className="text-center">
          <div className="num-mono text-sm text-white/60">
            {player?.bestLapTimeS ? fmtLapTime(player.bestLapTimeS) : '--'}
          </div>
          <div className="label">best</div>
        </div>
      </div>

      {/* right: weather + health */}
      <div className="flex items-center gap-5">
        <div className="flex items-center gap-3 text-right">
          <div>
            <div className="num-mono text-sm text-white/80">{race?.weather.airTempC ?? '--'}°</div>
            <div className="label">air</div>
          </div>
          <div>
            <div className="num-mono text-sm text-white/80">{race?.weather.trackTempC ?? '--'}°</div>
            <div className="label">track</div>
          </div>
          <div>
            <div className="num-mono text-sm text-sky-400">{Math.round(race?.weather.rainPercentage ?? 0)}%</div>
            <div className="label">rain</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="h-2 w-2 rounded-full"
            style={{
              background: health.waiting ? '#FFB020' : health.connected ? '#2DD4BF' : '#FF3B3B',
              boxShadow: `0 0 8px ${health.waiting ? '#FFB020' : health.connected ? '#2DD4BF' : '#FF3B3B'}`
            }}
          />
          <span className="label">
            {health.waiting ? 'WAITING' : health.connected ? 'CONNECTED' : 'OFFLINE'}
          </span>
        </div>
      </div>

      {/* SC / VSC / RED banner */}
      {sc && (
        <div
          className="absolute inset-x-0 bottom-0 flex h-1 items-center justify-center"
          style={{ background: sc === 'RED' ? '#FF3B3B' : '#FFB020' }}
        />
      )}
    </div>
  )
}
