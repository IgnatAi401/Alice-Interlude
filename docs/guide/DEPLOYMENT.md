# macOS 部署说明

## 1. 创建 Bot

在 Telegram 的官方 `@BotFather` 对话中用 `/newbot` 创建机器人，保存它给出的 token。Anthropic API key 在自己的 Anthropic Console 创建。

项目终端中执行：

```sh
pnpm install --frozen-lockfile
cp .env.example .env
cp config.example.json config.json
```

填写 `.env` 的 `TELEGRAM_BOT_TOKEN` 和 `ANTHROPIC_API_KEY`。不要把实际 `.env` 发给别人。

## 2. 获取 chat id

给自己的 Bot 发一句话。在 Bot 尚未运行时，从项目目录执行下面的命令；它只输出待接收消息的 chat id 和聊天类型：

```sh
node --env-file=.env --input-type=module <<'JS'
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error('请先填写 TELEGRAM_BOT_TOKEN');
const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ timeout: 0, allowed_updates: ['message'] }),
  signal: AbortSignal.timeout(15000),
});
const data = await response.json();
if (!response.ok || !data.ok) throw new Error('Telegram 请求失败，请检查 token 或是否有其它接收程序');
const chats = new Map(data.result.filter(u => u.message).map(u => [u.message.chat.id, u.message.chat.type]));
for (const [id, type] of chats) console.log(id, type);
if (!chats.size) console.log('暂无消息；请先给 Bot 发一句话再执行');
JS
```

把自己的 ID 填入 `TELEGRAM_CHAT_IDS`。群聊 ID 可通过先把 Bot 加入群并发送提及 Bot 的消息，以同样方式获取。若 Bot 已设置 webhook，需要先通过 Telegram Bot API 删除 webhook，才能使用 `getUpdates`；本项目正式启动时会自动删除 webhook。

## 3. 填角色并运行

编辑 `config.json` 中的 `storyDefaults.characterProfile`，把示例文字替换成角色背景、性格和日常生活。默认示例模型为 `claude-sonnet-4-6`，也可以填写自己有权限使用的 Claude 模型代码。

```sh
pnpm build
pnpm start
```

看到连接日志后，在已获授权的私聊中发送消息或 `/interlude.doctor`。角色是否立即回复、延迟回复或保持沉默，由原有叙事逻辑决定。

## 4. 停止和重启

按 `Ctrl+C` 会停止接收、取消待执行计时器和请求、关闭可选浏览器与 SQLite。下次 `pnpm start` 会读取原有记录和接收位置。修改 `.env` 或 `config.json` 后也需要重启。

只运行一个使用该 token 的接收进程。程序没有自动安装登录项或后台服务，关机后需要手动启动。

如需群聊，用 [配置指南](CONFIGURATION.md) 的群聊例子，同时填写环境白名单和群配置。可选浏览功能需要 Google Chrome 位于 `/Applications/Google Chrome.app`，不需要时保持关闭。
