# 潜在 Bug / 风险汇总

> 阅读范围：`README_for_agent.md`、`package.json`、全量 `src/**/*.{ts,tsx}`、`tests/**/*.ts` 及构建配置。仅汇总，不修改代码。

---

## 1. 遥测 / 状态聚合（State & Telemetry）

### 1.1 `StateAggregator.onLapData` — 前后车距推导逻辑仅对相邻车辆正确
- **位置**：`src/main/state/StateAggregator.ts:138-186`
- **问题**：`gapToPlayerS` 对前方车辆取 `r.deltaToCarBehindS`，对后方车辆取 `r.deltaToCarInFrontS`。这只对紧邻玩家的前后车成立；对于第 2、3 名等远处车辆，该值是“它到更近一辆车的距离”，不是到玩家的真实差距。
- **影响**：Digest 中的 rivals 距离、`fmtAheadGap`/`fmtBehindGap` 在非紧邻对手时会显示错误数值。
- **建议**：使用玩家自身的 `deltaToCarInFrontS` 或 `deltaToCarBehindS` 作为起点，沿排序后的位置链求和得到真实差距。

### 1.2 `DigestBuilder` 中“到前车/后车差距”使用了错误字段
- **位置**：`src/main/engineer/DigestBuilder.ts:129-142`
- **问题**：
  - `fmtAheadGap` 使用 `ahead.deltaToCarInFrontS`（前车到它前面那辆车的距离），而不是玩家到前车的距离。
  - `fmtBehindGap` 使用 `behind.deltaToCarInFrontS`（后车到自己的距离），这里正负号虽然碰巧可用，但语义上应优先使用玩家自身的 `deltaToCarBehindS` 或后车 `deltaToCarBehindS` 的对应关系。
- **影响**：摘要中 “to car ahead / to car behind” 的数值可能完全错误。

### 1.3 `StateAggregator.onEvent` 对 `SEND`（SessionEnded）处理仍标记为 `retirement`
- **位置**：`src/main/state/StateAggregator.ts:312-315`
- **问题**：注释明确说“do NOT mislabel as retirement”，但 `pushEvent('retirement', ...)` 把 `type` 仍然写成了 `retirement`。`RecentEvent` 类型里也没有 `sessionEnded`。
- **影响**：比赛结束事件在 UI 中会显示为“退赛”，误导用户。
- **建议**：在 `RecentEvent.type` 中新增 `sessionEnded`，并在此处使用。

### 1.4 `isDupe` 事件去重桶未在会话切换时清空
- **位置**：`src/main/state/StateAggregator.ts:384-394`
- **问题**：`lastEventBucket` 以 `${uid}:${key}` 为键，但 `reset()` 并未清空它。当进入新的 session 时，旧 session 的 bucket 仍保留，导致新 session 中相同 key（如 `rain`、`sc`）的事件被错误去重。
- **影响**：跨 session 后，安全车、降雨等事件可能不再触发。
- **建议**：在 `reset()` 中 `this.lastEventBucket.clear()`。

### 1.5 `readGapS` 对 0ms 的差距返回 `null`
- **位置**：`src/main/state/StateAggregator.ts:425-435`
- **问题**：`totalMs > 0 ? totalMs / 1000 : null`，当两车 truly 0s 差距时会丢失有效值。
- **影响**：极小概率下显示 `--` 而不是 `0.000`。
- **建议**：使用 `>= 0` 判断，并把有效条件收紧为 `msPart + minPart` 任意有定义。

### 1.6 `onLapData` 未对 `resultStatus` 0/5/6 做完整状态映射
- **位置**：`src/main/state/StateAggregator.ts:441-446`
- **问题**：`rivalStatus` 仅处理了 3/4/0/7，未处理 F1 spec 中的 5(not classified) / 6(retired)。
- **影响**：这些车辆会被显示为 `running`。
- **建议**：补充 `resultStatus === 6 || resultStatus === 5` 的状态分支。

---

## 2. 触发器（TriggerEngine）

### 2.1 进攻（attack）触发使用了错误的差距
- **位置**：`src/main/triggers/TriggerEngine.ts:171-185`
- **问题**：判断进攻机会时检查 `ahead.deltaToCarInFrontS`，这是前车到它前面那辆车的距离，不是玩家到前车的距离。正确的应该用玩家自身的 `deltaToCarInFrontS`。
- **影响**：攻击触发时机错误，可能在前车其实很远时触发，或在可以进攻时没有触发。

### 2.2 防守/进攻状态机在车消失后无法复位
- **位置**：`src/main/triggers/TriggerEngine.ts:151-186`
- **问题**：`defendActive` / `attackActive` 只在 `behind`/`ahead` 存在时才会因为 gap 变大而复位；如果该车退赛或从 rivals 中消失（例如数据未更新），状态会一直保持 `true`。
- **影响**：相关触发可能长期无法再次触发。
- **建议**：在 `behind`/`ahead` 不存在时，默认将对应状态重置。

### 2.3 `evalPositionChange` 第一圈可能误触发
- **位置**：`src/main/triggers/TriggerEngine.ts:206-224`
- **问题**：初始化 `lastLap = 0`。当玩家从 lap 0 进入 lap 1 时，`lap === lastLap + 1` 且 `lastLap !== 0` 条件成立，`delta = lastPosition - pos` 可能把 `lastPosition=0` 与真实位置比较，导致第一圈误报位置变化。
- **影响**：与 `suppressFirstLap` 叠加后可能仍然会在第一圈产生 `position_gain/loss` 触发。
- **建议**：`lastLap` 初始化为 `-1`，并在 lap 为 0 或 1 时不评估位置变化。

---

## 3. 工程师 / LLM / 对话上下文

### 3.1 `ConversationMemory.build` 生成的消息序列不符合 OpenAI 交替规则
- **位置**：`src/main/engineer/ConversationMemory.ts:65-78`
- **问题**：`recentAdvice` 中只保存了 assistant 消息，并连续推入 messages 数组，最后才追加当前 user digest。结果是 `system, assistant, assistant, ..., user`。
- **影响**：OpenAI 兼容接口通常要求 user/assistant 严格交替，且最后一条必须是 user。这种连续 assistant 的消息序列可能被拒绝或导致模型行为异常；DeepSeek 等 provider 也可能给出警告。
- **建议**：维护成对的 user/assistant 历史；或将最近摘要与对应回复配对存储。

### 3.2 使用 stub 模式时不会更新 `ConversationMemory`
- **位置**：`src/main/engineer/EngineerService.ts` + `LlmClient.ts`
- **问题**：`pushAdvice` 只在 `LlmClient.generate` 成功时调用；stub 路径不写入记忆。后续切换到 LLM 时，记忆为空，上下文断裂。
- **影响**：从 stub 切到真实 LLM 后，LLM 看不到任何历史建议。
- **建议**：在 `EngineerService.advise` 成功后统一 `memory.pushAdvice(text)`。

### 3.3 `LlmClient.generate` 错误时也会写入 `pushAdvice`
- **位置**：`src/main/engineer/LlmClient.ts:155`
- **问题**：`this.memory.pushAdvice(text || '(no response)')` 位于 try/catch 之后，如果 generate 抛错并 rethrow，该行不会执行；但如果在 `isAbort` 分支内 return，会跳过 pushAdvice。当前 abort 分支是 rethrow，所以不写入。然而，若未来改为不 rethrow，会写入错误回复。
- **建议**：在 `EngineerService` 层统一决定是否 `pushAdvice`，避免 LLM 层写入无效内容。

### 3.4 `renderDigestTurn` 签名参数 `d` 未使用，且 `firing` 在 `generate` 中未使用
- **位置**：`src/main/engineer/LlmClient.ts:94-95, 168-174`
- **问题**：`void firing; void d;` 说明设计时打算用但未实现。`d.trigger.reason` 被使用，`d` 未使用只是被读取了 trigger 字段；`firing` 完全被丢弃。
- **影响**：功能正常，但代码维护性/意图表达差。

---

## 4. TTS / 音频

### 4.1 TTS BaseURL 未做 `/v1` 规范化
- **位置**：`src/main/ipc/ttsRef.ts:32-46`、`src/main/tts/MiMoTtsClient.ts:54`
- **问题**：`MiMoTtsClient.synthesize` 直接把 `baseURL` 拼接为 `{baseURL}/chat/completions`。UI 提示用户可以填 `api.xiaomimimo.com`，此时请求会变成 `https://api.xiaomimimo.com/chat/completions`（缺少 `/v1`），导致 404。
- **影响**：用户在 UI 填入不带 `/v1` 的 URL 时 TTS 连接失败。
- **建议**：在 `wireTts` 或 `ConfigStore.getAll` 中对 `tts.baseURL` 调用与 LLM 相同的 `normalizeURL`。

### 4.2 LLM BaseURL 同样未在 UI 覆盖时做规范化
- **位置**：`src/main/ipc/engineerRef.ts:29-47`
- **问题**：`cfg.llm.baseURL` 直接传给 `LlmClient`，如果用户输入不带 `/v1` 也会失败。
- **建议**：同样调用 `normalizeURL`。

### 4.3 `AudioPipeline.cancelAll` 未通知渲染进程停止播放
- **位置**：`src/main/audio/AudioPipeline.ts:87-91`
- **问题**：`cancelAll` 只是清空队列和 current，没有发送任何 IPC（如 `audio:end` 或新的 `audio:cancel`）。渲染端的 `WebAudioEngine` 仍在播放已缓冲的音频，并且 `activeUtteranceId` 保持原值。
- **影响**：点击 Stop 后，当前语音仍会继续播放直到自然结束。
- **建议**：新增 `audio:cancel` 通道，或在 `cancelAll` 时发送 `audio:end` 并让渲染端清空 active source。

### 4.4 `WebAudioEngine` 在 `onChunk` 中 `activeUtteranceId === null` 时会丢弃所有 chunk
- **位置**：`src/main/audio/AudioPipeline.ts:99` 与 `src/renderer/audio/WebAudioEngine.ts:42-45`
- **问题**：`audio:start` 发送与 `audio:chunk` 是异步的；如果某个 chunk 在 start 事件处理之前到达，`activeUtteranceId` 仍为 `null`，会被丢弃。虽然正常顺序下 start 先到达，但高并发/重排时可能丢首段音频。
- **建议**：在 `onChunk` 中缓存少量未匹配的 chunk，等 start 设置 activeId 后补播；或直接让 start 带初始 activeId。

---

## 5. UDP 接收 / 解析

### 5.1 `UdpReceiver.expectedSize` 依赖 `Object.keys(PACKETS)` 顺序，对未知 packetId 不做长度校验
- **位置**：`src/main/telemetry/UdpReceiver.ts:9-10, 102-108`
- **问题**：`PACKET_NAMES` 是 `Object.keys(PACKETS)`，按对象插入顺序排列。`expectedSize(packetId)` 直接用 `PACKET_NAMES[packetId]` 作为索引，当 packetId 超过数组长度或顺序与 packetId 不一致时返回 `undefined`，导致 `expected === null`，跳过长度校验并直接解析。
- **影响**：收到截断或格式未知的 packet 时，可能触发 `parseBufferMessage` 异常（虽然 catch 了），并错误计为 dropped，而不是安全丢弃。
- **建议**：根据 packetId 直接查表 `PACKET_SIZES[packetName]`，而不是依赖数组索引。

### 5.2 `handleMessage` 对 2026 format 的 `expectedSize` 回退到 2025
- **位置**：`src/main/telemetry/UdpReceiver.ts:107`
- **问题**：`sizes[fmt] ?? sizes[2025] ?? null` 在 2026 格式某 packet 大小未知时回退到 2025 大小。2026 season pack 的 packet 16 已特判，但其他 packet 如果长度不同，会导致用错阈值。
- **影响**：2026 格式下若某 packet 比 2025 长，会被错误截断/丢弃。
- **建议**：对未知 fmt 的大小明确返回 null，让 parser 自行处理或安全丢弃。

---

## 6. 渲染 / UI

### 6.1 `TopStrip` 中 `fmtLapTime` 被传入秒，而函数期望毫秒
- **位置**：`src/renderer/components/layout/TopStrip.tsx:57, 63`
- **问题**：`player.lastLapTimeS` / `player.bestLapTimeS` 单位是秒，但 `fmtLapTime` 内部做 `ms / 1000`。调用时直接传了秒。
- **影响**：Last/Best lap time 显示值被缩小 1000 倍，例如 `94.812s` 会显示成 `0:00.095`。
- **建议**：调用时乘以 1000，或新增 `fmtLapTimeS` 专门处理秒。

### 6.2 `RivalsPanel` 的 gap 列语义不清晰
- **位置**：`src/renderer/components/rivals/RivalsPanel.tsx:21-22`
- **问题**：显示 `r.deltaToCarInFrontS` 作为 gap，但这是“该对手到它前面那辆车”的差距，不是到玩家的差距。
- **影响**：用户可能误解为到玩家的差距。
- **建议**：改为显示 `r.gapToPlayerS`，并在表头标注“to player”。

### 6.3 `TrackMap` 中多次重复调用 `pointAt(0)`
- **位置**：`src/renderer/components/trackmap/TrackMap.tsx:60-65`
- **问题**：`pointAt(0)` 在 JSX 中连续调用两次，每次都重新计算路径点。
- **影响**：轻微性能浪费；更重要的是，如果 `pointAt` 返回 null，第一次调用返回 truthy 后第二次仍可能重新执行。虽然当前代码用 `&&` 短路，可读性较差。
- **建议**：用 `useMemo` 缓存起点坐标。

---

## 7. 配置 / 持久化

### 7.1 `ConfigStore.patch` 对嵌套对象的合并是浅合并
- **位置**：`src/main/config/ConfigStore.ts:33-46`
- **问题**：`mergeConfig` 和 `patch` 都只对顶层 section 做浅合并。虽然当前 `AppConfig` 没有深嵌套 section，但 `triggers` 是 `TriggerConfig` 对象，如果用户只 patch 一个触发阈值，会覆盖整个 `triggers` 为默认值+该值。
- **影响**：目前 UI 调用 `patch({ triggers: { x } })` 看起来只改一个字段，但实际上会把 `triggers` 中其他未提供的字段重置为默认值。
- **建议**：在 `patch` 或 `mergeConfig` 中对每个 section 也做一层浅合并（已是 section 浅合并，但 `TriggerConfig` 的字段都在一层，所以实际上 ok；更安全的做法是采用深合并）。

### 7.2 `env.ts` 的 `.env` 解析不支持变量插值或多行值
- **位置**：`src/main/config/env.ts:46-61`
- **问题**：`parseEnv` 只处理了简单 `KEY=VALUE`、引号和注释。不支持 `KEY="$OTHER"`、内嵌引号转义、多行等。
- **影响**：用户若使用复杂 `.env` 会解析错误。
- **建议**：明确文档说明只支持简单值，或引入 `dotenv`。

---

## 8. 测试覆盖缺口

| 模块 | 未覆盖场景 |
|------|-----------|
| `StateAggregator` | 多车非紧邻差距推导、session 切换后 `lastEventBucket` 行为、`SEND` 事件类型 |
| `TriggerEngine` | 进攻触发使用错误字段、防守/进攻状态机在车消失后的复位、低燃油持续触发 |
| `AudioPipeline` | 高优先级抢断、`cancelAll` 行为、队列 depth 溢出 |
| `LlmClient` | abort 路径、usage 解析、prompt cache 字段 |
| `MiMoTtsClient` | fetch 非 2xx、SSE 多 chunk 边界、外部 signal abort |
| 渲染组件 | `TopStrip` 圈速格式化、RivalsPanel gap 语义 |

---

## 9. 其他风险

### 9.1 全局状态对象无版本/不可变快照
- **位置**：`SnapshotEmitter.ts` 等
- **问题**：`StateAggregator` 直接持有并 mutate `this.state`，`SnapshotEmitter.paint` 把它完整 stringify。如果 stringify 过程中 UDP reducer 修改了对象（单线程下不可能真正并发，但事件循环交错仍可能产生不一致快照），会得到半一致的 JSON。
- **影响**：理论上存在收到“半包” paint 数据的风险，虽然概率极低。
- **建议**：在 stringify 前做一次浅拷贝，或对关键字段做结构化克隆。

### 9.2 `EngineerService.cancel` 对 stub 路径无效
- **位置**：`src/main/engineer/EngineerService.ts:82-88`
- **问题**：`cancel` 只调用 `this.llm?.cancel?.()`，stub 模式下没有 LLM 对象，无法取消正在同步播放的 stub 语音。
- **影响**：stub 模式下点击 Stop 无效。

### 9.3 `TelemetryService.drainEvents` 的 `includes` 检查依赖对象引用
- **位置**：`src/main/telemetry/TelemetryService.ts:100-111`
- **问题**：`this.pendingEvents.includes(ev)` 检查对象引用。`StateAggregator.pushEvent` 每次生成新对象并替换数组，因此不同 packet 的事件对象引用不同，正常不会重复。但如果 reducer 逻辑未来改为复用对象，会出现去重失败。
- **建议**：按 `ev.id` 做显式去重。

---

## 备注

- 以上问题按“功能正确性 > 数据准确性 > 用户体验”排序。
- 最需优先修复：**6.1（圈速显示错误）**、**1.2 / 1.1（差距计算错误）**、**4.1 / 4.2（BaseURL 规范化）**、**3.1（LLM 消息交替）**。
