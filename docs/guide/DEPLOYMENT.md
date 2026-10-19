# macOS 部署说明

## 1. 创建 Bot

在 Telegram 的官方 `@BotFather` 对话中用 `/newbot` 创建机器人，保存它给出的 token。模型 API key 在对应服务商的控制台创建（Anthropic Console，或 DeepSeek 开放平台）。

项目终端中执行：

```sh
pnpm install --frozen-lockfile
cp .env.example .env
cp config.example.json config.json
```

填写 `.env` 的 `TELEGRAM_BOT_TOKEN`，以及 `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`。不要把实际 `.env` 发给别人。

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

把自己的 ID 同时填入 `TELEGRAM_CHAT_IDS` 和 `ALICE_OWNER_CHAT_ID`。群聊 ID 可通过先把 Bot 加入群并发送提及 Bot 的消息，以同样方式获取。若 Bot 已设置 webhook，需要先通过 Telegram Bot API 删除 webhook，才能使用 `getUpdates`；本项目正式启动时会自动删除 webhook。

## 3. 填角色并运行

编辑 `config.json` 中的 `storyDefaults.characterProfile`，把示例文字替换成角色背景、性格和日常生活。模型在 `.env` 的 `LLM_MODEL` 中填写。

```sh
pnpm build
pnpm start
```

看到连接日志后，在已获授权的私聊中发送消息或 `/doctor`。角色是否立即回复、延迟回复或保持沉默，由原有叙事逻辑决定。

## 4. 停止和重启

按 `Ctrl+C` 会停止接收、取消待执行计时器和请求、关闭可选浏览器与 SQLite。下次 `pnpm start` 会读取原有记录和接收位置。修改 `.env` 或 `config.json` 后也需要重启。

只运行一个使用该 token 的接收进程。程序没有自动安装登录项或后台服务，关机后需要手动启动。

如需群聊，用 [配置指南](CONFIGURATION.md) 的群聊例子，同时填写环境白名单和群配置。可选浏览功能需要 Google Chrome 位于 `/Applications/Google Chrome.app`，不需要时保持关闭。

## 5. 网站接口与 Cloudflare Tunnel

以下步骤在**服务器 Mac**上做。Tunnel 是 Cloudflare 提供的“反向通道”：本机主动连到 Cloudflare，访客访问 `api.ignat.ai` 时由 Cloudflare 转进来，路由器不用开端口。

1. 启动 Alice 后，在主人私聊发送 `/web on`。Bot 回复“已开启网站接口，监听 127.0.0.1:8787/alice”即可；浏览器打开 http://127.0.0.1:8787/alice/ 能看到说明页。这个开关会保存，之后重启自动开启；发送 `/web off` 关闭。
2. 安装并登录 cloudflared（机器级工具，只需一次）：

   ```sh
   brew install cloudflared
   cloudflared tunnel login
   cloudflared tunnel create ignat-api
   cloudflared tunnel route dns ignat-api api.ignat.ai
   ```

   `create` 会打印 tunnel 的 ID，并在 `~/.cloudflared/` 生成 `<ID>.json` 凭据文件（不要外传）。

3. 新建 `~/.cloudflared/config.yml`（`<ID>` 和用户名换成自己的）：

   ```yaml
   tunnel: <ID>
   credentials-file: /Users/<用户名>/.cloudflared/<ID>.json
   ingress:
     - hostname: api.ignat.ai
       path: ^/alice(/|$)
       service: http://127.0.0.1:8787
     - hostname: api.ignat.ai
       path: ^/$
       service: http://127.0.0.1:8787   # 根说明页，以后可改指向别的服务
     # 以后新增服务：在这里按一级路径加规则，例如 path: ^/other(/|$)
     - service: http_status:404
   ```

4. 运行 `cloudflared tunnel run ignat-api`，然后检查：
   - `https://api.ignat.ai/` 和 `https://api.ignat.ai/alice/` 显示说明页；
   - `https://api.ignat.ai/xxx` 返回 404；
   - `curl -i 'https://api.ignat.ai/alice/api/history?visitorId=v_0000000000000000'` 返回 401（身份号不存在）。
5. 建议在 Cloudflare 控制台 → 安全性 → WAF → 速率限制规则，给以 `/alice/api/` 开头的路径加一条限流（免费版可建 1 条）。

开机自启（LaunchAgent）属于阶段 6，目前需要手动启动 cloudflared 与 Alice。

