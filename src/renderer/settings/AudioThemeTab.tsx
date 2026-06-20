import { useConfigStore } from '../store'
import { Field } from './SettingsModal'

const THEMES: { id: 'midnight' | 'papaya' | 'racing'; label: string; accent: string }[] = [
  { id: 'midnight', label: 'Petronas Green · 马石油绿', accent: '#00D2BE' },
  { id: 'papaya', label: 'Papaya Orange · 木瓜橙', accent: '#FF8700' },
  { id: 'racing', label: 'Ferrari Red · 法拉利红', accent: '#FF2800' }
]

export function AudioThemeTab(): React.ReactElement {
  const config = useConfigStore((s) => s.config)
  const patch = useConfigStore((s) => s.patch)
  if (!config) return <p className="text-white/40">loading…</p>
  const { audio, ui } = config

  return (
    <div className="flex flex-col gap-5">
      <Field label={`主音量: ${Math.round(audio.volume * 100)}%`}>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={audio.volume}
          onChange={(e) => void patch({ audio: { volume: Number(e.target.value) } })}
          className="h-1 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-accent-carbon"
        />
      </Field>

      <label className="flex items-center gap-2 text-xs text-white/60">
        <input
          type="checkbox"
          checked={audio.muted}
          onChange={(e) => void patch({ audio: { muted: e.target.checked } })}
          className="accent-accent-carbon"
        />
        静音
      </label>

      <label className="flex items-center gap-2 text-xs text-white/60">
        <input
          type="checkbox"
          checked={audio.preemptOnHigh}
          onChange={(e) => void patch({ audio: { preemptOnHigh: e.target.checked } })}
          className="accent-accent-carbon"
        />
        高优先级消息抢断当前播报（如安全车）
      </label>

      <div className="border-t border-white/[0.06] pt-4">
        <div className="label mb-2">主题</div>
        <div className="grid grid-cols-3 gap-2">
          {THEMES.map((t) => {
            const active = ui.theme === t.id
            return (
              <button
                key={t.id}
                onClick={() => void patch({ ui: { theme: t.id, accent: t.accent } })}
                className={`flex items-center gap-2 rounded-lg border p-3 transition ${
                  active ? 'border-accent-carbon/60 bg-accent-carbon/10' : 'border-white/[0.06] bg-white/[0.02] hover:border-white/20'
                }`}
              >
                <span
                  className="h-4 w-4 rounded-full"
                  style={{ background: t.accent, boxShadow: active ? `0 0 8px ${t.accent}` : 'none' }}
                />
                <span className={`text-xs ${active ? 'text-white' : 'text-white/60'}`}>{t.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      <label className="flex items-center gap-2 text-xs text-white/60">
        <input
          type="checkbox"
          checked={ui.reduceMotion}
          onChange={(e) => void patch({ ui: { reduceMotion: e.target.checked } })}
          className="accent-accent-carbon"
        />
        减少动画（遵守系统无障碍设置）
      </label>
    </div>
  )
}
