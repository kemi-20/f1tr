# 潜在 Bug / 风险汇总（完整扫描版）

> 基于 `README_for_agent.md`、全量 `src/**/*.{ts,tsx}`、`tests/`、构建配置及依赖库的完整重扫。仅汇总，未修改代码。

---

## 0. 关键结论（最值得优先修复）

1. **`StateAggregator.onLapData` 没有把玩家加入排序列表**，导致 `gapToPlayerS` 累积逻辑完全失效，所有“到玩家差距”都是 `null/undefined`。
2. **`lapDistancePct` 用错了除数**：使用累计行驶距离 `m_totalDistance` 而非单圈长度 `m_trackLength`，导致赛道百分比随比赛进行越来越小。
3. **差距/触发字段多处用错**：进攻触发、`fmtAheadGap`/`fmtBehindGap`、`gapToPlayerS` 累积均依赖错误字段。
4. **`EngineerService.enqueue` 无条件覆盖 pending 请求**，低优先级触发会挤掉排队中的高优先级触发。
5. **TTS/LLM BaseURL 未做 `/v1` 规范化**，用户在 UI 填入不带版本号的地址时直接 404。
6. **`AudioPipeline` 取消/抢断时不通知渲染端**，Stop 按钮后旧语音仍继续播放。
7. **`TopStrip` 把秒值当毫秒传给 `fmtLapTime`**，Last/Best 圈速显示错误。

---

## 1. 状态聚合 / F1 UDP 解码

### 1.1 玩家未加入排序列表，`gapToPlayerS` 累积逻辑失效 — Critical
- **位置**：`src/main/state/StateAggregator.ts:139-191`
- **问题**：
  ```ts
  const sorted = Object.values(this.state.rivals).slice().sort((a, b) => a.position - b.position)
  const playerIdxInSorted = sorted.findIndex((r) => r.position === playerPos)
  if (playerIdxInSorted >= 0) { ... }
  ```
  `sorted` 只包含对手，玩家对象 `state.player` 不在其中，因此 `playerIdxInSorted` 恒为 `-1`，`if` 内所有累积代码永不被执行。
- **影响**：`gapToPlayerS` 对所有车辆均为 `undefined`；依赖该字段的触发、Digest 文本、UI 均显示错误。
- **修复**：将玩家对象也放入 `sorted` 数组，或单独维护一条包含玩家的位置链。

### 1.2 `lapDistancePct` 使用累计距离而非赛道长度 — Critical
- **位置**：`src/main/state/StateAggregator.ts:117,157`
- **问题**：`r.lapDistancePct = clamp01((d.m_lapDistance ?? 0) / Math.max(1, d.m_totalDistance ?? 1))`。`m_totalDistance` 是本场累计行驶距离，不是单圈长度。
- **影响**：随着比赛进行，百分比会偏离真实位置；赛道图、Drs/sector 逻辑均受影响。
- **修复**：从 Session 包读取 `m_trackLength` 并存入 `state.session.trackLengthM`，用它做除数。

### 1.3 玩家 `onTrack` 只认 `driverStatus === 1` — High
- **位置**：`src/main/state/StateAggregator.ts:164`
- **问题**：F1 规格中 `driverStatus` 1–4 都表示在赛道上（flying lap / in lap / out lap / on track），代码仅判断 `=== 1`。
- **影响**：进站圈、出场圈或正常行驶都会被显示为“不在赛道上”。
- **修复**：`pl.onTrack = (pld.m_driverStatus ?? 1) >= 1 && (pld.m_driverStatus ?? 1) <= 4`。

### 1.4 `isRedFlag` 从未被设置 — High
- **位置**：`src/main/state/StateAggregator.ts:39-91`
- **问题**：`SessionState.isRedFlag` 默认为 `false`，`onSession` 没有读取 `m_numRedFlagPeriods` 或 `RDFL` 事件。
- **影响**：红旗状态无法触发任何 UI/触发器。
- **修复**：在 `onSession` 中设置 `s.isRedFlag = p.m_numRedFlagPeriods > 0`，并在 `onEvent` 处理 `RDFL`。

### 1.5 `m_carPosition === 0` 被当作有效位置 — High
- **位置**：`src/main/state/StateAggregator.ts:115`
- **问题**：`numOr` 把 `0` 视为有效值，但 F1 规格中 `m_carPosition == 0` 表示无效/无数据。
- **影响**：位置可能闪烁为 0，导致排序、差距、UI 错乱。
- **修复**：对 `m_carPosition` 单独判断：`d.m_carPosition > 0 ? d.m_carPosition : r.position`。

### 1.6 对手轮胎配方从未更新 — Medium
- **位置**：`src/main/state/StateAggregator.ts:225-242`
- **问题**：`onCarStatus` 只更新玩家车辆的 `tyres.compound`，没有遍历对手。
- **影响**：`RivalsPanel` 中所有对手轮胎显示为 `unknown`。
- **修复**：遍历 `arr` 中所有车辆，更新对应 `rivals[i]` 的轮胎信息。

### 1.7 大量事件码未处理 — Medium
- **位置**：`src/main/state/StateAggregator.ts:307-331`
- **问题**：`SCAR`、`OVTK`、`COLL`、`DRSE`、`DRSD`、`RDFL`、`CHQF`、`SPTP`、`STLG`、`LGOT`、`FLBK` 等均未处理。
- **影响**：安全车结束、超车、碰撞、DRS 启用/禁区等事件被静默丢弃。
- **修复**：扩展 `onEvent` 的 switch，或至少把未知事件以 `info` 形式记录。

### 1.8 事件去重桶跨 session 不清空 — Medium
- **位置**：`src/main/state/StateAggregator.ts:397-407`
- **问题**：`lastEventBucket` 以 `${uid}:${key}` 为键，但 `reset()` 未清空它。
- **影响**：换 session 后，旧 session 的 key 仍会被去重，导致新比赛的安全车/降雨等事件可能漏发。
- **修复**：在 `reset()` 中 `this.lastEventBucket.clear()`。

### 1.9 `readGapS` 对 0 ms 的差距返回 `null` — Low
- **位置**：`src/main/state/StateAggregator.ts:431-441`
- **问题**：`totalMs > 0 ? totalMs / 1000 : null`，两车真实 0 s 差距时丢失有效值。
- **影响**：极小概率显示 `--` 而非 `0.000`。
- **修复**：使用 `totalMs >= 0` 判断，并排除 `msPart + minPart` 均为 undefined 的情况。

### 1.10 `rivalStatus` 未完整映射 F1 规格状态 — Low
- **位置**：`src/main/state/StateAggregator.ts:456-462`
- **问题**：只处理了 `resultStatus === 3`（finished）、`===4`（DSQ）、`driverStatus === 4/0/7`，遗漏 `resultStatus === 6`（retired）、`=== 5`（not classified）。
- **影响**：这些车辆被显示为 `running`。
- **修复**：补充 `resultStatus === 6 || resultStatus === 5` 的分支。

### 1.11 Session 类型标签可能不符合 2025 规格 — Medium
- **位置**：`src/main/state/mappings.ts:49-67`
- **问题**：当前映射把 10→TT、11→Practice、12→Qualifying、13→Race。2025 规格中这些编号对应 Sprint Shootout/Short Sprint/Race 等，可能不一致。
- **影响**：Session 标签显示错误（如真实 Race 被标为 “Race 2”）。
- **修复**：对照 `@deltazeroproduction/f1-udp-parser` 库或官方 UDP 规格重新映射。

---

## 2. 差距 / 触发器

### 2.1 进攻触发使用错误字段 — Critical
- **位置**：`src/main/triggers/TriggerEngine.ts:171-185`
- **问题**：判断进攻机会时检查 `ahead.deltaToCarInFrontS`，这是前车到它前面那辆车的距离，不是玩家到前车的距离。
- **影响**：攻击触发时机完全错误。
- **修复**：使用玩家自身的 `state.player.deltaToCarInFrontS`（或 `ahead.gapToPlayerS`）。

### 2.2 `fmtAheadGap` / `fmtBehindGap` 距离字段错误 — High
- **位置**：`src/main/engineer/DigestBuilder.ts:129-142`
- **问题**：
  - `fmtAheadGap` 取 `ahead.deltaToCarInFrontS`，这是前车到它前面车辆的差距，不是玩家到前车的差距。
  - `fmtBehindGap` 用 `behind.deltaToCarInFrontS` 虽然正负号可用，但应使用玩家/后车更直接的字段。
- **影响**：Digest 中 “to car ahead / behind” 的数值错误，LLM 根据错误信息给出建议。
- **修复**：使用 `state.player.deltaToCarInFrontS` / 后车 `deltaToCarBehindS` 等直接表示玩家与对手关系的字段。

### 2.3 `gapBehind` 渲染保留负号 — Medium
- **位置**：`src/main/engineer/DigestBuilder.ts:148`
- **问题**：直接传入 `gapToPlayerS`（后车为负），`fmtGap` 会输出 `-0.400`。
- **影响**：Digest 文本出现 `gap -0.400 to NORRIS`，语义混乱。
- **修复**：取 `Math.abs(...)`。

### 2.4 防守/进攻状态机在车消失后无法复位 — Medium
- **位置**：`src/main/triggers/TriggerEngine.ts:151-186`
- **问题**：`defendActive`/`attackActive` 只有在前车/后车存在时才会因 gap 变大而复位；若该车退赛或从数据中消失，状态保持为 `true`。
- **影响**：相关触发可能长期不再触发。
- **修复**：在找不到对应车辆时默认复位。

### 2.5 `evalPositionChange` 第一圈可能误触发 — Medium
- **位置**：`src/main/triggers/TriggerEngine.ts:213-231`
- **问题**：`lastLap` 初始为 `0`，玩家从 lap 0 进入 lap 1 时，`lap === lastLap + 1` 成立，且 `lastPosition` 初始为 `0`，会误报位置变化。
- **影响**：第一圈可能错误触发 `position_gain/loss`。
- **修复**：初始化 `lastLap = -1`，并在 lap <= 1 时不评估。

### 2.6 `suppressLastLapLowPriority` 配置项未生效 — Medium
- **位置**：`src/shared/types/triggers.ts:36`、`src/main/triggers/TriggerEngine.ts`
- **问题**：配置中存在 `suppressLastLapLowPriority`，但 `TriggerEngine` 从未引用。
- **影响**：用户在设置中开启“末圈抑制低优先级”后无效果。
- **修复**：在 `tryFire` 中判断 `state.player.lap === state.session.totalLaps` 且非 critical 时跳过。

### 2.7 `evalLowFuel` 无滞回 — Low
- **位置**：`src/main/triggers/TriggerEngine.ts:195-201`
- **问题**：只要油量低于阈值，每次 tick 都会尝试触发，依赖全局 cooldown 抑制。
- **影响**：油量低时每 8 秒重复播报。
- **修复**：增加 `fuelLowActive` 状态，仅在下探时触发一次，回升到阈值以上时复位。

### 2.8 `evalRain` 对 `rainPct >= 100` 静默 — Low
- **位置**：`src/main/triggers/TriggerEngine.ts:203-211`
- **问题**：触发条件包含 `rainPct < 100`，跳到 100 时完全不会触发。
- **影响**：雨真正下起来后不会播报。
- **修复**：移除 `< 100` 限制，或增加 `rain_started` 触发。

### 2.9 `noteFlashback` 未重置 `rainImminentActive` / `lastPosition` / `lastLap` — Low
- **位置**：`src/main/triggers/TriggerEngine.ts:85-95`
- **问题**：flashback 后只清空了 tyre/defend/attack 状态。
- **影响**：雨势/位置变化相关状态可能在新 timeline 上保持旧值。
- **修复**：在 `noteFlashback` 中同步重置这些字段。

### 2.10 胎温触发状态机只在 `surfaceTempC` 存在时评估 — Low
- **位置**：`src/main/triggers/TriggerEngine.ts:137-149`
- **问题**：`evalTyreTemp` 未考虑默认值 `0` 可能来自未初始化数据，导致刚进比赛时误报 “轮胎过冷”。
- **影响**：首包未到或数据异常时可能误触发。
- **修复**：增加数据就绪判断（如 `state.session.lastUpdateMs > 0` 或 lap > 0）。

---

## 3. 工程师 / LLM / TTS / 音频

### 3.1 `EngineerService.enqueue` 无条件覆盖 pending，忽略优先级 — High
- **位置**：`src/main/engineer/EngineerService.ts:59-66`
- **问题**：注释说“higher-or-equal priority 才替换”，但代码直接 `this.pending = { state, firing }`。
- **影响**：低优先级触发会挤掉排队中的高优先级触发。
- **修复**：比较 `firing.priority` 与 `this.pending.firing.priority`，仅在新触发优先级 >= 时才替换。

### 3.2 `ConversationMemory.build` 消息序列违反 OpenAI 交替规则 — High
- **位置**：`src/main/engineer/ConversationMemory.ts:65-78`
- **问题**：`recentAdvice` 只保存 assistant 回复，并连续推入 messages，最后才追加当前 user digest，形成 `system, assistant, assistant, ..., user`。
- **影响**：部分 OpenAI 兼容接口会拒绝非交替消息序列；即使通过，也会削弱对话一致性。
- **修复**：维护成对的 user/assistant 历史，或把每次 digest 与对应回复一起保存。

### 3.3 TTS/LLM BaseURL 未做 `/v1` 规范化 — High
- **位置**：`src/main/ipc/ttsRef.ts:32-46`、`src/main/ipc/engineerRef.ts:29-47`
- **问题**：用户 UI 填入 `api.xiaomimimo.com` 或 `api.deepseek.com` 时，代码直接拼接 `/chat/completions`，缺少 `/v1`。
- **影响**：请求 404。
- **修复**：在 `wireLlm`/`wireTts` 中调用 `normalizeURL` 处理 `cfg.llm.baseURL` / `cfg.tts.baseURL`。

### 3.4 `MiMoTtsClient` 未处理已 abort 的传入 signal — Medium
- **位置**：`src/main/tts/MiMoTtsClient.ts:45-68`
- **问题**：只监听 `signal` 的 `abort` 事件，没有在进入时检查 `signal.aborted`。
- **影响**：传入已取消 signal 时仍会发起请求。
- **修复**：顶部检查 `if (signal?.aborted) throw new AbortError()`。

### 3.5 `MiMoTtsClient` / `LlmClient` cancel 竞态可能 null 引用 — Medium
- **位置**：`src/main/tts/MiMoTtsClient.ts:35-37,65`、`src/main/engineer/LlmClient.ts:82-84,94`
- **问题**：`cancel()` 把 `this.abort` 置 null，而 `synthesize/generate` 创建新 controller 后才访问 `this.abort.signal`，两者可能交错。
- **影响**：在恰当时机点击 Stop 可能抛出 `TypeError`。
- **修复**：将 controller 保存为局部变量，取消时只 abort 局部变量指向的 controller。

### 3.6 `AudioPipeline` 取消/抢断不通知渲染端 — High
- **位置**：`src/main/audio/AudioPipeline.ts:66-91,87-91`
- **问题**：`cancelAll` 和高优先级抢占只取消 fetch/清空队列，没有发送任何 `audio:*` 事件让渲染端停止播放。
- **影响**：点击 Stop 或被抢断后，旧语音仍继续播放，与新语音重叠。
- **修复**：发送 `audio:end { utteranceId }` 或新增 `audio:clear` 事件，让 `WebAudioEngine` 停止当前 source。

### 3.7 `WebAudioEngine.preempt` 延迟重置 `nextStart` — High
- **位置**：`src/renderer/audio/WebAudioEngine.ts:65-89`
- **问题**：`nextStart` 在 `setTimeout(..., 90)` 内才重置，但新 utterance 的 chunk 可能立即到达并被 schedule 到旧的 `nextStart`。
- **影响**：抢断后新语音首段可能被安排到几秒甚至几分钟后。
- **修复**：在 `preempt()` 调用时立即 `this.nextStart = this.ctx.currentTime`。

### 3.8 `IpcProvider` 中 `wireAudioIpc()` 没有清理函数 — Medium
- **位置**：`src/renderer/providers/IpcProvider.tsx:17`
- **问题**：`useEffect` 调用 `wireAudioIpc()`，它内部注册 `api.on(...)` 但不返回清理函数；React StrictMode 下会重复注册。
- **影响**：开发时音频事件 listener 重复，导致重复播放/内存泄漏。
- **修复**：让 `wireAudioIpc` 返回 unsubscribe 函数并在 effect cleanup 中调用。

### 3.9 `WebAudioEngine` 在 `activeUtteranceId === null` 时丢弃 chunk — Medium
- **位置**：`src/renderer/audio/WebAudioEngine.ts:42-45`
- **问题**：若 `audio:chunk` 在 `audio:start` 之前到达，`activeUtteranceId` 仍为 `null`，chunk 被丢弃。
- **影响**：极少数情况下丢失首段音频。
- **修复**：在 `onChunk` 中缓存少量未匹配 chunk，等 start 设置后再播放。

### 3.10 `SseParser` 不支持多行 `data:` 事件 — Low
- **位置**：`src/main/tts/SseParser.ts:18-36`
- **问题**：遇到 `data:` 行就立即 parse，没有按 SSE 规范等到空行再合并多行 `data:`。
- **影响**：若 MiMo 返回多行 `data:` 事件，解析会失败。
- **修复**：缓存 `data:` 行，遇到空行后拼接再 parse。

### 3.11 `LlmClient.ping()` 捕获错误后又抛出 — Low
- **位置**：`src/main/engineer/LlmClient.ts:74-77`
- **问题**：`catch` 块没有返回 `false`，而是 `throw err`。
- **影响**：调用方 `config:test:llm` 会收到未处理异常而不是友好的 `{ ok: false, message }`。
- **修复**：catch 中 `return false`。

### 3.12 `EngineerService.cancel()` 不取消 stub 路径与 idle timer — Low
- **位置**：`src/main/engineer/EngineerService.ts:82-88,130,140`
- **问题**：stub 模式下没有 LLM 可取消；`advise` 中 6s/4s 的 `setTimeout` 也没有 handle 可清。
- **影响**：stub 时 Stop 无效，error/abort 后 idle 定时器仍会触发。
- **修复**：保存 timer handle，在 cancel 时清除；对 stub 路径也提供中断机制。

### 3.13 `StubAdvice` 默认分支输出 `PP4` — Low
- **位置**：`src/main/engineer/StubAdvice.ts:43`
- **问题**：`P${d.player.pos}` 中 `d.player.pos` 已带 `P` 前缀。
- **影响**：默认 stub 回复出现 `PP4`。
- **修复**：改为 `${d.player.pos}`。

---

## 4. 渲染 / UI / IPC

### 4.1 `TopStrip` 圈速格式化单位错误 — Critical
- **位置**：`src/renderer/components/layout/TopStrip.tsx:57,63`
- **问题**：`fmtLapTime(player.lastLapTimeS)` 把秒值传给期望毫秒的函数。
- **影响**：94.812 秒显示为 `0:00.095`。
- **修复**：调用时 `* 1000` 或新增 `fmtLapTimeS`。

### 4.2 `RivalsPanel` 的 gap 列语义错误 — High
- **位置**：`src/renderer/components/rivals/RivalsPanel.tsx:21-22`
- **问题**：显示 `r.deltaToCarInFrontS`，是对手到它前面那辆车的差距，不是到玩家的差距。
- **影响**：用户误以为显示的是到玩家差距。
- **修复**：改用 `r.gapToPlayerS`，并修改表头说明。

### 4.3 `preload/index.ts` 未限制 IPC 通道 — Medium
- **位置**：`src/preload/index.ts:5-20`
- **问题**：`api.on(channel, ...)` 和 `invoke(channel, ...)` 接受任意字符串通道。
- **影响**：若渲染进程被 XSS 攻击，可调用任意 IPC；也容易出现拼写错误。
- **修复**：暴露具体方法（如 `onTelemetrySnapshot`、`onEngineerText`）或维护通道白名单。

### 4.4 `TopStrip` 订阅整个 health store 导致过度渲染 — Medium
- **位置**：`src/renderer/components/layout/TopStrip.tsx:8`
- **问题**：`const health = useHealthStore()` 选中整个对象。
- **影响**：health 每 500ms 更新一次，整个 TopStrip 频繁重绘。
- **修复**：按字段 selector：`useHealthStore((s) => s.waiting)` 和 `useHealthStore((s) => s.connected)`。

### 4.5 `TelemetryTab` 空轮胎磨损输入会变成 `[0]` — Medium
- **位置**：`src/renderer/settings/TelemetryTab.tsx:37-44`
- **问题**：空字符串 `split(',')` 得到 `['']`，`Number('') === 0` 且 `!isNaN(0)` 为 true。
- **影响**：清空输入后保存阈值为 0，导致异常触发。
- **修复**：过滤空字符串后再 `Number`。

### 4.6 `SettingsModal` 缺少 Escape 关闭 — Low
- **位置**：`src/renderer/settings/SettingsModal.tsx`
- **问题**：只能通过点击 backdrop 或关闭按钮关闭。
- **影响**：键盘操作不便。
- **修复**：监听 `keydown` Escape。

### 4.7 `DamagePanel` 未显示完整动力单元磨损 — Low
- **位置**：`src/renderer/components/damage/DamagePanel.tsx:38-41`
- **问题**：只显示 ICE、gearbox、MGU-H、exhaust，缺少 ES、CE、turbo。
- **影响**：用户看不到完整动力单元状态。
- **修复**：补齐三个 DamageBar。

### 4.8 `IpcProvider` 中 `engineer:status` 使用 `as never` — Low
- **位置**：`src/renderer/providers/IpcProvider.tsx:39`
- **问题**：隐藏类型，弱化类型安全。
- **修复**：`as EngineerStatus`。

---

## 5. 配置 / 环境 / 构建

### 5.1 `ConfigStore.getAll()` 在模块顶层调用 — Medium
- **位置**：`src/main/index.ts:77`
- **问题**：`app.whenReady()` 之前访问 `app.getPath('userData')`，某些 Electron 版本/构建中可能未就绪。
- **影响**：首次启动或便携版可能读错配置路径。
- **修复**：移到 `app.whenReady()` 内部。

### 5.2 `ConfigStore.patch` 无字段校验 — Medium
- **位置**：`src/main/config/ConfigStore.ts:33-46`
- **问题**：直接写入，未校验范围/类型。
- **影响**：UI 可写入非法值（如负数 port、>1 volume）。
- **修复**：增加基础校验/裁剪。

### 5.3 `normalizeURL` 会对已有路径的 URL 重复追加 `/v1` — Medium
- **位置**：`src/main/config/env.ts:115-123`
- **问题**：正则 `/(\/v\d+)$/` 只匹配末尾，若路径是 `/proxy/v2/chat`，会被加成 `/proxy/v2/chat/v1`。
- **影响**：带路径的代理 URL 被错误改写。
- **修复**：仅当路径为空或 `/` 时追加 `/v1`，或文档说明只接受 base URL。

### 5.4 IPC 通道字符串硬编码，未使用 `IPC` 常量 — Medium
- **位置**：`src/main/ipc/register.ts`、`src/preload/index.ts`
- **问题**：使用字面量 `'config:get'`、`'audio:mute'` 等，与 `src/shared/types/ipc.ts` 的 `IPC` 常量不同步。
- **影响**：重命名或拼写错误会导致运行时 IPC 失效。
- **修复**：导入 `IPC` 常量统一使用。

### 5.5 `renderer/index.html` CSP 缺少 `img-src` — Low
- **位置**：`src/renderer/index.html:6-9`
- **问题**：没有 `img-src` 指令，默认 fallback 到 `default-src 'self'`。
- **影响**：未来使用 `data:image/svg+xml` 或外部图片资源时会被 CSP 拦截。
- **修复**：添加 `img-src 'self' data:;`。

---

## 6. 测试 / 质量

### 6.1 缺少 `StateAggregator` 单元测试 — High
- **位置**：`tests/` 无相关测试
- **问题**：gap 合并、事件去重、session 切换、动力单元磨损、天气检测等核心逻辑均无测试。
- **影响**：字段映射是高风险区，却没有回归保护。
- **修复**：新增 `state-aggregator.test.ts`，优先覆盖 §2 字段陷阱。

### 6.2 触发器测试仅覆盖胎温/胎 wear，大量规则未测 — High
- **位置**：`tests/trigger-engine.test.ts`
- **问题**：未覆盖 low_fuel、rain、position_change、attack、flashback、per-rule cooldown 等。
- **修复**：补充各规则的 describe 块。

### 6.3 无 LLM/TTS/Audio 集成测试 — High
- **位置**：`src/main/engineer/LlmClient.ts`、`src/main/tts/MiMoTtsClient.ts`、`src/main/audio/AudioPipeline.ts`
- **问题**：abort、非 2xx、SSE 分片、preemption、dedup 等均未测试。
- **修复**：mock `fetch`/OpenAI client，覆盖异常路径。

### 6.4 `live-udp-inject.mjs` 使用错误 track id — Medium
- **位置**：`tests/live-udp-inject.mjs:55`
- **问题**：注释说 Suzuka，但写入 `4`（Catalunya），实际应为 `13`。
- **修复**：改为 `13` 并断言解析结果。

### 6.5 `live-llm.mjs` 未校验 BaseURL — Medium
- **位置**：`tests/live-llm.mjs:31-45`
- **问题**：若 `AI_API_BASE_URL` 为空，URL 变成 `https:///v1/chat/completions`，抛 `ERR_INVALID_URL`。
- **修复**：在缺失 KEY 后同样检查 BASE。

### 6.6 `screenshot.mjs` 未注册 IPC 处理器 — Medium
- **位置**：`tests/screenshot.mjs:21-60`
- **问题**：capture harness 只加载 renderer，未调用 `registerIpc()`，渲染端 `config:get` 会失败。
- **修复**：在 harness 中 import 并调用 `registerIpc()`，或至少 stub 必要 handler。

### 6.7 `screenshot.mjs` 仅支持 Windows — Low
- **位置**：`tests/screenshot.mjs:65`
- **问题**：硬编码 `electron.exe`。
- **修复**：使用 `npx electron` 或根据平台选择可执行文件。

### 6.8 `vitest.config.ts` 仅包含 `.test.ts` — Low
- **位置**：`vitest.config.ts:11`
- **问题**：`include: ['tests/**/*.test.ts']` 不会运行未来可能添加的 `.test.tsx`/`.test.mjs`。
- **修复**：改为 `tests/**/*.test.{ts,tsx,mjs}`。

---

## 7. 已知局限（非 bug，但需注意）

- **2026 season pack 支持不完整**：库本身未定义 2026 packet size/format，当前仅对 packet 16 特判不丢弃，其余包按 2025 处理。真实 2026 赛季数据可能解析异常。
- **对手轮胎配方**：当前只从 `onCarStatus` 更新玩家，`RivalsPanel` 显示对手轮胎为 `unknown`（见 1.6）。
- **赛道 SVG path**：均为示意性 path，精确度有限。
- **TTS 流式首字延迟**：MiMo 当前为兼容模式，整段合成后切片，延迟 1–3 秒。设计已接受，无需修复。

---

## 附录：优先级修复建议

| 优先级 | 修复项 |
|--------|--------|
| P0 | 1.1（玩家加入排序）、1.2（lapDistancePct 除数）、4.1（圈速显示）、3.3（BaseURL 规范化） |
| P1 | 2.1（进攻触发字段）、3.1（pending 优先级）、3.6/3.7（音频取消/抢断）、2.2（Digest gap 字段） |
| P2 | 1.3（onTrack）、1.4（红旗）、1.5（position 0）、1.8（跨 session 去重）、3.2（LLM 消息交替） |
| P3 | 测试补齐、UI 细节优化、配置校验、CSP/IPC 规范化 |
