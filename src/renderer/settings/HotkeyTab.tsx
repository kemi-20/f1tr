import { useState, useCallback } from 'react'
import { useConfigStore } from '../store'
import { Field } from './SettingsModal'

/** Hotkey settings tab — configure the push-to-talk key. */
export function HotkeyTab(): React.ReactElement {
  const config = useConfigStore((s) => s.config)
  const patch = useConfigStore((s) => s.patch)
  const [capturing, setCapturing] = useState(false)

  const captureKey = useCallback((e: KeyboardEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.code === 'Escape') { setCapturing(false); return }
    void patch({ hotkeys: { pushToTalk: e.code } })
    setCapturing(false)
  }, [patch])

  const startCapture = (): void => {
    setCapturing(true)
    window.addEventListener('keydown', captureKey, { once: true })
  }

  if (!config) return <p className="text-white/40">loading…</p>

  return (
    <div className="flex flex-col gap-4">
      <Field
        label="语音输入快捷键"
        hint="按下快捷键等效于点击 Speak 按钮，开始/停止录音。仅在 UDP 连接中或断开不超过 2 分钟时生效。"
      >
        <div className="flex items-center gap-3">
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-4 py-2 text-sm text-white/90">
            {config.hotkeys.pushToTalk}
          </div>
          <button
            onClick={startCapture}
            className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition ${
              capturing
                ? 'border-accent-racing/50 text-accent-racing animate-pulse'
                : 'border-accent-carbon/40 text-accent-carbon hover:bg-accent-carbon/10'
            }`}
          >
            {capturing ? '按下任意键…' : '更改按键'}
          </button>
        </div>
      </Field>
      <p className="text-[11px] text-white/30">
        提示：默认为 Space（空格键）。如果 UDP 断开超过 2 分钟，AI 工程师会自动停止工作，直到 UDP 恢复。
      </p>
    </div>
  )
}
