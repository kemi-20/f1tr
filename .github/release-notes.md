**F1 25 AI Race Engineer v0.2** — 监听 F1 25 UDP 遥测，AI 扮演比赛工程师，语音播报策略建议。精美深色赛车驾驶舱 UI。

## v0.2 新特性

- **高精度校准赛道地图** — 25 条赛道 F1 世界坐标系 calibrated map，车点实时位置（优先 Motion 坐标）
- **AI 位置感知讲话判断** — `【NOW】`/`【HOLD】` 前缀，弯道自动安静、直道播报、紧急必说
- **四套 AI 工程师风格** — GP（红牛冰冷极简）/ Bono（梅奔温暖可靠）/ Bozzi（法拉利清晰专业）/ Adami
- **轮胎温度窗口重做** — 全部干胎统一 85–105°C，按内部/胎体温度判定，surface + inner + brake 三温显示
- **轮胎配方按站映射** — F1 25 C 号→S/M/H 按每站 Pirelli allocation 自动匹配
- **轮胎卡重设计** — 剩余寿命横条 + C 编号 + 表温/内温/刹车温度 + 温度状态色
- **换挡灯改版** — 绿(5) 红(5) 紫(5)，视觉更清晰
- **红旗自动清除** — 比赛恢复后自动结束红旗状态
- **对手面板显示自己轮胎** — 不再显示 `?`

## 功能

- **完整遥测接收** — 速度、档位、转速、四轮磨损/温度/刹车温度、车身损伤、ERS、DRS、燃料、天气、旗语，以及所有对手的位置/圈速/差距/轮胎/进站/罚时
- **关键时刻主动播报** — 轮胎磨损过界、被后车追近、进站窗口、安全车/虚拟安全车/红旗、变天、低油、碰撞、位置变化
- **三语播报** — 中文 / English / 中英混合，嗓音可选
- **完整设置面板** — LLM、TTS、语音语言、AI 工程师风格、遥测触发阈值、音频主题、主题配色

## 安装

- **安装版**：`F1 Race Engineer Setup 0.2.0.exe`
- **便携版**：`F1 Race Engineer-0.2.0-portable.exe`（绿色免安装）

## 配置

在 exe 同目录创建 `.env`：

```env
AI_API_BASE_URL=api.deepseek.com
AI_API_KEY=sk-你的密钥
AI_MODEL=deepseek-v4-flash

MIMO_API_BASE_URL=api.xiaomimimo.com
MIMO_API_KEY=sk-你的密钥
```

也可在右上角 ⚙ 设置面板直接填写。

## F1 25 遥测

`Options → Settings → UDP Telemetry Settings` → 端口 **20777**

## 技术栈

Electron + TypeScript · React + Tailwind · OpenAI 兼容 LLM · MiMo TTS · F1 25 UDP 解码

---

> 首次运行 Windows SmartScreen 可能警告 → 点"更多信息" → "仍要运行"
