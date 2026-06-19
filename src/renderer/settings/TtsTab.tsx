import { useConfigStore } from '../store'
import { Field, TextInput, TestButton } from './SettingsModal'

export function TtsTab(): React.ReactElement {
  const config = useConfigStore((s) => s.config)
  const patch = useConfigStore((s) => s.patch)
  if (!config) return <p className="text-white/40">loading…</p>
  const { tts } = config

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="MiMo Base URL" hint="默认 api.xiaomimimo.com，留空则用 .env 的 MIMO_API_BASE_URL">
          <TextInput
            value={tts.baseURL}
            placeholder="api.xiaomimimo.com"
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

      <Field
        label="API Key"
        hint={
          tts.apiKeyOverride
            ? '使用此处填入的 key（覆盖 .env）· 明文存于 userData/config.json'
            : tts.hasSecret
              ? '已从 .env (MIMO_API_KEY) 读取 ✓ · 在此填入可覆盖'
              : '未配置：在此填入，或设 .env 的 MIMO_API_KEY'
        }
      >
        <TextInput
          type="password"
          value={tts.apiKeyOverride}
          placeholder={tts.hasSecret ? '（用 .env 的 key，留空保持）' : 'sk-...'}
          onChange={(e) => void patch({ tts: { apiKeyOverride: e.target.value } })}
        />
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
