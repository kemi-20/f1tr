import { useState, useEffect } from 'react'
import { api } from '../../ipc/ipcClient'
import { useEngineerStore, useConfigStore, useHealthStore } from '../../store'
import { StatusPills } from './StatusPills'
import { AudioControls } from './AudioControls'
import { useVoiceRecorder } from '../../hooks/useVoiceRecorder'

export function EngineerPanel(): React.ReactElement {
  const messages = useEngineerStore((s) => s.messages)
  const streamingId = useEngineerStore((s) => s.streamingId)
  const streamingText = useEngineerStore((s) => s.streamingText)
  const status = useEngineerStore((s) => s.status)
  const hotkey = useConfigStore((s) => s.config?.hotkeys.pushToTalk ?? 'Space')
  const [draft, setDraft] = useState('')
  const { state: recState, toggle: toggleRec } = useVoiceRecorder()

  // Global hotkey listener: pressing the configured key (default Space) toggles
  // voice recording, same as clicking Speak. Only active when UDP is fresh
  // (connected or disconnected < 2 min). Ignored while typing in an input/textarea.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.code !== hotkey) return
      // don't intercept when focused on a text input
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      // check UDP freshness: lastPacketMs within 2 minutes
      const { lastPacketMs } = useHealthStore.getState()
      if (lastPacketMs === 0) return // never received packets
      if (Date.now() - lastPacketMs > 120_000) return // stale > 2min
      e.preventDefault()
      toggleRec()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [hotkey, toggleRec])

  const busy = (status === 'thinking' || status === 'speaking') && recState !== 'transcribing'

  const sendManual = (): void => {
    void api.ask(draft.trim() || undefined)
    setDraft('')
  }

  return (
    <div className="glass flex h-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="label">Race Engineer</span>
        </div>
        <StatusPills />
      </div>

      {/* message stream — newest on top, older sinks down */}
      <div className="flex-1 overflow-y-auto rounded-xl bg-black/20 p-3">
        {messages.length === 0 && !streamingId && (
          <div className="flex h-full items-center justify-center text-center text-xs text-white/25">
            等待比赛数据… 工程师会在关键时刻自动播报。
          </div>
        )}
        <div className="flex flex-col gap-2">
          {/* store prepends newest message to the front of the array, so a normal
              flex-col renders it at the top. The streaming bubble is placed first too. */}
          {streamingId && (
            <div className="animate-fade-in rounded-lg border border-accent-carbon/30 bg-accent-carbon/[0.06] px-3 py-2 text-sm text-white/90">
              {streamingText}
              <span className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse bg-accent-carbon" />
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className="animate-slide-up rounded-lg bg-white/[0.03] px-3 py-2 text-sm text-white/85">
              <div className="num-mono mb-0.5 text-[9px] text-white/30">
                {new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </div>
              {m.text}
            </div>
          ))}
        </div>
      </div>

      {/* input row */}
      <div className="flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') sendManual()
          }}
          placeholder="向工程师提问…"
          className="flex-1 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-sm text-white/90 outline-none placeholder:text-white/25 focus:border-accent-carbon/50"
        />
        <button
          onClick={sendManual}
          disabled={busy}
          className="rounded-lg bg-accent-carbon px-4 py-2 text-xs font-bold uppercase tracking-wide text-ink-950 transition hover:brightness-110 disabled:opacity-40"
        >
          Ask
        </button>
        <button
          onClick={toggleRec}
          disabled={recState === 'transcribing'}
          className={`rounded-lg px-4 py-2 text-xs font-bold uppercase tracking-wide transition disabled:opacity-40 ${
            recState === 'recording'
              ? 'animate-pulse bg-accent-racing text-white hover:brightness-110'
              : recState === 'transcribing'
                ? 'border border-white/10 text-white/40'
                : 'border border-accent-carbon/40 text-accent-carbon hover:bg-accent-carbon/10'
          }`}
          title={recState === 'recording' ? '点击停止录音' : recState === 'transcribing' ? '转写中…' : '语音输入'}
        >
          {recState === 'recording' ? '● 录音中' : recState === 'transcribing' ? '转写中…' : 'Speak'}
        </button>
      </div>

      <AudioControls />
    </div>
  )
}
