import { useConfigStore } from '../store'
import { LANGUAGE_PROFILE, ENGINEER_STYLES, type LanguageMode } from '@shared/index'
import { Field } from './SettingsModal'

const MODES: { id: LanguageMode; label: string; desc: string }[] = [
  { id: 'zh', label: '中文', desc: '工程师用中文播报' },
  { id: 'en', label: 'English', desc: 'Engineer speaks English' },
  { id: 'mixed', label: '中英混合', desc: '中文主体，F1 术语保留英文（DRS / ERS / box）' }
]

export function VoiceLanguageTab(): React.ReactElement {
  const config = useConfigStore((s) => s.config)
  const patch = useConfigStore((s) => s.patch)
  if (!config) return <p className="text-white/40">loading…</p>
  const { language } = config
  const profile = LANGUAGE_PROFILE[language.mode]

  return (
    <div className="flex flex-col gap-5">
      <Field label="语言模式" hint="决定工程师的播报语言与 LLM 提示词">
        <div className="grid grid-cols-3 gap-2">
          {MODES.map((m) => {
            const active = language.mode === m.id
            return (
              <button
                key={m.id}
                onClick={() =>
                  void patch({
                    language: {
                      mode: m.id,
                      voice: LANGUAGE_PROFILE[m.id].defaultVoice,
                      direction: LANGUAGE_PROFILE[m.id].direction
                    }
                  })
                }
                className={`rounded-lg border p-3 text-left transition ${
                  active
                    ? 'border-accent-carbon/60 bg-accent-carbon/10'
                    : 'border-white/[0.06] bg-white/[0.02] hover:border-white/20'
                }`}
              >
                <div className={`text-sm font-bold ${active ? 'text-accent-carbon' : 'text-white/80'}`}>{m.label}</div>
                <div className="mt-1 text-[10px] leading-snug text-white/40">{m.desc}</div>
              </button>
            )
          })}
        </div>
      </Field>

      <Field label="嗓音" hint={`${profile.speak}`}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {profile.voices.map((v) => {
            const active = language.voice === v.id
            return (
              <button
                key={v.id}
                onClick={() => void patch({ language: { voice: v.id } })}
                className={`rounded-lg border px-3 py-2 text-left text-xs transition ${
                  active
                    ? 'border-accent-carbon/60 bg-accent-carbon/10 text-accent-carbon'
                    : 'border-white/[0.06] bg-white/[0.02] text-white/70 hover:border-white/20'
                }`}
              >
                {v.name}
              </button>
            )
          })}
        </div>
      </Field>

      <Field label="工程师风格" hint="选择 src/engineer_skills 中的 GP / Bono / Bozzi / Adami skill">
        <div className="grid grid-cols-2 gap-2">
          {ENGINEER_STYLES.map((s) => {
            const active = language.engineerStyle === s.id
            return (
              <button
                key={s.id}
                onClick={() => void patch({ language: { engineerStyle: s.id } })}
                className={`rounded-lg border p-3 text-left transition ${
                  active
                    ? 'border-accent-carbon/60 bg-accent-carbon/10'
                    : 'border-white/[0.06] bg-white/[0.02] hover:border-white/20'
                }`}
              >
                <div className={`text-sm font-bold ${active ? 'text-accent-carbon' : 'text-white/80'}`}>{s.name}</div>
                <div className="mt-0.5 text-[10px] leading-snug text-white/40">{s.description}</div>
              </button>
            )
          })}
        </div>
      </Field>
    </div>
  )
}
