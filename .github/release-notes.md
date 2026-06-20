**F1 25 AI Race Engineer** — 监听 F1 25 UDP 遥测，用 AI 扮演比赛工程师，关键时刻主动语音播报策略建议。精美深色赛车驾驶舱 UI。

---

## 功能

- **完整遥测接收** — 速度、档位、转速、四轮磨损/温度/刹车温度、车身损伤、ERS、DRS、燃料、天气、旗语，以及所有对手的位置/圈速/差距/轮胎/进站/罚时
- **关键时刻主动播报** — 轮胎磨损过界、被后车追近、进站窗口、安全车/虚拟安全车/红旗、变天、低油、碰撞、位置变化
- **AI 工程师判断讲话时机** — 弯道自动保持安静，直道才播报（紧急情况除外）
- **三种 AI 工程师风格** — GP（红牛式冰冷极简）、Bono（梅赛德斯式温暖可靠）、Bozzi（法拉利式清晰专业）
- **三语播报** — 中文 / English / 中英混合，嗓音可选（冰糖/茉莉/苏打/白桦 / Mia/Chloe/Milo/Dean）
- **24 条 F1 25 + 1 条 DLC 赛道高精度 SVG 赛道图**
- **驾驶舱 UI** — 赛道图、HUD（换挡灯/转速/ERS/DRS/踏板）、轮胎卡（磨损条+三种温度+C编号）、损伤面板、对手榜、工程师对话流
- **完整设置面板** — LLM、TTS、语音语言、AI 工程师风格、遥测触发阈值、音频主题，各 tab 都有连接测试按钮

## 安装方式

- **安装版**：`F1 Race Engineer Setup 0.1.0.exe`
- **便携版**：`F1 Race Engineer-0.1.0-portable.exe`（绿色免安装）

> 下载后把便携版解压到任意位置，在 exe 同目录创建 `.env` 填入 API 密钥即可

## 配置

在 exe 同目录创建 `.env` 文件：

```env
AI_API_BASE_URL=api.deepseek.com
AI_API_KEY=sk-你的密钥
AI_MODEL=deepseek-v4-flash

MIMO_API_BASE_URL=api.xiaomimimo.com
MIMO_API_KEY=sk-你的mimo密钥
```

也可启动后在右上角 ⚙ 设置面板里直接填写密钥和 URL。

## 在 F1 25 中开启遥测

`Options → Settings → UDP Telemetry Settings` → 端口 **20777**，速率 20/30/60Hz

## 技术栈

Electron + TypeScript · React + Tailwind · OpenAI 兼容 LLM · MiMo TTS · F1 25 UDP 解码

## 从源码构建

```bash
git clone https://github.com/kemi-20/f1tr.git && cd f1tr
npm install
npm run dev          # 开发模式
npm run build:win    # 打包
```

---

> 首次运行 Windows SmartScreen 可能警告"未知发布者"→ 点"更多信息" → "仍要运行"即可。
