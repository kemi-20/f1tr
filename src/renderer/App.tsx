import { useRaceStore, useHealthStore } from './store'
import { TopStrip } from './components/layout/TopStrip'
import { TrackMap } from './components/trackmap/TrackMap'
import { DriverHud } from './components/hud/DriverHud'
import { TyreGrid } from './components/tyres/TyreGrid'
import { DamagePanel } from './components/damage/DamagePanel'
import { RivalsPanel } from './components/rivals/RivalsPanel'
import { EngineerPanel } from './components/engineer/EngineerPanel'
import { SettingsModal } from './settings/SettingsModal'

export function App(): React.ReactElement {
  const hasRace = useRaceStore((s) => s.race != null)
  const waiting = useHealthStore((s) => s.waiting)

  return (
    <div className="app-backdrop flex h-screen w-screen flex-col gap-3 p-3">
      <TopStrip />

      {/* main 3-column grid */}
      <div className="grid flex-1 grid-cols-12 gap-3 overflow-hidden">
        {/* left column: HUD + tyres + damage */}
        <div className="col-span-3 flex flex-col gap-3 overflow-hidden">
          <div className="min-h-[340px] flex-1">
            <DriverHud />
          </div>
          <TyreGrid />
          <DamagePanel />
        </div>

        {/* center: track map */}
        <div className="col-span-5 overflow-hidden">
          <TrackMap />
        </div>

        {/* right: rivals + engineer */}
        <div className="col-span-4 flex flex-col gap-3 overflow-hidden">
          <div className="min-h-[280px] flex-1">
            <RivalsPanel />
          </div>
          <div className="min-h-[280px] flex-1">
            <EngineerPanel />
          </div>
        </div>
      </div>

      {/* settings modal */}
      <SettingsModal />

      {/* waiting overlay */}
      {(waiting || !hasRace) && <WaitingOverlay />}
    </div>
  )
}

function WaitingOverlay(): React.ReactElement {
  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center">
      <div className="pointer-events-auto glass flex max-w-md flex-col items-center gap-3 px-8 py-6 text-center">
        <div className="relative h-10 w-10">
          <div className="absolute inset-0 rounded-full border-2 border-accent-carbon/30" />
          <div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-accent-carbon" />
        </div>
        <div className="text-sm font-semibold text-white">等待 F1 25 遥测数据</div>
        <div className="text-xs leading-relaxed text-white/50">
          在 F1 25 中开启遥测：
          <br />
          <span className="text-white/70">Options → Settings → UDP Telemetry Settings</span>
          <br />
          端口 <span className="num-mono text-accent-carbon">20777</span> · 速率 20–60Hz
        </div>
      </div>
    </div>
  )
}
