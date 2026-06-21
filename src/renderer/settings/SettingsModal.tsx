import { useEffect, useState, type ReactElement, type ReactNode } from 'react'
import { useConfigStore } from '../store'
import { api } from '../ipc/ipcClient'
import {
  LANGUAGE_PROFILE,
  type LanguageMode,
  type VoiceOption
} from '@shared/index'
import { LlmTab } from './LlmTab'
import { TtsTab } from './TtsTab'
import { VoiceLanguageTab } from './VoiceLanguageTab'
import { TelemetryTab } from './TelemetryTab'
import { AudioThemeTab } from './AudioThemeTab'
import { HotkeyTab } from './HotkeyTab'

type TabId = 'llm' | 'tts' | 'voice' | 'telemetry' | 'audio' | 'hotkey'

const TABS: { id: TabId; label: string }[] = [
  { id: 'llm', label: 'AI / LLM' },
  { id: 'tts', label: 'TTS · MiMo' },
  { id: 'voice', label: '语音 · 语言' },
  { id: 'telemetry', label: '遥测 · 触发' },
  { id: 'audio', label: '音频 · 主题' },
  { id: 'hotkey', label: '快捷键' }
]

export function SettingsModal(): ReactElement | null {
  const open = useConfigStore((s) => s.settingsOpen)
  const close = useConfigStore((s) => s.closeSettings)
  const [tab, setTab] = useState<TabId>('llm')

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [close, open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={close}
    >
      <div
        className="glass flex max-h-[86vh] w-[760px] max-w-[94vw] flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3">
          <h2 className="num-display text-sm font-bold uppercase tracking-[0.2em] text-white/80">
            Settings
          </h2>
          <button
            onClick={close}
            className="rounded-md px-2 py-1 text-white/40 transition hover:bg-white/[0.06] hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* tab strip */}
        <div className="flex gap-1 border-b border-white/[0.06] px-3 pt-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`relative rounded-t-md px-3 py-2 text-xs font-semibold transition ${
                tab === t.id ? 'text-accent-carbon' : 'text-white/40 hover:text-white/70'
              }`}
            >
              {t.label}
              {tab === t.id && (
                <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent-carbon" />
              )}
            </button>
          ))}
        </div>

        {/* body */}
        <div className="overflow-y-auto p-5">
          {tab === 'llm' && <LlmTab />}
          {tab === 'tts' && <TtsTab />}
          {tab === 'voice' && <VoiceLanguageTab />}
          {tab === 'telemetry' && <TelemetryTab />}
          {tab === 'audio' && <AudioThemeTab />}
          {tab === 'hotkey' && <HotkeyTab />}
        </div>

        <div className="border-t border-white/[0.06] px-5 py-3 text-right">
          <span className="text-[10px] text-white/30">
            密钥从 .env 读取；此处的修改会覆盖到本地偏好（不含密钥）。
          </span>
        </div>
      </div>
    </div>
  )
}

/** Shared test-button: runs a config:test:* round-trip and shows the result. */
export function TestButton({ kind }: { kind: 'llm' | 'tts' | 'udp' }): ReactElement {
  const [state, setState] = useState<{ loading: boolean; ok?: boolean; msg?: string }>({ loading: false })
  const run = async (): Promise<void> => {
    setState({ loading: true })
    try {
      const res = await (kind === 'llm' ? api.testLlm() : kind === 'tts' ? api.testTts() : api.testUdp())
      setState({ loading: false, ok: res.ok, msg: res.message })
    } catch (err) {
      setState({ loading: false, ok: false, msg: (err as Error)?.message ?? 'error' })
    }
  }
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={run}
        disabled={state.loading}
        className="rounded-md border border-accent-carbon/40 px-3 py-1.5 text-xs font-semibold text-accent-carbon transition hover:bg-accent-carbon/10 disabled:opacity-40"
      >
        {state.loading ? '测试中…' : '测试连接'}
      </button>
      {state.msg != null && (
        <span className={`text-[11px] ${state.ok ? 'text-accent-carbon' : 'text-accent-racing'}`}>
          {state.ok ? '✓ ' : '✗ '}
          {state.msg}
        </span>
      )}
    </div>
  )
}

/** Reusable labeled field wrapper. */
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }): ReactElement {
  return (
    <label className="flex flex-col gap-1">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="text-[10px] text-white/30">{hint}</span>}
    </label>
  )
}

/** Reusable text input with the glassmorphism style. */
export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>): ReactElement {
  return (
    <input
      {...props}
      className={`rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-sm text-white/90 outline-none transition placeholder:text-white/25 focus:border-accent-carbon/50 ${
        props.className ?? ''
      }`}
    />
  )
}

/** Re-export the profile helpers so tabs don't each import from @shared. */
export function voicesFor(mode: LanguageMode): VoiceOption[] {
  return LANGUAGE_PROFILE[mode].voices
}
