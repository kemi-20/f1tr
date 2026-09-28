# F1 Race Engineer

一个 Windows 桌面应用：监听 F1 25 的 UDP 遥测，用 AI 扮演比赛工程师，实时给出策略建议，并通过 MiMo TTS 用语音播报。支持语音输入、游戏截图、全局热键，配有深色赛车驾驶舱界面。

![platform](https://img.shields.io/badge/platform-Windows-2DD4BF)
![version](https://img.shields.io/badge/version-0.3.0-FF6A00)
![license](https://img.shields.io/badge/license-MIT-2DD4BF)

## 它能做什么

一边玩 F1 25，应用会：

- **接收游戏公开的 UDP 遥测**：速度/档位/转速、四轮磨损与温度（表温/内温/刹车温）、损伤、燃料、ERS、天气、旗语，以及对手的位置/圈速/差距/轮胎/进站/罚时。可用字段受游戏协议、遥测隐私和当前包接收情况限制，不代表能访问游戏内部的全部信息。
- **关键时刻主动播报**：轮胎磨损越界、被后车追近、进站窗口打开、安全车/虚拟安全车、变天、碰撞、低油等，工程师会用无线电口吻给出建议
- **语音播报**：通过 MiMo TTS 把建议转成语音，支持中文 / English / 中英混合三种模式，带优先级抢断队列
- **语音输入**：按热键或点 Speak 按钮说话，录音转文字后发给 AI 工程师（MiMo ASR）
- **音频直传**：如果默认模型支持音频输入，录音直接发给模型（跳过 ASR 转写）；不支持时走 MiMo ASR 转文字
- **游戏截图**：AI 可主动调用截图工具查看游戏画面，支持图片输入的模型直接看图，不支持的自动用 MiMo 视觉模型描述后转达
- **全局热键**：系统级热键，F1 25 全屏运行时也能触发语音输入
- **UDP 断线保护**：游戏断连超 2 分钟自动暂停 AI 工程师，恢复后自动重启
- **完整驾驶舱界面**：精确赛道俯视图（世界坐标校准）、驾驶 HUD（换挡灯/ERS/DRS）、四轮卡片（剩余寿命/温度/刹车）、损伤面板、对手榜、工程师对话流

### 对手榜双模式

- **正赛**：显示与你的时间差、四胎平均磨损、进站次数
- **练习赛/排位赛**：按最快有效圈排序，显示最佳圈相对玩家的秒差（两位小数）；玩家尚无有效圈时以最快车手为基准，无有效圈显示 `--`。

### 智能上下文

- 正赛才提醒 DRS 攻防，练习赛/排位赛不讲 DRS
- 雨天/湿地自动标记 DRS 禁用，告知 AI 不可开 DRS
- 人工 Ask 强制播报；自动消息由 AI 判断紧急程度决定是否播报
- 排位飞驰圈和圈型不明时压住普通无线电，只允许紧急安全提醒或车手主动提问。出场/回场圈优先使用游戏状态，冷却圈基于同赛道区段的持续降速推断；准备圈遇到后方有效飞驰圈车手快速接近时提醒安全避让。
- 工程师风格可选 GP / Bono / Bozzi / Adami 四种真实无线电语气

## 截图

启动后会看到深色玻璃拟态驾驶舱，包含赛道图、HUD、轮胎卡、对手榜和工程师面板。未连接游戏时显示"等待遥测数据"提示卡。

## 快速开始

### 1. 下载

去 [Releases](../../releases) 页面下载最新版：
- `F1 Race Engineer Setup x.x.x.exe` — 安装版（推荐）
- `F1 Race Engineer-x.x.x-portable.exe` — 单文件便携版，启动时会自解压

Actions 的 `F1-Race-Engineer-Unpacked` 下载包解压后可直接运行目录内的 `F1 Race Engineer.exe`，后续启动无需重复自解压。请保留整个目录。

工程师内置固定版本 DSH `0.1.7-rc.2`，复用 Electron 自带的 Node，无需安装 DSH 或 Node，也不读取电脑上独立 DSH 的配置。主对话使用 OpenAI Chat Completions；没有重新引入其他厂商的 SDK。AI 可调用遥测、历史、截图、无线电和联网搜索工具。

设置中的“支持网络搜索”开启时，优先使用已确认支持搜索的官方 MiMo / DeepSeek 模型；关闭时或其他模型/网关使用 MiMo `mimo-v2.6-flash` 国内联网服务，需要 MiMo Key 并在小米平台开通联网服务。DeepSeek 搜索沿用 [DSH 固定版本的原生搜索协议](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.7-rc.2/packages/web/web-search-deepseek/src/provider.ts)，独立发送 Messages 请求，主对话协议不变。搜索仅在模型调用 `web_search` 时发生，每轮最多一次；接口报错不会静默重复扣费切换。外部资料只作背景，游戏遥测才是当前比赛依据。

工程师职责由 DSH 原生 `f1-race-engineer` agent 预设管理，语言和沟通风格单独作为偏好。策略以当前比赛总圈数、剩余距离和本场实测圈速、四轮磨损、油耗为依据，比较停站与留在赛道的剩余总耗时。进站建议要求给出当前方案、窗口和变更条件；数据不足时给出注明条件的临时方案，不编造进站损失或轮胎寿命。正赛燃油字段按游戏 MFD 的完赛余量解读，并与实测 kg/lap 交叉核对。

策略还要求比较 undercut / overcut 的暖胎、出站交通及后续 stint 代价，区分排名顺序与沿赛道的实际前后位置。绿旗、VSC、SC 的进站观测分别保存；相对未进站对手的差距损失只是含有驾驶、服务和采样误差的证据，不是精确进站损失。没有可靠样本时不会假定固定秒数或“安全车免费进站”。

> 首次运行 Windows SmartScreen 可能提示"未知发布者"（因为没签名）→ 点"更多信息" → "仍要运行"。

### 2. 配置 AI 与语音密钥

在应用同目录创建 `.env` 文件（或放在便携版 exe 旁边），填入：

```env
# AI（OpenAI 兼容端点，支持 DeepSeek / OpenAI / 本地 Ollama 等）
AI_API_BASE_URL=api.deepseek.com
AI_API_KEY=sk-你的密钥
AI_MODEL=deepseek-v4-flash

# MiMo TTS & ASR（语音合成 + 语音识别 + 视觉描述共用）
MIMO_API_BASE_URL=api.xiaomimimo.com
MIMO_API_KEY=sk-你的mimo密钥
```

> `.env` 不会上传、不含在程序里，纯本地读取。也可启动后在右上角设置面板里临时改连接。

### 3. 在 F1 25 中开启遥测

`Options -> Settings -> UDP Telemetry Settings`
- 端口 **20777**
- 速率 20 / 30 / 60 Hz（推荐 30）
- Telemetry Format：2025 / 2026（应用自动识别，不解析旧版 2023 / 2024 格式）

### 4. 启动

双击 "F1 Race Engineer"。进入比赛后，工程师会在关键时刻自动播报；也可以在右下角工程师面板手动 **Ask** 提问，或按 **Speak** 按钮语音输入。

## 语音输入

- 点击右下角 **Speak** 按钮开始录音，按钮变红，再点一次结束（30 秒超时自动停止）
- 或按 **全局热键**（默认空格键，可在设置中更改），游戏全屏时也能触发
- 录音编码为 WAV（16kHz · 单声道 · PCM16），发送给 MiMo 语音识别（mimo-v2.6-flash）转为文字
- 转写文字自动作为车手消息发给 AI 工程师，工程师回复会通过 TTS 播报
- UDP 断开超过 2 分钟只会暂停自动播报，手动提问与语音输入仍然可用

## 设置面板（右上角齿轮）

- **AI / LLM**：连接地址、模型、思考等级（none / low / max）、上下文限制、图片输入开关、测试连接
- **TTS - MiMo**：语音密钥状态 + 测试
- **语音 - 语言**：中文 / English / 中英混合 + 嗓音选择 + 工程师风格（GP/Bono/Bozzi/Adami）
- **遥测 - 触发**：端口、轮胎磨损阈值、防守距离、心跳间隔等
- **音频 - 主题**：音量、静音、高优先级抢断、停止播报、配色主题
- **快捷键**：语音输入热键配置（默认空格键，按任意键捕获）

## 从源码构建

需要 Node.js 18+。

```bash
git clone https://github.com/kemi-20/f1tr.git
cd f1tr
npm install
npm run dev          # 开发模式（热重载）
npm run build:win    # 打包 Windows 安装器 + 绿色版（产物在 release/）
```

## 技术栈

- **Electron + TypeScript**：主进程负责 UDP 解码 / LLM / TTS / ASR / 截图 / 全局热键，渲染进程负责 UI 与 Web Audio 播放
- **F1 25 UDP 解码**：支持 2025 与 2026 赛季包两种线缆格式，自动按包头分派
- **React + Tailwind**：深色赛车玻璃拟态界面
- **OpenAI 兼容 LLM**：默认 DeepSeek（自动禁用 thinking 模式以降低延迟），支持 tool calling（截图工具）
- **MiMo TTS**：24000Hz 单声道 PCM16 流式播放，带优先级抢断队列
- **MiMo ASR**：语音转文字（mimo-v2.6-flash），录音编码 WAV（16kHz 单声道 PCM16）
- **MiMo Vision**：游戏截图描述（mimo-v2.5），为不支持图片输入的模型提供视觉
- **Electron globalShortcut**：系统级热键，游戏全屏时也能响应

## 许可

MIT
