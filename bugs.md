# 潜在 Bug / 风险汇总（第四版 — 跨模块一致性审计）

> 本次扫描覆盖全量 `src/**/*.{ts,tsx}`、`tests/`、构建配置与 README_for_agent.md，采用四路并行 cross-module 审查 + 逐模块逐行 review。
> 所有发现均交叉校验过代码中实际的字段定义与读写，仅报告可验证的 concrete bug。

---

## Critical

### C1. `isRedFlag` 一旦置 `true` 后不再恢复，整个 session 残留
- **位置**：`src/main/state/StateAggregator.ts:67`
- **问题**：`s.isRedFlag = (p.m_numRedFlagPeriods ?? 0) > 0`。`m_numRedFlagPeriods` 是累计计数器，红旗期间递增，恢复比赛后不减。一次红旗过后，`isRedFlag` 永久为 `true`。
- **影响**：Digest 永久显示 `SC: RED`；HUD 永久显示红旗横幅；触发器持续认为处于红旗状态。
- **修复**：改用 `m_safetyCarStatus === 5`（racing resumed）重置 `isRedFlag = false`，或从 Event packet 的 `RDFL` 码触发状态切换。

### C2. `rivalStatus` 将 `driverStatus === 4`（on track）错误映射为 `'retired'`
- **位置**：`src/main/state/StateAggregator.ts:552`
- **问题**：F1 规格 `driverStatus`：`0=garage, 1=flying, 2=inlap, 3=outlap, 4=on track`。代码 `driverStatus === 4` 被判为 `'retired'`，实际上 `4` 是正常行驶状态。
- **影响**：正常行驶的对手被标记为 `retired`，RivalsPanel 显示 `DNF`，digest 中 `note: 'DNF'`，LLM 收到假退赛信息。
- **修复**：移除 `driverStatus === 4` 条件，退赛应只用 `resultStatus === 4 || 5 || 6`。

### C3. 多个类型字段定义了但从未被遥测写入
- **位置**：
  - `src/shared/types/state.ts:77-78` → `PlayerCarState.sectors` / `sectorSplitDelta`
  - `src/shared/types/state.ts:90` → `PlayerCarState.fuelTargetDeltaS`
  - `src/shared/types/state.ts:131,133` → `WeatherState.predictedWetness` / `predictedCode`
  - `src/shared/types/state.ts:106` → `RivalState.carClass`
- **问题**：以上字段均在类型和 `emptyRaceState()` 中定义，但 `StateAggregator` 没有任何 reducer 写入它们。F1 UDP 包中有对应的原始字段（如 `m_sector1TimeInMS`、`m_fuelTargetDelta`、`m_carClass`、forecast samples），但均未被读取。
- **影响**：这些字段永远为初始值（null 或 0），任何人读取都将得到脏数据。
- **修复**：在对应 reducer 中填充这些字段，或从类型中删除。

---

## High

### H1. `gapToPlayerS` walk-up 在前车链中使用了后车的前向 delta，而非玩家自身 gap
- **位置**：`src/main/state/StateAggregator.ts:190-208`
- **问题**：walk-up 累积的是 `sorted[i].deltaToCarBehindS`。但 `deltaToCarBehindS` 由 `sorted[i+1].deltaToCarInFrontS` 赋值得来（line 162），而紧邻玩家的前车（`i = playerIdxInSorted - 1`）的 `deltaToCarBehindS` = 紧邻玩家的 **后车**的 `deltaToCarInFrontS`——即后车到它再前面那辆车的 gap，而不是玩家到前车的 gap。玩家不在 sorted 数组中，所以玩家自己的 `deltaToCarInFrontS` 从未参与计算。
- **影响**：前车差距链不走玩家，数值被污染。
- **修复**：紧邻玩家的前车需使用玩家自身的 `deltaToCarInFrontS`（从 `state.player` 获取），或显式将玩家注入 sorted 链。

### H2. `driverStatus === 4` 标记为 `retired` → 见 C2（最高严重性）

### H3. `PACKET_NAMES` 索引依赖 `Object.keys` 插入序，库升级即崩溃
- **位置**：`src/main/telemetry/UdpReceiver.ts:9`
- **问题**：`const PACKET_NAMES = Object.keys(PACKETS) as string[]` 按库插入序排列，然后用 `packetId` 做索引查 `expectedSize`。如果 `@deltazeroproduction/f1-udp-parser` 将来更改 `PACKETS` 对象的字段顺序，`PACKET_NAMES[6]` 可能不再是 `'carTelemetry'`，导致长度校验用错值。
- **修复**：按实际 packetId 构建一个显式 `Map<number, string>`。

### H4. `lapDistancePct` 降级到 `m_totalDistance`（累计距离）严重偏小
- **位置**：`src/main/state/StateAggregator.ts:132,174`
- **问题**：注释明确指出“use track length not total distance”，但回退表达式 `trackLengthM || d.m_totalDistance || 1` 在 `trackLengthM === 0` 时把累计距离当除数。赛程中期 `m_totalDistance` 可达 150km+，导致百分比变成 0.007 而不是 0.2。
- **修复**：trackLengthM 为 0 时不应 fallback 到 m_totalDistance，要么跳过百分比计算，要么在 session 包到达后才设置。

### H5. `normalizeURL` 正则无法匹配单段 `/v1` 路径，导致 `/v1/v1`
- **位置**：`src/main/config/env.ts:126`
- **问题**：正则 `^(https?:\/\/[^/]+\/[^/]*\/v\d+)(?:\/.*)?$` 要求 `/vN` 前必须有路径段，对 `https://api.deepseek.com/v1` 无法匹配，追加 `/v1` 得到 `.../v1/v1`。
- **修复**：简化正则，直接检测 URL 中是否包含 `/v\d(self-indented-number)`，或使用 `URL` 标准库解析。

### H6. `evalPositionChange` 首个 tick 误触发 + 丢失 lap 0→1 的合法转换
- **位置**：`src/main/triggers/TriggerEngine.ts:29,238`
- **问题**：`lastLap` 初始化为 `-1`。首次 evaluate（formation lap, lap=0）时：`lastLap !== 0` 为 true，`lap === -1+1` 为 true，被当作一次“圈转换”触发虚假的 `position_loss/gain`。此后 `lastLap = 0`，lap 0→1 时 `lastLap !== 0` 为 false，合法转换被跳过。
- **修复**：`lastLap` 初始化为 `0`。

### H7. Audio preemption 在新 utterance 首段 ~90ms 静音
- **位置**：`src/renderer/audio/WebAudioEngine.ts:66-93`
- **问题**：`preempt()` 立即把 `activeUtteranceId` 切换到新 utterance，但 master gain 正在向 0.0001 fade。新 chunk 在这 80ms 内被调度到旧 `nextStart` 位置，然后在 90ms 后的 `setTimeout` 中被 `stopAll()` 一并清除。
- **影响**：抢断后新语音的前 ~90ms 音频永久缺失。
- **修复**：将 `nextStart` 重置延迟到 setTimeout 内部，避免新 chunk 落入 fade 窗口。

### H8. `AudioStart.priority` 有 `'preempt'` 但实际流程中永不发送
- **位置**：`src/shared/types/audio.ts:2` vs `src/shared/types/ipc.ts:63`
- **问题**：`Priority` 类型 = `'critical' | 'high' | 'normal' | 'low'`，不含 `'preempt'`。`SynthRequest.priority: Priority`。因此 `AudioPipeline.enqueue` 发给 `audio:start` 的 payload 中 `priority` 永远是 Priority 之一。`WebAudioEngine.preempt()` 中的 `start.priority === 'preempt'` 分支从不执行。
- **影响**：preempt fade logic 死代码。实际抢断走 `enqueue` 的 abort + queue 路径，不走 `priority: 'preempt'` 通道。
- **修复**：要么移除 `AudioStart` 的 `'preempt'` variant，要么让 `AudioPipeline` 在 preempt 路径中发送 `priority: 'preempt'`。

---

## Medium

### M1. `readGapS` 在两个 gap 字段均 undefined 时返回 0 而非 null
- **位置**：`src/main/state/StateAggregator.ts:536-539`
- **问题**：`minPart` 和 `msPart` 默认为 0，`totalMs = 0`，函数返回 `0 / 1000 = 0`。但两个字段均为 undefined 时应表示“无数据”（null）。
- **影响**：无数据的车辆被标记为 0s 差距，污染累积 gap walk。
- **修复**：当两个字段中至少一个有效时才计算，否则返回 null。

### M2. SC/VSC ended 在 status 4（VSC ending）时误触发
- **位置**：`src/main/state/StateAggregator.ts:74-76`
- **问题**：ended 事件检测 `!decoded.sc && !decoded.vsc && !decoded.formation`，SC/VSC → 4（VSC ending）时该条件为 true，但实际比赛未恢复。
- **修复**：仅在 `scStatus === 0 || scStatus === 5` 时触发 ended。

### M3. 5 个 `TriggerConfig` 字段声明但从未被 `TriggerEngine` 读取
- **位置**：`src/shared/types/triggers.ts:21-27`
- **字段**：`defendClosingS`、`pitWindowLeadLaps`、`lowFuelLapMultiplier`、`stintEndLapRatio`、`damageSuspThreshold`、`ersLowPct`
- **影响**：用户可在 UI 配置这些值并持久化，但运行时毫无作用。配置契约不可信。
- **修复**：实现对应触发规则，或标记为 reserved/removed。

### M4. `LlmClient.ping()` 抛错而非返回 `false`
- **位置**：`src/main/engineer/LlmClient.ts:76`
- **问题**：函数签名 `Promise<boolean>` 但 `catch` 中 `throw err`。`config:test:llm` 的调用者虽然用 try/catch 包裹，但类型承诺被否决。
- **修复**：catch 中 `return false`。

### M5. `config:test:tts` 无超时，连接挂起时 UI 永久冻结
- **位置**：`src/main/ipc/register.ts:41-53`
- **问题**：`client.synthesize(...)` 无 AbortSignal 或 timeout。服务器无响应时，测试按钮永久显示 "测试中……"。
- **修复**：添加 `AbortSignal.timeout(15000)` 或 race-with-timeout 包装。

### M6. `ENV_KEYS` 将 `aiModel` 映射到 `AI_MODEL`，但 `.env` 中用户可能写 `AI_API_MODEL`
- **位置**：`src/main/config/env.ts:94-97`
- **问题**：`fromProcess` 读取 `process.env.AI_API_MODEL ?? process.env.AI_MODEL`（兼顾两个变量名），但 `ENV_KEYS` 对于文件 `.env` 只查 `AI_MODEL`。如果用户在 `.env` 中写 `AI_API_MODEL=...`，该值被文件层忽略。
- **修复**：`ENV_KEYS` 也尝试 `AI_API_MODEL`，或在文件解析中处理同义键名。

### M7. `session:meta` IPC 通道主进程发、渲染端无订阅者
- **位置**：`TelemetryService.ts:84` / `index.ts:58` → 无渲染端 handler
- **问题**：`session:meta` 在 `did-finish-load` 时 flush，也随 track/format 变更发送，但 IpcProvider 从未订阅。
- **修复**：添加 handler 或移除未使用的 flush。

### M8. `DigestBuilder` 注释声称有 fallback 到 `deltaToCarInFrontS`，但代码未实现
- **位置**：`src/main/engineer/DigestBuilder.ts:139-141`
- **问题**：注释说“or the player's own deltaToCarInFrontS for the directly-adjacent car”，但代码只读 `ahead.gapToPlayerS`，无 fallback。
- **修复**：实现 fallback 或更新注释。

### M9. `RaceState.lastPacketMs` 定义但从未被更新（死字段）
- **位置**：`src/shared/types/state.ts:201`、`defaults.ts:97`
- **问题**：实际 last-packet 时间戳在 `UdpReceiver.lastPacketMs`，`RaceState` 同名字段永远为 0。
- **修复**：删除或由 StateAggregator 同步更新。

---

## Low

### L1. `gapToPlayerS` 对零差距车辆返回 null 而非 0
- **位置**：`src/main/state/StateAggregator.ts:199,206`
- **问题**：`cumAhead > 0 ? cumAhead : null`——零差距时得到 null，被当作“无数据”。
- **修复**：改为 `>= 0`。

### L2. `DamagePanel` 未显示 ES / CE / turbo 三个动力单元组件
- **位置**：`src/renderer/components/damage/DamagePanel.tsx:34-44`
- **修复**：补齐 `DamageBar`。

### L3. macOS 关闭所有窗口后 telemetry 被 `stop()`，重启窗口不恢复
- **位置**：`src/main/index.ts:117,121-123`
- **修复**：activate 中调用 `telemetry?.start()` 或延迟 stop。

### L4. Mixed 语言模式中 `mimo_default` 嗓音重复出现
- **位置**：`src/shared/constants/voices.ts:52` — `[...zh, ...en]`，两份 `mimo_default`
- **修复**：去重。

### L5. `fmtLapTime` 接收毫秒但 state 存秒——调用方需手动 `* 1000`
- **位置**：`src/shared/util/format.ts:3`
- **修复**：重命名为 `fmtLapTimeMs` 或改为接收秒。

### L6. `SseParser.reset()` 不清空 `TextDecoder` 内部状态
- **位置**：`src/main/tts/SseParser.ts:39-41`
- **问题**：跨流复用 TextDecoder 在多字节字符截断时有理论风险。
- **修复**：实际 SSE 数据只含 ASCII，风险极低。可保留现状。

### L7. `LlmClient` 使用 `as any` 绕过 OpenAI SDK 类型检查
- **位置**：`src/main/engineer/LlmClient.ts:71,117-120`
- **修复**：SDK 升级时需验证兼容性，无立即 bug。

---

## 已确认修复项（之前版本已解决，本版不再报告）

| 问题 | 状态 |
|------|------|
| DRS bitfield 检测 `(m_drs & 2) !== 0` | ✅ 正确 |
| `onTrack` 使用 `>= 1 && <= 4` | ✅ 正确 |
| `lapDistancePct` 主路径使用 `trackLengthM` | ✅ 正确（仅 fallback 有风险 — 见 H4） |
| gap 累积 walk 方向（walk-up 改用 deltaToCarBehindS） | ✅ walk-up 方向正确，但首段 gap 值源错误（见 H1） |
| `readGapS` `>= 0` | ✅ 正确 |
| `ensureRival` position 初始 0 | ✅ 正确 |
| `normalizeURL` 已改写 | ⚠️ 仍有 bug（见 H5） |
| `EngineerService.enqueue` 优先级检查 | ✅ 正确 |
| `AudioPipeline.cancelAll` 发送 audio:end | ✅ 正确 |
| `WebAudioEngine audio:end` 调用 stopAll | ✅ 正确 |
| `WebAudioEngine audio:start` 调用 stopAll | ✅ 正确 |
| `MiMoTtsClient abort` re-throw | ✅ 正确 |
| MiMoTtsClient signal listener remove | ✅ 正确 |
| `AudioControls` narrow selector | ✅ 正确 |
| `TopStrip` timeLeft clamp | ✅ 正确 |
| `TopStrip` health selector | ✅ 正确 |
| SC/VSC 结束事件 | ✅ 已加入（但有 case 4 误触发 — 见 M2） |
| Event codes OVTK/COLL/SPIN 等 | ✅ 已加入 |
| Trigger kind 分类扩展到更多事件 | ✅ 正确 |
| wetness 读取 | ✅ 正确 |
| rainOnset 重置 | ✅ 正确 |
| digest DRS 三元顺序 | ✅ 正确 |
| `fmtBehindGap` Math.abs | ✅ 正确 |
| `void get()` 删除 | ✅ 正确 |
