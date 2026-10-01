import { useRaceStore } from '../../store'
import { useHealthStore } from '../../store'
import { useConfigStore } from '../../store'
import { fmtLapTime } from '@shared/index'
import type { SessionState } from '@shared/types/state'
import { sessionKind } from '@shared/util/sessionKind'
import { Settings, CloudRain, Thermometer, Flag } from 'lucide-react'

export function TopStrip(): React.ReactElement {
  const race = useRaceStore((s) => s.race)
  const healthWaiting = useHealthStore((s) => s.waiting)
  const healthConnected = useHealthStore((s) => s.connected)
  const openSettings = useConfigStore((s) => s.openSettings)
  const pitwall = useConfigStore((s) => s.config?.ui.style === 'pitwall')
  const session = race?.session
  const player = race?.player

  const raceSignal = session ? getRaceSignal(session) : null
  const kind = session ? sessionKind(session) : 'unknown'
  const isPractice = kind === 'practice'
  const isRace = kind === 'race'
  const lapText = !isRace
    ? String(session?.currentLap ?? 0)
    : `${session?.currentLap ?? 0}${session?.totalLaps ? `/${session.totalLaps}` : ''}`

  const timeLeft = session?.sessionTimeLeftS
  const tl = timeLeft != null ? Math.max(0, timeLeft) : null
  const timeLeftStr = tl != null ? `${Math.floor(tl / 60)}:${String(Math.floor(tl % 60)).padStart(2, '0')}` : '--:--'

  if (pitwall) return (
    <header className="pitwall-session">
      <div className="pitwall-brand"><img src="./favicon.png" alt="" /><strong>F1TR</strong></div>
      <div className="session-identity">
        <strong>{session?.trackName || 'RACE CONTROL'}</strong>
        <span>{session?.sessionTypeLabel || 'NO SESSION'}</span>
      </div>
      <div className="session-reading"><span>{isPractice ? 'LAPS RUN' : 'LAP'}</span><strong>{lapText}</strong></div>
      <div className="session-reading"><span>TIME LEFT</span><strong>{timeLeftStr}</strong></div>
      <div className="session-reading session-position"><span>POSITION</span><strong>{player?.position ? `P${player.position}` : '--'}</strong></div>
      <div className="session-reading session-lap-time"><span>LAST / BEST</span><strong>
        {player?.lastLapTimeS ? fmtLapTime(player.lastLapTimeS * 1000) : '--'}
        <small> / {player?.bestLapTimeS ? fmtLapTime(player.bestLapTimeS * 1000) : '--'}</small>
      </strong></div>
      {raceSignal && <div className={`race-signal race-signal-${raceSignal.tone}`}><Flag size={14} /><span>{raceSignal.label}</span></div>}
      <div className="session-weather"><Thermometer size={14} /><span>{race ? `${race.weather.airTempC}° / ${race.weather.trackTempC}°` : '-- / --'}</span><CloudRain size={14} /><span>{race ? `${Math.round(race.weather.rainPercentage)}%` : '--'}</span></div>
      <div className={`session-health ${healthWaiting ? 'is-waiting' : healthConnected ? 'is-connected' : 'is-offline'}`}>
        <i /><span>{healthWaiting ? 'WAITING' : healthConnected ? 'LIVE' : 'OFFLINE'}</span>
      </div>
      <button type="button" className="pitwall-icon" onClick={openSettings} title="设置" aria-label="设置" data-settings-trigger><Settings size={18} /></button>
    </header>
  )

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
            aria-label="设置" data-settings-trigger
          >
            ⚙
          </button>
        </div>
        <div className="h-8 w-px bg-white/[0.08]" />
        <div>
          <div className="num-display text-lg font-bold text-white">
            {lapText.includes('/') ? (
              <>
                {lapText.split('/')[0]}
                <span className="text-sm text-white/40">/{lapText.split('/')[1]}</span>
              </>
            ) : (
              lapText
            )}
          </div>
          <div className="label">{isPractice ? 'laps run' : 'lap'}</div>
        </div>
        <div>
          <div className="num-mono text-lg font-medium text-white">{timeLeftStr}</div>
          <div className="label">remaining</div>
        </div>
      </div>

      {/* center: position + gaps */}
      <div className="flex items-center gap-6">
        {raceSignal && (
          <div className={`race-signal race-signal-${raceSignal.tone}`}>
            <span className="race-signal-chip">{raceSignal.label}</span>
            <span className="race-signal-text">{raceSignal.detail}</span>
          </div>
        )}
        <div className="text-center">
          <div className="num-display text-3xl font-extrabold text-accent-carbon">{player?.position ?? '—'}</div>
          <div className="label">pos</div>
        </div>
        <div className="text-center">
          <div className="num-mono text-sm text-white/80">
            {player?.lastLapTimeS ? fmtLapTime(player.lastLapTimeS * 1000) : '--'}
          </div>
          <div className="label">last</div>
        </div>
        <div className="text-center">
          <div className="num-mono text-sm text-white/60">
            {player?.bestLapTimeS ? fmtLapTime(player.bestLapTimeS * 1000) : '--'}
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
              background: healthWaiting ? '#FFB020' : healthConnected ? '#2DD4BF' : '#FF3B3B',
              boxShadow: `0 0 8px ${healthWaiting ? '#FFB020' : healthConnected ? '#2DD4BF' : '#FF3B3B'}`
            }}
          />
          <span className="label">
            {healthWaiting ? 'WAITING' : healthConnected ? 'CONNECTED' : 'OFFLINE'}
          </span>
        </div>
      </div>

      {/* SC / VSC / RED banner */}
      {raceSignal && (
        <div
          className="absolute inset-x-0 bottom-0 flex h-1 items-center justify-center"
          style={{ background: raceSignal.color }}
        />
      )}
    </div>
  )
}

type RaceSignal = { label: string; detail: string; tone: 'red' | 'yellow' | 'blue' | 'green'; color: string }

function getRaceSignal(session: SessionState): RaceSignal | null {
  if (session.isRedFlag || session.trackFlag === 'red') {
    return { label: 'RED', detail: 'Red flag', tone: 'red', color: '#FF3030' }
  }
  if (session.isSafetyCar) {
    return { label: 'SC', detail: 'Safety car', tone: 'yellow', color: '#FFD400' }
  }
  if (session.isVirtualSafetyCar) {
    return { label: 'VSC', detail: 'Virtual safety car', tone: 'yellow', color: '#FFD400' }
  }
  if (session.trackFlag === 'yellow') {
    const zones = session.activeFlagZones > 1 ? `${session.activeFlagZones} zones` : 'sector'
    return { label: 'YELLOW', detail: zones, tone: 'yellow', color: '#FFD400' }
  }
  if (session.trackFlag === 'blue') {
    return { label: 'BLUE', detail: 'Blue flag', tone: 'blue', color: '#2F8FFF' }
  }
  if (session.trackFlag === 'green') {
    return { label: 'GREEN', detail: 'Green flag', tone: 'green', color: '#33D17A' }
  }
  return null
}
