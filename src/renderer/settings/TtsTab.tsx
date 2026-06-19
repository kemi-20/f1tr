import { useConfigStore } from '../store'
import { Field, TestButton } from './SettingsModal'

export function TtsTab(): React.ReactElement {
  const config = useConfigStore((s) => s.config)
  if (!config) return <p className="text-white/40">loading…</p>
  const { tts } = config

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="MiMo Base URL" hint="从 .env 的 MIMO_API_BASE_URL 读取">
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-sm text-white/70">
            {tts.baseURL || '未配置'}
          </div>
        </Field>
        <Field label="模型" hint="mimo-v2.5-tts（固定）">
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-sm text-white/70">
            {tts.model}
          </div>
        </Field>
      </div>

      <Field label="API Key" hint={tts.hasSecret ? '已从 .env (MIMO_API_KEY) 读取 ✓' : '未检测到 MIMO_API_KEY'}>
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-sm tracking-widest text-white/40">
          {tts.hasSecret ? '••••••••••••' : '未配置'}
        </div>
      </Field>

      <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-xs leading-relaxed text-white/50">
        MiMo 音频为 <span className="text-white/70 num-mono">24000Hz · 单声道 · int16</span>，由 Web Audio 流式播放。
        当前流式为"兼容模式"（整段合成后切片），首字延迟约 1–3 秒。
      </div>

      <div className="border-t border-white/[0.06] pt-4">
        <TestButton kind="tts" />
      </div>
    </div>
  )
}
