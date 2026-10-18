# Alice HDSI Telegram Bot

独立运行在 macOS 的 Telegram 聊天机器人。复用 HDSI 的持续叙事、记忆、人物变化、延迟回复、自动生活推进、群聊和管理命令逻辑；使用 Node 自带的 SQLite 保存数据。

模型任务统一使用 Anthropic 官方 Messages API，包括主叙事、记忆压缩、人物变化摘要和 Alter 氛围分析。每次请求都显式设置 `thinking: { "type": "disabled" }`。

## 启动

需要 macOS、Node.js 24.x，以及 pnpm。本项目已有 `pnpm-lock.yaml`，请使用同一套工具。

```sh
cd /Users/ignat/Developer/Alice-Interlude
pnpm install --frozen-lockfile
cp .env.example .env
cp config.example.json config.json
```

编辑 `.env`，填写四个环境变量：

```dotenv
TELEGRAM_BOT_TOKEN=你的BotFather令牌
TELEGRAM_CHAT_IDS=你的私聊chat_id
ALICE_OWNER_CHAT_ID=你的私聊chat_id
ANTHROPIC_API_KEY=你的Anthropic密钥
```

多个 chat id 用逗号分隔；私聊通常为正整数，群聊为负整数。空白名单会阻止启动。`ALICE_OWNER_CHAT_ID` 是主人自己的私聊 chat id，必须同时出现在 `TELEGRAM_CHAT_IDS` 中，否则无法启动。`.env` 只是 Node 启动时加载环境变量的便利方式，也可以由终端直接提供这些变量。

在 `config.json` 中填写 `storyDefaults.characterProfile`，按需修改模型名、时区和用户资料。示例开启了 `runtime.autoCreate`，第一次获授权私聊会创建故事；示例关闭主动联系，角色仍可回复当前消息并进行后台生活推进。

```sh
pnpm build
pnpm start
```

给 Bot 发私聊即可。按 `Ctrl+C` 停止；电脑关机或睡眠期间不能持续收发。开发时可运行 `pnpm dev`。无需打开本机端口，程序通过 Telegram 长轮询接收消息。

不知道 chat id 时，先填 Bot token、给 Bot 发一句话，再按 [部署说明](docs/guide/DEPLOYMENT.md) 获取。运行中的 Bot 请先停止，再获取 ID。

## 配置和管理

凭据和访问白名单仅从环境变量读取。`config.json` 保存角色、模型和调度设置，以及获授权聊天的可选人物资料。配置改动需要重启程序。

群聊除了在 `TELEGRAM_CHAT_IDS` 中获授权，还需要在 `telegram.groupChats` 中启用；默认只在被提及时触发。群成员无须逐个加入私聊白名单，管理命令只在主人私聊（`ALICE_OWNER_CHAT_ID`）中执行。

数据保存在 `data/interlude.sqlite`，包含剧本、参与者、记忆、长期事实、计划、人物变化和 Telegram 接收位置。该实现使用独立数据库格式，不自动导入旧实例数据库。

常用命令：`/interlude.doctor`、`/interlude.status`、`/interlude.timeline`、`/interlude.memory`、`/interlude.pause`、`/interlude.resume`。完整说明见 [命令说明](docs/guide/COMMANDS.md)。

Telegram 照片和受支持的图片文件会通过 Telegram 下载后作为 Anthropic 原生 base64 图片块发送；单图限制 4 MiB，一轮最多三张。语音会记录收到附件的事实，当前没有转写功能。可选网页观察使用 macOS 本机 Google Chrome，默认关闭。

## 提示词和缓存

实际发送顺序按变化频率组织：

1. 固定输出规则、基础任务和写作文风。
2. 角色初始设定（Canon）。
3. 缓慢变化的人物设定、长期事实、记忆和变化摘要，记录采用固定排序。
4. 按时间追加的已发生剧本。
5. 当前场景、参与者、状态和本轮策略。
6. 当前时间、当前消息和图片。

前三层使用 `1h` 缓存断点，已发生剧本使用 `5m` 断点，总计最多四个；当前时间和事件位于缓存之后。主请求把每条历史记录作为独立块，追加新历史时保留旧块的文本。压缩和 Alter 也把固定规则放在请求前部。

缓存命中仍取决于模型的最小缓存 token 数、前缀是否完全一致、有效期和历史截断。代码记录 `cache_creation_input_tokens` 与 `cache_read_input_tokens`，可据此观察实际效果；无法承诺每次完全命中。协议依据 [Anthropic 缓存说明](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)。

## 开发检查

```sh
pnpm typecheck
pnpm build
```

构建会先清理 `lib/` 再生成 JavaScript，防止旧文件残留。

更多说明见 [文档索引](docs/README.md)：[新手指南](docs/guide/BEGINNER.md)、[配置指南](docs/guide/CONFIGURATION.md)、[架构](docs/design/ARCHITECTURE.md)、[Alter](docs/design/ALTER_SYSTEM.md)、[Agency](docs/design/AGENCY_WINDOW.md)。
