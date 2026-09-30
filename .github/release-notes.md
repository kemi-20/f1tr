# F1 Race Engineer v0.3

自动识别 F1 25 / F1 26 UDP 遥测，通过独立内置的 DeepSeek Harness `0.2.0-rc.1` 分析比赛，使用 MiMo 流式 TTS 播报。

## 本次更新

- DSH 原生 `f1-race-engineer` 预设与遥测、历史、原始包、赛道位置、截图、搜索和 `speak_radio` 工具；无需另装 DSH 或 Node。
- 策略按实际总圈数、剩余距离和本场圈速、油耗、磨损趋势判断，比较 undercut / overcut、不同旗语下进站损失与出站交通。
- 区分快速圈差、排名秒差、累计比赛距离和物理赛道弧长；至少三次连续观测才估算接近速度和追及时间，播报前再次复核准备圈交通。
- 出站交通查询支持完整出口耗时范围，包含套圈车；数据不足或安全车期间明确拒绝不可靠的外推。
- 练习/排位排名显示相对玩家的最快有效圈差，飞驰圈减少常规无线电干扰。
- 自动检查由模型调用语音工具决定播报，移除 NOW/HOLD 和重复“已回复”消息；聊天支持 Markdown。
- GP / Bono / Bozzi / Adami 四种沟通偏好，MiMo 预置音色流式播放；不包含语音克隆。
- 搜索支持多轮调用、缓存和每分钟请求保护；工具返回经过凭据遮蔽的具体错误。
- 赛道图和车辆温度/损伤模型改进，前翼与尾翼首次有效损伤数据前保持灰色；赛道 JSON 抽稀，减少打包体积。
- Electron 44.0.0，DSH 使用 Electron 自带 Node；保留 en-US / zh-CN，移除不使用的 GPU 分发文件。

## 下载与配置

- 安装版：`F1 Race Engineer Setup 0.3.0.exe`
- 便携版：`F1 Race Engineer-0.3.0-portable.exe`，每次启动需自解压。
- Actions 提供完整解包目录，可直接运行其中的 EXE，避免重复自解压。

在设置中填写主模型的 OpenAI Chat Completions 地址、模型和 Key，以及 MiMo Key。开启“支持网络搜索”由当前模型搜索（官方 MiMo 使用 Chat Completions，其他服务使用 Responses）；关闭时由 MiMo `mimo-v2.6-flash` 代搜。

游戏 UDP 端口默认 **20777**。可用数据受协议和遥测隐私限制；外部搜索资料不替代本场遥测。位置预测和出站交通结果是有条件的估算，仍需真实游戏联调验证。

应用尚未签名，Windows 可能显示未知发布者提示。
