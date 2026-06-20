# 潜在 Bug / 风险汇总（第三版，基于当前代码）

> 阅读范围：全量 `src/**/*.{ts,tsx}`、`tests/`、构建配置。仅汇总，未修改代码。
> 许多前两轮发现的问题已在当前代码中修复（玩家差距排序、圈速格式化、BaseURL 规范化、LLM 消息交替、音频取消通知、低油量滞回等），以下仅列出当前代码中仍存在的问题。

---

## 1. 状态聚合

### 1.1 `TelemetryService` 未在 session 切换时调用 `aggregator.reset()`
- **位置**：`src/main/telemetry/TelemetryService.ts`（无调用 `reset` 的代码）
- **问题**：`StateAggregator.onSession` 检测到 `sessionChanged` 但仅打日志，不调用 `reset()`。旧 session 的 `rivals` 条目会残留。
- **影响**：若新 session 赛车数量不同（如排位 → 正赛从 20 变 22 车），旧条目可能残留并短暂显示错误的车名/车队。
- **修复**：在 `TelemetryService` 中检测 `sessionChanged` 后调用 `aggregator.reset(format)`。

### 1.2 `rivalStatus` 未完整映射 F1 规格
- **位置**：`src/main/state/StateAggregator.ts:461-466`
- **问题**：仅处理 `resultStatus === 3`（finished）、`=== 4`（DSQ）、`driverStatus === 4/0/7`，遗漏 `resultStatus === 6`（retired）、`=== 5`（not classified）。
- **影响**：这些车辆被显示为 `running`。
- **修复**：补充 `resultStatus === 6 || resultStatus === 5`。

### 1.3 `isRedFlag` 未被设置
- **位置**：`src/main/state/StateAggregator.ts:39-91`
- **问题**：`onSession` 没有读取 `m_numRedFlagPeriods`，`isRedFlag` 永远为 `false`。
- **影响**：红旗事件无法触发 UI/触发器响应。
- **修复**：在 `onSession` 中设置 `s.isRedFlag = p.m_numRedFlagPeriods > 0`。

### 1.4 `relationToPlayer` 类型允许 `leader | lapped | lapping` 但从未使用
- **位置**：`src/main/state/StateAggregator.ts:196-199`
- **问题**：仅设置 `ahead | behind | same`，`leader`（领跑）、`lapped`（被套圈）、`lapping`（套圈中）从未出现。
- **影响**：UI 无法区分领跑者和普通前车，也无法识别套圈关系。
- **修复**：根据 `lap` 差值和位置判断 leader/lapped/lapping。

### 1.5 `isDupe` 去重桶在大量事件时可能误删近期条目
- **位置**：`src/main/state/StateAggregator.ts:408-412`
- **问题**：桶超过 200 条时裁剪后半部分（`arr.slice(arr.length / 2)`），但这不是按时间排序的，可能删掉最近的条目。
- **影响**：极端情况下近期事件可能被错误去重。
- **修复**：使用 `Map`（保持插入顺序）并按时间戳裁剪。

### 1.6 `onSession` 中 `prevSC` 未在 session 切换时重置
- **位置**：`src/main/state/StateAggregator.ts:20,66-69`
- **问题**：`prevSC` 是 session 间持久的，新 session 开始时若安全车状态与旧 session 末尾相同，SC 事件不会触发。
- **影响**：新 session 以安全车状态开始时不会发出部署事件。
- **修复**：在 session 切换时 `this.prevSC = 0`。

---

## 2. 触发器

### 2.1 `suppressLastLapLowPriority` 配置未实现
- **位置**：`src/shared/types/triggers.ts:36`、`src/main/triggers/TriggerEngine.ts`
- **问题**：配置中存在 `suppressLastLapLowPriority`，但 `TriggerEngine` 从未引用。
- **影响**：用户在设置中开启"末圈抑制低优先级"后无效果。
- **修复**：在 `tryFire` 中判断 `state.player.lap === state.session.totalLaps` 且非 critical 时跳过。

### 2.2 `evalTyreTemp` 首包时可能误报"轮胎过冷"
- **位置**：`src/main/triggers/TriggerEngine.ts:147`
- **问题**：`surf > 0 && surf < tyreColdC`——在数据未初始化时 `surfaceTempC` 默认为 0，`surf > 0` 为 false，不会误触发。但如果游戏刚启动且温度极低（如 >0 但 <80），会在首次评估时触发，而非等到"上升沿"后再下降。
- **影响**：正常情况下可接受，但若首包数据异常可能误触发。
- **修复**：可增加 `state.session.lastUpdateMs > 0` 作为数据就绪条件。

### 2.3 `Cooldown` 的 `perRuleCooldownS` 在 config 变更时不会重置
- **位置**：`src/main/triggers/Cooldown.ts`
- **问题**：`byRule` Map 保留旧的 cooldown 时间戳；用户在 UI 调整阈值后，旧规则的 75s 冷却仍生效。
- **影响**：改配置后短时间内规则不会重新触发。
- **修复**：在 `EngineerService.setConfig` 或 `TriggerEngine` 的 config 更新时清空 `byRule`。

---

## 3. 工程师 / LLM

### 3.1 `EngineerService.enqueue` 无条件覆盖 pending，忽略优先级
- **位置**：`src/main/engineer/EngineerService.ts:66-73`
- **问题**：注释说 "higher-or-equal priority replaces"，但代码直接 `this.pending = { state, firing }`。
- **影响**：低优先级触发会挤掉排队中的高优先级触发（如安全车被低优先级覆盖）。
- **修复**：比较 `firing.priority` 与 `this.pending.firing.priority`，仅在新触发优先级 >= 时替换。

### 3.2 `advise` 中的 idle timer 不可取消
- **位置**：`src/main/engineer/EngineerService.ts:137,147`
- **问题**：`setTimeout(() => ... 'idle'), 6000/4000)` 未保存 handle。
- **影响**：若 `cancel()` 后立即开始新请求，旧 timer 仍会发送 `idle` 状态，可能覆盖新请求的 `thinking/speaking`。
- **修复**：保存 timer handle，在 `cancel` 或新 `advise` 开始时清除。

### 3.3 `cancel()` 不中止 `inFlight` promise
- **位置**：`src/main/engineer/EngineerService.ts:89-95`
- **问题**：`cancel()` 设 `this.pending = null` 并调用 `llm?.cancel?.()`，但 `inFlight` 引用的 promise 仍继续运行直到 LLM abort 完成。若 LLM 未正确抛出 abort 错误，`inFlight` 可能永远不会 resolve。
- **影响**：极端情况下 `inFlight` 卡住，后续所有 enqueue 被阻塞。
- **修复**：增加 `inFlight` 超时保护，或在 `cancel` 中设置标志让 `run` 的 `finally` 立即执行。

---

## 4. 音频 / 渲染

### 4.1 `AudioPipeline.cancelAll` 发送 `audio:end` 但渲染端未处理
- **位置**：`src/main/audio/AudioPipeline.ts:89-91`、`src/renderer/audio/WebAudioEngine.ts:145-147`
- **问题**：`cancelAll` 发送 `audio:end`，但渲染端 handler 为空（`/* scheduling handles itself */`）。已调度的 `BufferSourceNode` 继续播放。
- **影响**：点击 Stop 后当前语音仍继续播放直到自然结束。
- **修复**：在 `audio:end` handler 中停止所有活跃 source 节点并清空 `active` 集合。

### 4.2 `WebAudioEngine` 在非 preempt 的 `audio:start` 时不清理旧 source
- **位置**：`src/renderer/audio/WebAudioEngine.ts:135-142`
- **问题**：`audio:start` 仅设置 `activeUtteranceId`，不停止已调度的旧 source。新旧音频重叠播放。
- **影响**：快速连续触发时（非抢占优先级），新旧语音重叠。
- **修复**：在 `setActiveUtterance` 中也执行旧 source 的停止逻辑。

### 4.3 `WebAudioEngine.setMuted`/`setVolume` 与 `preempt()` 的 `linearRamp` 冲突
- **位置**：`src/renderer/audio/WebAudioEngine.ts:93-100, 74-90`
- **问题**：`setMuted`/`setVolume` 直接赋值 `gain.value`，但 `preempt()` 使用 `linearRampToValueAtTime`。直接赋值会覆盖未执行的 ramp。
- **影响**：在 preempt 过程中切换静音/音量可能导致音频 glitch（静音后又被 ramp 恢复）。
- **修复**：`setMuted`/`setVolume` 中先调用 `cancelScheduledValues` 再赋值。

### 4.4 `WebAudioEngine.onChunk` 在 `activeUtteranceId === null` 时丢弃所有 chunk
- **位置**：`src/renderer/audio/WebAudioEngine.ts:42-45`
- **问题**：若 `audio:chunk` 在首次 `audio:start` 之前到达，`activeUtteranceId` 为 null，所有 chunk 被丢弃。
- **影响**：极少数情况下丢失首段音频。
- **修复**：在首个 `audio:start` 之前缓存少量 chunk。

### 4.5 `SseParser` 不支持多行 `data:` 事件
- **位置**：`src/main/tts/SseParser.ts:18-36`
- **问题**：按行解析，不按 SSE 规范合并多行 `data:` 事件。
- **影响**：若 MiMo 返回多行 `data:` 事件，解析失败。
- **修复**：缓存 `data:` 行，遇到空行后拼接再 parse。

### 4.6 `MiMoTtsClient.synthesize` 未检查外部 signal 是否已 abort
- **位置**：`src/main/tts/MiMoTtsClient.ts:45-68`
- **问题**：只监听 `signal` 的 `abort` 事件，不检查 `signal.aborted`。
- **影响**：传入已取消的 signal 时仍发起请求。
- **修复**：顶部 `if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')`。

---

## 5. 配置 / 环境

### 5.1 `env.ts` 的 `normalizeURL` 对带路径的 URL 会重复追加 `/v1`
- **位置**：`src/main/config/env.ts:114-123`
- **问题**：正则 `/(\/v\d+)$/` 仅匹配末尾。若 URL 是 `https://api.example.com/proxy/v2/chat`，会变成 `.../v2/chat/v1`。
- **影响**：使用代理或自定义路径的用户会 404。
- **修复**：仅在路径为空或 `/` 时追加，或明确文档只接受 base URL。

### 5.2 `ConfigStore.getAll()` 在 `app.whenReady()` 之前调用
- **位置**：`src/main/index.ts:77`
- **问题**：模块顶层调用 `ConfigStore.getAll()`，可能在 Electron `app` 未就绪时访问 `app.getPath`。
- **影响**：某些 Electron 版本/便携构建可能抛错或取错路径。
- **修复**：移到 `app.whenReady()` 内部。

### 5.3 `ConfigStore.patch` 无字段校验
- **位置**：`src/main/config/ConfigStore.ts:33-46`
- **问题**：直接写入 electron-store，不校验范围/类型。
- **影响**：UI 可写入非法值（如负数 port、volume > 1）。
- **修复**：增加基础校验/裁剪。

---

## 6. 测试覆盖缺口

| 未覆盖区域 | 风险等级 |
|-----------|---------|
| `StateAggregator` 所有 reducer | High — gap/position/damage 是核心逻辑 |
| 触发器：tyre temp、low fuel、rain、position change、attack、flashback | High — 大量生产逻辑无回归保护 |
| `AudioPipeline` 抢断/去重/队列 | Medium |
| `LlmClient` abort/watchdog/usage | Medium |
| `MiMoTtsClient` 非 2xx/abort | Medium |
| 渲染组件（React） | Medium |
| `live-udp-inject.mjs` 不验证解析结果 | Low |
| `screenshot.mjs` 未注册 IPC 处理器 | Low |
| `vitest.config.ts` 仅含 `.test.ts`，不含 `.tsx` | Low |

---

## 附录：优先级修复建议

| 优先级 | 修复项 |
|--------|--------|
| P0 | 4.1（cancelAll 不停旧音频）、4.2（audio:start 不清理旧 source） |
| P1 | 3.1（enqueue 优先级）、1.1（session 切换 reset）、3.2（idle timer 不可取消） |
| P2 | 1.3（isRedFlag）、1.4（relationToPlayer）、2.1（suppressLastLap） |
| P3 | 测试补齐、配置校验、CSP/IPC 规范化 |
