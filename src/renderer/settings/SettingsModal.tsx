import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { X, Settings, Check, LoaderCircle } from 'lucide-react'
import { useConfigStore } from '../store'
import { api } from '../ipc/ipcClient'
import type { KeySource } from '@shared/index'
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
  const pitwall = useConfigStore((s) => s.config?.ui.style === 'pitwall')
  const [tab, setTab] = useState<TabId>('llm')
  const dialog = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.current?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.preventDefault(); close(); return }
      if (event.key !== 'Tab' || !dialog.current) return
      const elements = [...dialog.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]')]
        .filter(el => el.tabIndex >= 0 && el.getClientRects().length > 0)
      const first = elements[0]
      const last = elements[elements.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {
        event.preventDefault(); last?.focus()
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) {
        event.preventDefault(); first?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      const target = previous?.isConnected ? previous : document.querySelector<HTMLElement>('[data-settings-trigger]')
      target?.focus()
    }
  }, [close, open])

  if (!open) return null

  return (
    <div
      className="settings-overlay fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={close}
    >
      <div
        ref={dialog} role="dialog" aria-modal="true" aria-labelledby="settings-title" tabIndex={-1}
        className="settings-dialog glass flex max-h-[86vh] w-[760px] max-w-[94vw] flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="settings-header flex items-center justify-between border-b border-white/[0.06] px-5 py-3">
          <h2 id="settings-title" className="num-display text-sm font-bold uppercase text-white/80">
            {pitwall && <Settings size={18} />} Settings
          </h2>
          <button
            onClick={close}
            title="关闭设置" aria-label="关闭设置"
            className="rounded-md px-2 py-1 text-white/40 transition hover:bg-white/[0.06] hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        <div className="settings-layout">
        <div className="settings-nav flex gap-1 border-b border-white/[0.06] px-3 pt-2" role="tablist" aria-label="设置分类" aria-orientation={pitwall ? 'vertical' : 'horizontal'}>
          {TABS.map((t) => (
            <button
              key={t.id}
              id={`settings-tab-${t.id}`} role="tab" aria-selected={tab === t.id} aria-controls={`settings-panel-${t.id}`} tabIndex={tab === t.id ? 0 : -1}
              onClick={() => setTab(t.id)}
              onKeyDown={(event) => {
                const delta = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 0
                if (!delta && event.key !== 'Home' && event.key !== 'End') return
                event.preventDefault()
                const index = event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : (TABS.findIndex(item => item.id === t.id) + delta + TABS.length) % TABS.length
                setTab(TABS[index].id)
                document.getElementById(`settings-tab-${TABS[index].id}`)?.focus()
              }}
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
        <div className="settings-content overflow-y-auto p-5" id={`settings-panel-${tab}`} role="tabpanel" aria-labelledby={`settings-tab-${tab}`} tabIndex={0}>
          {tab === 'llm' && <LlmTab />}
          {tab === 'tts' && <TtsTab />}
          {tab === 'voice' && <VoiceLanguageTab />}
          {tab === 'telemetry' && <TelemetryTab />}
          {tab === 'audio' && <AudioThemeTab />}
          {tab === 'hotkey' && <HotkeyTab />}
        </div>
        </div>

        <div className="settings-footer border-t border-white/[0.06] px-5 py-3 text-right">
          <span className="text-[10px] text-white/30">
            密钥只保存在主进程（.env 或 userData），不会回传到界面；此处修改的其余偏好会写入本地配置。
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
    <div className="settings-test flex items-center gap-2">
      <button
        onClick={run}
        disabled={state.loading}
        className="rounded-md border border-accent-carbon/40 px-3 py-1.5 text-xs font-semibold text-accent-carbon transition hover:bg-accent-carbon/10 disabled:opacity-40"
      >
        {state.loading && <LoaderCircle size={14} className="animate-spin" />}{state.loading ? '测试中…' : '测试连接'}
      </button>
      {state.msg != null && (
        <span role="status" className={`settings-test-result text-[11px] ${state.ok ? 'text-accent-carbon' : 'text-accent-racing'}`}>
          {state.ok ? <Check size={14} /> : <X size={14} />}
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

/**
 * API-key input. The stored key never crosses IPC — the renderer only knows whether one
 * came from `.env` or from a previous override, so this field is always blank on open and
 * typing here replaces the override.
 */
export function ApiKeyField({ source, onPatch }: { source: KeySource; onPatch: (value: string) => void }): ReactElement {
  const [draft, setDraft] = useState('')
  const hint = source === 'override'
    ? '已保存自定义 key（明文存于 userData/config.json）· 输入新值即可覆盖'
    : source === 'env'
      ? '已从 .env 读取 ✓ · 在此填入可覆盖'
      : '未配置：在此填入，或设置 .env 中的 API key'
  return (
    <Field label="API Key" hint={hint}>
      <div className="flex items-center gap-2">
        <TextInput
          type="password"
          className="flex-1"
          value={draft}
          placeholder={source === 'none' ? 'sk-...' : '••••••••（已保存，留空保持不变）'}
          onChange={(e) => {
            setDraft(e.target.value)
            onPatch(e.target.value)
          }}
        />
        {source === 'override' && (
          <button
            type="button"
            onClick={() => {
              setDraft('')
              onPatch('')
            }}
            className="rounded-md border border-white/10 px-3 py-2 text-xs text-white/50 transition hover:border-accent-racing/40 hover:text-accent-racing"
          >
            清除
          </button>
        )}
      </div>
    </Field>
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
