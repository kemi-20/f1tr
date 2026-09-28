import { useConfigStore } from '../store'
import { ApiKeyField, Field, TextInput, TestButton } from './SettingsModal'

export function TtsTab(): React.ReactElement {
  const config = useConfigStore((s) => s.config)
  const patch = useConfigStore((s) => s.patch)
  if (!config) return <p className="text-white/40">loading…</p>
  const { tts } = config

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="MiMo Base URL" hint="默认 https://api.xiaomimimo.com/v1，留空则用 .env 的 MIMO_API_BASE_URL">
          <TextInput
            value={tts.baseURL}
            placeholder="https://api.xiaomimimo.com/v1"
            onChange={(e) => void patch({ tts: { baseURL: e.target.value } })}
          />
        </Field>
        <Field label="模型" hint="mimo-v2.5-tts（一般无需改）">
          <TextInput
            value={tts.model}
            onChange={(e) => void patch({ tts: { model: e.target.value } })}
          />
        </Field>
      </div>

      <ApiKeyField source={tts.keySource} onPatch={(value) => void patch({ tts: { apiKeyOverride: value } })} />

      <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-xs leading-relaxed text-white/50">
        MiMo 音频为 <span className="text-white/70 num-mono">24000Hz · 单声道 · int16</span>，由 Web Audio 流式播放。
        服务端按 SSE 增量推送 PCM，收到一块就立即播出，首字延迟取决于 MiMo 流式响应速度。
      </div>

      <div className="border-t border-white/[0.06] pt-4">
        <TestButton kind="tts" />
      </div>
    </div>
  )
}
