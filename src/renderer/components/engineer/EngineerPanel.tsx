import { useState, useEffect, useRef } from 'react'
import { Send, Mic, Square, LoaderCircle } from 'lucide-react'
import { api } from '../../ipc/ipcClient'
import { useEngineerStore, useConfigStore } from '../../store'
import { StatusPills } from './StatusPills'
import { AudioControls } from './AudioControls'
import { EngineerMarkdown } from './EngineerMarkdown'
import { useVoiceRecorder } from '../../hooks/useVoiceRecorder'

export function EngineerPanel(): React.ReactElement {
  const messages = useEngineerStore((s) => s.messages)
  const streamingId = useEngineerStore((s) => s.streamingId)
  const streamingText = useEngineerStore((s) => s.streamingText)
  const status = useEngineerStore((s) => s.status)
  const statusMessage = useEngineerStore((s) => s.statusMessage)
  const hotkeyTrigger = useEngineerStore((s) => s.hotkeyTrigger)
  const pitwall = useConfigStore((s) => s.config?.ui.style === 'pitwall')
  const [draft, setDraft] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const log = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  const { state: recState, toggle: toggleRec } = useVoiceRecorder()
  const toggleRef = useRef(toggleRec)
  toggleRef.current = toggleRec

  // Global hotkey: main process fires globalShortcut → IPC 'hotkey:trigger' →
  // store increments hotkeyTrigger. We watch it here and toggle recording.
  // The main process only registers the shortcut when UDP is fresh.
  useEffect(() => {
    if (hotkeyTrigger > 0) toggleRef.current()
  }, [hotkeyTrigger])

  const busy = submitting || ((status === 'thinking' || status === 'speaking') && recState !== 'transcribing')

  useEffect(() => {
    if (pitwall && follow.current && log.current) log.current.scrollTop = log.current.scrollHeight
  }, [messages, streamingId, streamingText, pitwall, statusMessage])

  const sendManual = (): void => {
    if (busy) return
    setSubmitting(true)
    const sentDraft = draft
    void api.ask(sentDraft.trim() || undefined).then(() => setDraft((current) => current === sentDraft ? '' : current)).catch((err: unknown) => {
      useEngineerStore.getState().setStatus('error', err instanceof Error ? err.message : '无法发送问题')
    }).finally(() => setSubmitting(false))
  }

  const renderedMessages = (pitwall ? [...messages].reverse() : messages).map((m) => (
    <article key={m.id} className="engineer-message rounded-lg bg-white/[0.03] px-3 py-2 text-sm text-white/85">
      <time className="num-mono mb-0.5 block text-[9px] text-white/30" dateTime={new Date(m.ts).toISOString()}>
        {new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </time>
      <EngineerMarkdown text={m.text} />
    </article>
  ))
  const stream = streamingId && (
    <div className="engineer-stream rounded-lg border border-accent-carbon/30 bg-accent-carbon/[0.06] px-3 py-2 text-sm text-white/90">
      <EngineerMarkdown text={streamingText} />
      <span className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse bg-accent-carbon" />
    </div>
  )

  return (
    <div className="glass engineer-panel flex h-full min-w-0 flex-col gap-3 p-4">
      <div className="engineer-header">
        <div className="engineer-title">
          {pitwall ? <h2>RADIO / ENGINEER</h2> : <span className="label">Race Engineer</span>}
        </div>
        <StatusPills />
      </div>

      {/* Each skin preserves its reading order while sharing the live stream. */}
      <div ref={log} className="engineer-log min-h-0 flex-1 overflow-y-auto rounded-lg bg-black/20 p-3"
        role="log" aria-label="工程师对话" aria-live="off" onScroll={() => {
          const el = log.current
          if (el) follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        }}>
        {messages.length === 0 && !streamingId && (
          <div className="flex h-full items-center justify-center text-center text-xs text-white/25">
            {pitwall ? '无线电待命' : '等待比赛数据… 工程师会在关键时刻自动播报。'}
          </div>
        )}
        <div className="flex flex-col gap-2">
          {!pitwall && status === 'error' && statusMessage && (
            <div className="engineer-error rounded-lg border border-red-500/35 bg-red-500/10 px-3 py-2 text-xs leading-relaxed text-red-200" role="alert">
              {statusMessage}
            </div>
          )}
          {!pitwall && stream}
          {renderedMessages}
          {pitwall && stream}
          {pitwall && status === 'error' && statusMessage && <div className="engineer-error" role="alert">{statusMessage}</div>}
        </div>
      </div>

      {/* input row */}
      <div className="engineer-input-row">
        <input
          value={draft}
          maxLength={1024}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) sendManual()
          }}
          placeholder="向工程师提问…"
          aria-label="向工程师提问"
          className="min-w-0 flex-1 rounded-md border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-sm text-white/90 outline-none placeholder:text-white/25 focus:border-accent-carbon/50"
        />
        <button
          onClick={sendManual}
          disabled={busy}
          title="发送问题" aria-label="发送问题"
          className="engineer-action-btn bg-accent-carbon text-ink-950 hover:brightness-110 disabled:opacity-40"
        >
          {pitwall ? <Send size={17} /> : 'Ask'}
        </button>
        <button
          onClick={toggleRec}
          disabled={recState === 'transcribing'}
          className={`engineer-action-btn disabled:opacity-40 ${
            recState === 'recording'
              ? 'animate-pulse bg-accent-racing text-white hover:brightness-110'
              : recState === 'transcribing'
                ? 'border border-white/10 text-white/40'
                : 'border border-accent-carbon/40 text-accent-carbon hover:bg-accent-carbon/10'
          }`}
          title={recState === 'recording' ? '点击停止录音' : recState === 'transcribing' ? '转写中…' : '语音输入'}
          aria-label={recState === 'recording' ? '停止录音' : recState === 'transcribing' ? '转写中' : '语音输入'}
          aria-pressed={recState === 'recording'}
        >
          {pitwall ? recState === 'recording' ? <Square size={17} /> : recState === 'transcribing' ? <LoaderCircle size={17} /> : <Mic size={17} /> : recState === 'recording' ? 'Rec' : recState === 'transcribing' ? '...' : 'Speak'}
        </button>
      </div>

      <AudioControls />
    </div>
  )
}
