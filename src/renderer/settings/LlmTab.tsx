import { useConfigStore } from '../store'
import { ApiKeyField, Field, TextInput, TestButton } from './SettingsModal'
import type { ReasoningEffort } from '@shared/index'

const THINKING_LEVELS: { id: ReasoningEffort; label: string; color: string }[] = [
  { id: 'none', label: 'NONE', color: '#8A94A6' },
  { id: 'low', label: 'LOW', color: '#00D2BE' },
  { id: 'max', label: 'MAX', color: '#FF3B3B' }
]

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
            : '截图先经 MiMo mimo-v2.6-flash 描述后再发'}
        </span>
      </label>

      <ApiKeyField source={llm.keySource} onPatch={(value) => void patch({ llm: { apiKeyOverride: value } })} />

      <div className="flex flex-col gap-4">
        <div>
          <div className="label mb-2">思考等级</div>
          <div className="grid grid-cols-3 gap-2">
            {THINKING_LEVELS.map((level) => {
              const active = llm.reasoningEffort === level.id
              return (
                <button
                  key={level.id}
                  type="button"
                  onClick={() => void patch({ llm: { reasoningEffort: level.id } })}
                  className={`flex items-center gap-2 rounded-lg border p-3 transition ${
                    active ? 'border-accent-carbon/60 bg-accent-carbon/10' : 'border-white/[0.06] bg-white/[0.02] hover:border-white/20'
                  }`}
                >
                  <span
                    className="h-4 w-4 rounded-full"
                    style={{ background: level.color, boxShadow: active ? `0 0 8px ${level.color}` : 'none' }}
                  />
                  <span className={`text-xs ${active ? 'text-white' : 'text-white/60'}`}>{level.label}</span>
                </button>
              )
            })}
          </div>
          <div className="mt-1 text-[10px] text-white/30">none 关闭思考，low 平衡速度与强度，max 使用模型最高推理强度</div>
        </div>
        <Field label={`上下文限制 (${Math.round(llm.contextLimit / 1000)}k)`} hint="默认 200k：DSH 的模型上下文窗口，不再限制单次回复">
          <TextInput
            type="number"
            value={llm.contextLimit}
            min={8192}
            max={2000000}
            step={1000}
            onChange={(e) => void patch({ llm: { contextLimit: Number(e.target.value) } })}
          />
        </Field>
      </div>

      <div className="border-t border-white/[0.06] pt-4">
        <TestButton kind="llm" />
      </div>
    </div>
  )
}
