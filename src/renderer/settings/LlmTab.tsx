import { useConfigStore } from '../store'
import { Field, TextInput, TestButton } from './SettingsModal'

export function LlmTab(): React.ReactElement {
  const config = useConfigStore((s) => s.config)
  const patch = useConfigStore((s) => s.patch)
  if (!config) return <p className="text-white/40">loading…</p>
  const { llm } = config

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="API Base URL" hint="OpenAI 兼容端点（从 .env 的 AI_API_BASE_URL 读取）">
          <TextInput
            value={llm.baseURL}
            placeholder="https://api.deepseek.com/v1"
            onChange={(e) => void patch({ llm: { baseURL: e.target.value } })}
          />
        </Field>
        <Field label="模型" hint="如 deepseek-v4-flash / deepseek-v4-pro / gpt-4o-mini">
          <TextInput
            value={llm.model}
            placeholder="deepseek-v4-flash"
            onChange={(e) => void patch({ llm: { model: e.target.value } })}
          />
        </Field>
      </div>

     <label className="flex items-center gap-2 text-xs text-white/60">
       <input
         type="checkbox"
         checked={llm.visionSupported}
         onChange={(e) => void patch({ llm: { visionSupported: e.target.checked } })}
         className="h-4 w-4 accent-accent-carbon"
       />
       <span>支持图片输入</span>
       <span className="text-[10px] text-white/30">
         {llm.visionSupported
           ? '截图直接发给此模型'
           : '截图先经 MiMo mimo-v2.5 描述后再发'}
       </span>
     </label>

      <label className="flex items-center gap-2 text-xs text-white/60">
        <input
          type="checkbox"
          checked={llm.audioSupported}
          onChange={(e) => void patch({ llm: { audioSupported: e.target.checked } })}
          className="h-4 w-4 accent-accent-carbon"
        />
        <span>支持音频输入</span>
        <span className="text-[10px] text-white/30">
          {llm.audioSupported
            ? '语音录音直接发给此模型'
            : '语音先经 MiMo mimo-v2.5-asr 转文字后再发'}
        </span>
      </label>

      <Field
        label="API Key"
        hint={
          llm.apiKeyOverride
            ? '使用此处填入的 key（覆盖 .env）· 明文存于 userData/config.json'
            : llm.hasSecret
              ? '已从 .env (AI_API_KEY) 读取 ✓ · 在此填入可覆盖'
              : '未配置：在此填入，或设 .env 的 AI_API_KEY'
        }
      >
        <TextInput
          type="password"
          value={llm.apiKeyOverride}
          placeholder={llm.hasSecret ? '（用 .env 的 key，留空保持）' : 'sk-...'}
          onChange={(e) => void patch({ llm: { apiKeyOverride: e.target.value } })}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label={`温度 (temperature: ${llm.temperature.toFixed(2)})`}>
          <input
            type="range"
            min={0}
            max={1.5}
            step={0.05}
            value={llm.temperature}
            onChange={(e) => void patch({ llm: { temperature: Number(e.target.value) } })}
            className="h-1 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-accent-carbon"
          />
        </Field>
        <Field label="最大回复 tokens" hint="默认 140：减少次数后，单次可包含局势、动作和原因">
          <TextInput
            type="number"
            value={llm.maxTokens}
            min={16}
            max={512}
            onChange={(e) => void patch({ llm: { maxTokens: Number(e.target.value) } })}
          />
        </Field>
      </div>

      <div className="border-t border-white/[0.06] pt-4">
        <TestButton kind="llm" />
      </div>
    </div>
  )
}
