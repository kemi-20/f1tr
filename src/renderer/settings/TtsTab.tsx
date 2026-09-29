import { useConfigStore } from '../store'
import { ApiKeyField, Field, TextInput, TestButton } from './SettingsModal'
import { useEffect, useState } from 'react'
import { api } from '../ipc/ipcClient'

export function TtsTab(): React.ReactElement {
  const [hasGpSample, setHasGpSample] = useState(false)
  const [sampleMessage, setSampleMessage] = useState('')
  useEffect(() => { void api.gpVoiceSampleStatus().then(setHasGpSample) }, [])
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

      <Field label="GP 风格语音参考" hint="仅 GP 风格使用。选择你有权使用的 WAV/MP3；音频保存在本机，合成时会发送给 MiMo。">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="rounded border border-white/20 px-3 py-2 text-xs text-white/80 hover:border-white/50"
            onClick={() => void api.chooseGpVoiceSample().then((result) => { setSampleMessage(result.message); if (result.ok) setHasGpSample(true) })}>
            选择参考音频
          </button>
          {hasGpSample && <button type="button" className="rounded border border-white/20 px-3 py-2 text-xs text-white/80 hover:border-white/50"
            onClick={() => void api.clearGpVoiceSample().then(() => { setHasGpSample(false); setSampleMessage('参考音频已清除。') })}>
            清除
          </button>}
          <span className="text-xs text-white/50">{hasGpSample ? '已启用 GP voiceclone' : '未设置，使用预置音色'}</span>
        </div>
        {sampleMessage && <p className="mt-2 text-xs text-white/60" role="status">{sampleMessage}</p>}
      </Field>

      <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-xs leading-relaxed text-white/50">
        MiMo 音频为 <span className="text-white/70 num-mono">24000Hz · 单声道 · int16</span>，由 Web Audio 流式播放。
        普通 TTS 增量推送 PCM。voiceclone 目前仅兼容流式格式，整段合成后才返回；克隆请求被限流时会暂时改用选中的预置音色。
      </div>

      <div className="border-t border-white/[0.06] pt-4">
        <TestButton kind="tts" />
      </div>
    </div>
  )
}
