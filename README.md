# F1 Race Engineer

一个 Windows 桌面应用：监听 F1 25 的 UDP 遥测，用 AI 扮演比赛工程师，实时给出策略建议，并通过 MiMo TTS 用语音播报。配有精美的深色赛车驾驶舱界面。

![platform](https://img.shields.io/badge/platform-Windows-2DD4BF)
![license](https://img.shields.io/badge/license-MIT-FF6A00)

## 它能做什么

一边玩 F1 25，应用会：

- **接收全部遥测数据**：你的速度/档位/转速、四轮磨损与温度、车身损伤、燃料、ERS、天气、旗语，以及所有对手的位置/圈速/差距/轮胎/进站/罚时
- **关键时刻主动播报**：轮胎磨损越界、被后车追近、进站窗口打开、安全车/虚拟安全车、变天、碰撞、低油等，工程师会用无线电口吻给出建议
- **语音播报**：通过 MiMo TTS 把建议转成语音，支持中文 / English / 中英混合三种模式
- **完整驾驶舱界面**：赛道俯视图、驾驶 HUD（换挡灯/转速弧/ERS/DRS）、四轮卡片、损伤面板、对手榜、工程师对话流

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

# MiMo 语音
MIMO_API_BASE_URL=api.xiaomimimo.com
MIMO_API_KEY=sk-你的mimo密钥
```

> `.env` 不会上传、不含在程序里，纯本地读取。也可启动后在右上角 ⚙ 设置面板里临时改连接。

### 3. 在 F1 25 中开启遥测

`Options → Settings → UDP Telemetry Settings`
- 端口 **20777**
- 速率 20 / 30 / 60 Hz（推荐 30）
- Telemetry Format：2023 / 2024 / 2025 均可（应用会自动识别）

### 4. 启动

双击 "F1 Race Engineer"。进入比赛后，工程师会在关键时刻自动播报；也可以在右下角工程师面板手动 **Ask** 提问。

## 设置面板（右上角 ⚙）

- **AI / LLM**：连接地址、模型、温度，含"测试连接"按钮
- **TTS · MiMo**：语音密钥状态 + 测试
- **语音 · 语言**：中文 / English / 中英混合 + 嗓音选择（冰糖/茉莉/苏打/白桦 / Mia/Chloe/Milo/Dean）
- **遥测 · 触发**：端口、轮胎磨损阈值、防守距离、心跳间隔等
- **音频 · 主题**：音量、静音、高优先级抢断、配色主题

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

- **Electron + TypeScript**：主进程负责 UDP 解码 / LLM / TTS，渲染进程负责 UI 与 Web Audio 播放
- **F1 25 UDP 解码**：支持 2025 与 2026 赛季包两种线缆格式，自动按包头分派
- **React + Tailwind**：深色赛车玻璃拟态界面
- **OpenAI 兼容 LLM**：默认 DeepSeek（自动禁用 thinking 模式以降低延迟）
- **MiMo TTS**：24000Hz 单声道 PCM16 流式播放，带优先级抢断队列

## 许可

MIT
