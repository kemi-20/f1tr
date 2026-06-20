import type { CSSProperties } from 'react'
import { useRaceStore, useHealthStore } from './store'
import { useConfigStore } from './store'
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
  const ui = useConfigStore((s) => s.config?.ui)
  const theme = themeVars(ui?.theme ?? 'midnight', ui?.accent)
  const className = [
    'app-backdrop flex h-screen w-screen flex-col gap-3 p-3',
    ui?.glassmorphism === false ? 'theme-flat-glass' : '',
    ui?.reduceMotion ? 'theme-reduce-motion' : ''
  ].filter(Boolean).join(' ')

  return (
    <div className={className} style={theme}>
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

type ThemeId = 'midnight' | 'papaya' | 'racing'

function themeVars(theme: ThemeId, accentOverride?: string): CSSProperties {
  const preset = THEME_PRESETS[theme] ?? THEME_PRESETS.midnight
  const primary = hexToRgb(accentOverride || preset.primary) ?? hexToRgb(preset.primary)!
  const secondary = hexToRgb(preset.secondary)!
  const ferrari = hexToRgb('#FF2800')!
  const ember = hexToRgb('#FFB020')!
  return {
    '--accent-carbon-rgb': primary,
    '--accent-papaya-rgb': secondary,
    '--accent-racing-rgb': ferrari,
    '--accent-ember-rgb': ember,
    '--backdrop-primary-rgb': primary,
    '--backdrop-secondary-rgb': secondary
  } as CSSProperties
}

const THEME_PRESETS: Record<ThemeId, { primary: string; secondary: string }> = {
  midnight: { primary: '#00D2BE', secondary: '#FF6A00' },
  papaya: { primary: '#FF8700', secondary: '#00D2BE' },
  racing: { primary: '#FF2800', secondary: '#00D2BE' }
}

function hexToRgb(hex: string): string | null {
  const clean = hex.trim().replace(/^#/, '')
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return null
  const n = Number.parseInt(clean, 16)
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`
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
