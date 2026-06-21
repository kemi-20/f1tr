# F1 Race Engineer

一个 Windows 桌面应用：监听 F1 25 的 UDP 遥测，用 AI 扮演比赛工程师，实时给出策略建议，并通过 MiMo TTS 用语音播报。支持语音输入、游戏截图、全局热键，配有深色赛车驾驶舱界面。

![platform](https://img.shields.io/badge/platform-Windows-2DD4BF)
![version](https://img.shields.io/badge/version-0.2.0-FF6A00)
![license](https://img.shields.io/badge/license-MIT-2DD4BF)

## 它能做什么

一边玩 F1 25，应用会：

- **接收全部遥测数据**：你的速度/档位/转速、四轮磨损与温度（表温/内温/刹车温）、车身损伤、燃料、ERS、天气、旗语，以及所有对手的位置/圈速/差距/轮胎/进站/罚时
- **关键时刻主动播报**：轮胎磨损越界、被后车追近、进站窗口打开、安全车/虚拟安全车、变天、碰撞、低油等，工程师会用无线电口吻给出建议
- **语音播报**：通过 MiMo TTS 把建议转成语音，支持中文 / English / 中英混合三种模式，带优先级抢断队列
- **语音输入**：按热键或点 Speak 按钮说话，录音转文字后发给 AI 工程师（MiMo ASR）
- **游戏截图**：AI 可主动调用截图工具查看游戏画面，支持图片输入的模型直接看图，不支持的自动用 MiMo 视觉模型描述后转达
- **全局热键**：系统级热键，F1 25 全屏运行时也能触发语音输入
- **UDP 断线保护**：游戏断连超 2 分钟自动暂停 AI 工程师，恢复后自动重启
- **完整驾驶舱界面**：精确赛道俯视图（世界坐标校准）、驾驶 HUD（换挡灯/ERS/DRS）、四轮卡片（剩余寿命/温度/刹车）、损伤面板、对手榜、工程师对话流

### 对手榜双模式

- **正赛**：显示与你的时间差、四胎平均磨损、进站次数
- **练习赛/排位赛**：显示每个人的最佳圈速和与你的圈数差（三位小数，精确到赛道进度）

### 智能上下文

- 正赛才提醒 DRS 攻防，练习赛/排位赛不讲 DRS
- 雨天/湿地自动标记 DRS 禁用，告知 AI 不可开 DRS
- 人工 Ask 强制播报；自动消息由 AI 判断紧急程度决定是否播报
- 工程师风格可选 GP / Bono / Bozzi / Adami 四种真实无线电语气

## 截图

启动后会看到深色玻璃拟态驾驶舱，包含赛道图、HUD、轮胎卡、对手榜和工程师面板。未连接游戏时显示"等待遥测数据"提示卡。

## 快速开始

### 1. 下载

去 [Releases](../../releases) 页面下载最新版：
- `F1 Race Engineer Setup x.x.x.exe` — 安装版（推荐）
- `F1 Race Engineer-x.x.x-portable.exe` — 绿色版，解压即用

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
- Telemetry Format：2023 / 2024 / 2025 均可（应用会自动识别）

### 4. 启动

双击 "F1 Race Engineer"。进入比赛后，工程师会在关键时刻自动播报；也可以在右下角工程师面板手动 **Ask** 提问，或按 **Speak** 按钮语音输入。

## 语音输入

- 点击右下角 **Speak** 按钮开始录音，按钮变红，再点一次结束（30 秒超时自动停止）
- 或按 **全局热键**（默认空格键，可在设置中更改），游戏全屏时也能触发
- 录音编码为 MP3 格式，发送给 MiMo 语音识别（mimo-v2.5-asr）转为文字
- 转写文字自动作为车手消息发给 AI 工程师，工程师回复会通过 TTS 播报
- 热键仅在 UDP 连接中或断开不超过 2 分钟时生效

## 设置面板（右上角齿轮）

- **AI / LLM**：连接地址、模型、温度、图片输入开关（开启后截图直接发给模型）、测试连接
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
- **MiMo ASR**：语音转文字（mimo-v2.5-asr），录音编码 MP3 128kbps
- **MiMo Vision**：游戏截图描述（mimo-v2.5），为不支持图片输入的模型提供视觉
- **lamejs**：浏览器端 MP3 编码
- **Electron globalShortcut**：系统级热键，游戏全屏时也能响应

## 许可

MIT
