import { useConfigStore } from '../store'
import { Field, TextInput } from './SettingsModal'

export function TelemetryTab(): React.ReactElement {
  const config = useConfigStore((s) => s.config)
  const patch = useConfigStore((s) => s.patch)
  if (!config) return <p className="text-white/40">loading…</p>
  const { telemetry, triggers } = config

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3">
        <Field label="UDP 端口" hint="F1 25 默认 20777">
          <TextInput
            type="number"
            value={telemetry.port}
            onChange={(e) => void patch({ telemetry: { port: Number(e.target.value) } })}
          />
        </Field>
        <Field label="渲染刷新率 (Hz)" hint="UI 重绘频率，默认 12">
          <TextInput
            type="number"
            value={telemetry.rendererPaintHz}
            min={2}
            max={30}
            onChange={(e) => void patch({ telemetry: { rendererPaintHz: Number(e.target.value) } })}
          />
        </Field>
      </div>

      <div className="border-t border-white/[0.06] pt-4">
        <div className="label mb-2">触发阈值</div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="轮胎磨损告警 %">
            <TextInput
              value={triggers.tyreWearLevels.join(', ')}
              onChange={(e) =>
                void patch({
                  triggers: {
                    tyreWearLevels: e.target.value
                      .split(',')
                      .map((x) => Number(x.trim()))
                      .filter((n) => !isNaN(n))
                  }
                })
              }
            />
          </Field>
          <Field label={`防守/进攻距离 (s): ${triggers.defendGapS.toFixed(1)}`}>
            <input
              type="range"
              min={0.3}
              max={2}
              step={0.1}
              value={triggers.defendGapS}
              onChange={(e) =>
                void patch({ triggers: { defendGapS: Number(e.target.value), attackGapS: Number(e.target.value) } })
              }
              className="h-1 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-accent-carbon"
            />
          </Field>
          <Field label={`轮胎内部温度上限 (°C): ${triggers.tyreHotC}`}>
            <input
              type="range"
              min={95}
              max={140}
              step={1}
              value={triggers.tyreHotC}
              onChange={(e) => void patch({ triggers: { tyreHotC: Number(e.target.value) } })}
              className="h-1 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-accent-carbon"
            />
          </Field>
          <Field label={`低油量阈值 (kg): ${triggers.lowFuelKg}`}>
            <input
              type="range"
              min={1}
              max={15}
              step={0.5}
              value={triggers.lowFuelKg}
              onChange={(e) => void patch({ triggers: { lowFuelKg: Number(e.target.value) } })}
              className="h-1 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-accent-carbon"
            />
          </Field>
          <Field label={`心跳间隔 (s): ${triggers.heartbeatIntervalS}`}>
            <input
              type="range"
              min={60}
              max={300}
              step={5}
              value={triggers.heartbeatIntervalS}
              onChange={(e) => void patch({ triggers: { heartbeatIntervalS: Number(e.target.value) } })}
              className="h-1 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-accent-carbon"
            />
          </Field>
          <Field label={`最小播报间隔 (s): ${triggers.globalMinGapS}`}>
            <input
              type="range"
              min={8}
              max={45}
              step={1}
              value={triggers.globalMinGapS}
              onChange={(e) => void patch({ triggers: { globalMinGapS: Number(e.target.value) } })}
              className="h-1 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-accent-carbon"
            />
          </Field>
        </div>
        <label className="mt-3 flex items-center gap-2 text-xs text-white/60">
          <input
            type="checkbox"
            checked={triggers.suppressFirstLap}
            onChange={(e) => void patch({ triggers: { suppressFirstLap: e.target.checked } })}
            className="accent-accent-carbon"
          />
          第一圈抑制非紧急播报（避免发车混乱）
        </label>
      </div>
    </div>
  )
}
