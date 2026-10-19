# 配置指南

环境变量由 `.env` 或启动终端提供；角色与运行设置从 `config.yaml` 读取。未填写的配置使用 `src/config.ts` 中的默认值，未知字段和明显类型错误会在启动时拒绝。`config.example.yaml` 列出了全部配置项，`#` 注释掉的行就是默认值，去掉 `#` 再修改即可（注意保持缩进）。`chatId`、`groupId` 要加引号写成字符串。配置更改后重启。

## 环境变量

| 名称 | 用途 |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | 唯一 Telegram Bot 的 token |
| `TELEGRAM_CHAT_IDS` | 唯一访问白名单；逗号或空白分隔的完整 chat id |
| `ALICE_OWNER_CHAT_ID` | 主人私聊的 chat id（正整数），必须在 `TELEGRAM_CHAT_IDS` 中；只有这个私聊能执行管理命令，以后也只有它能使用电脑操控工具 |
| `LLM_BASE_URL` | 模型服务地址，留空为 Anthropic 官方；DeepSeek 填 `https://api.deepseek.com/anthropic`。必须是 https |
| `LLM_API_KEY` | 模型服务的 API key（旧名 `ANTHROPIC_API_KEY` 仍可用） |
| `LLM_MODEL` | 主模型，如 `claude-sonnet-5-5`、`deepseek-flash`、`deepseek-v4-pro` |
| `LLM_COMPACTION_MODEL`、`LLM_ALTER_MODEL` | 压缩/整理、氛围分析用的模型，留空复用主模型 |
| `LLM_MAX_TOKENS`、`LLM_TIMEOUT_SECONDS` | 主叙事输出上限与超时（秒） |
| `LLM_VISION` | `true`/`false`，是否把图片发给模型 |

`LLM_*` 填了就优先于 `config.yaml` 的 `model` 设置，没填的项继续用 `config.yaml` 或默认值。

私聊 ID 为正整数，群聊 ID 为负整数。`config.yaml` 中的资料和群配置不授予环境白名单以外的访问权。消息接收、附件下载和发送都会检查白名单。

## 最小配置

```yaml
storyDefaults:
  characterName: Alice
  characterProfile: |
    在这里填写完整的人设和日常生活。
  world: 当代现实生活。
  location: 新加坡
  timezone: Asia/Singapore
runtime:
  autoCreate: true
  allowProactiveMessages: false
```

`storyDefaults` 还支持 `perspective`（个人价值观）、`userProfile`、`relationship`、`supportingCast` 和 `style`。

## 用户资料和群聊

以下配置为已在环境白名单中的聊天补充资料：

```yaml
telegram:
  userAccounts:
    - chatId: "123456789"
      label: 小林
      profile: Alice 的朋友
      relationship: 长期熟悉的朋友
  groupChats:
    - groupId: "-1001234567890"
      label: 朋友群
      enabled: true
      responseMode: mention-only
```

每个 Bot 共享一个主剧本，参与者有独立的资料与关系状态。默认不把其它私聊的详细资料传给当前私聊的模型请求；后台主动联系会使用受控的关系摘要。`shareParticipantDetails` 可显式开启跨参与者详细资料。

管理命令只允许 `ALICE_OWNER_CHAT_ID` 对应的私聊执行，其他私聊和群聊发送的管理命令会被静默忽略。群聊 `responseMode` 可设为 `always`；默认 `mention-only`。群意愿累积可用 `willingness.enabled` 单独开启。

## 模型

常用设置建议放 `.env`（见上表）。`config.yaml` 中对应 `model.model`（服务地址只能用 `LLM_BASE_URL` 设置），主叙事可调 `mainMaxTokens`、`mainTimeout`（毫秒）和 `mainTemperature`（0 到 1），以及 `mainPrompt`、`fixedPrompt`、`formatPrompt`、`stylePrompt`。

记忆与 Overlay 压缩使用 `model.compaction` 的 `model`、`maxTokens`、`timeout`、`temperature`。`alterSystem` 可单独设分析模型；留空复用主模型。所有任务都走 Anthropic Messages 协议，thinking 固定关闭；服务商只要兼容这一协议即可更换。DeepSeek 会忽略缓存断点（不影响结果，只是没有缓存折扣）。

视觉通过 `model.vision.enabled` 开关，图片采用 Anthropic 原生 base64 格式。

## 生活、记忆和日志

- `runtime.userMessageDebounceSeconds`：等待短时连续消息，默认 2 秒。
- `runtime.autoAdvanceEnabled`、`autoAdvanceIntervalMinutes`、`restWindows`：后台生活节奏。
- `runtime.urge.enabled`：默认 `false`。开启后常规推进间隔会随对话和 Alice 的生活状态伸缩：最近私聊越密集，推进越快（最多快 `activeMultiplier`=1.4 倍，按 `halfLifeMinutes`=90 分钟慢慢回落）；后台剧情会给出她当前的状态（玩手机 ×1.4、空闲 ×1、忙 ×0.7、躺着 ×0.5、睡觉 ×0.15），你发消息会把她从躺着/睡觉叫醒到玩手机。状态超过 2 小时没更新时，休息窗口内乘 `restMultiplier`（0.6），不再直接换成窗口里的长间隔。对话后的 10/20 分钟短期补写不受影响。
- `runtime.conversationFollowUpMinutes`：对话结束后的短期生活补写。
- `runtime.splitReplyMessages` 和打字延迟：自然拆分多条回复。`typingJitterRatio`（默认 0.3）让每段打字时间上下随机浮动约 30%，填 0 恢复固定延迟；模型回复很快时，首条气泡也会按字数等够打字时间再发，等待中收到新消息会合并重写。
- `runtime.allowProactiveMessages`：是否允许主动可见联系，默认关闭。
- `memory`：场景压缩阈值、事实数量、人物变化证据和冷却期；检索为全文索引（中文三字片段）与重要度排序。
- `memory.publicOwnerProfile`：非主人聊天（其他私聊、群聊，以后的网站）里 Alice 可以知道的主人信息，默认为空。这些聊天看不到 `storyDefaults.userProfile`、`relationship` 和主人的私密记忆；只在这里写愿意公开的内容。
- `memory.visitorDigestLimit`：主人私聊时附上最近活跃的几位访客（其他私聊、群聊、网站）各自最后 4 句对话，让你可以问 Alice“最近谁来过”，默认 5 位，`0` 关闭；只看 `memory.visitorDigestDays`（默认 3）天内活跃过的。附了这些内容的回合，Alice 记下的事实都按私密处理。
- `memory.publicDigestEnabled`：默认 `false`。开启后，后台会只用公开条目和公开事实另外生成一份场景摘要、剧情弧、continuity 和氛围描述，给非主人聊天使用（关闭时这些聊天看不到这几项）。每次生成是一次额外的压缩模型调用。可用 `/interlude.context.public` 检查生成结果。
- `memory.publicDigestEntryThreshold`：公开版每积累多少条新的公开条目刷新一次，默认 20；第一次只要 3 条。
- `memory.consolidateEnabled`：默认 `false`。开启后每天在故事时区的 `memory.consolidateAt`（默认 `04:00`）之后整理一次记忆：合并近似重复的长期事实；让被更新事实推翻的旧事实失效（一次压缩模型调用）；把超过 `memory.visitorTtlDays`（默认 30 天，`0` 为永不过期）的访客记录替换为占位符。访客包括主人以外的所有 Telegram 私聊和群聊。过期删除无法恢复，开启前请确认保留天数。Mac 在设定时间休眠时，醒来后的下一次后台检查会补做。
- `agency`：日程、隐私、设备和主动联系间隔。[设计说明](../design/AGENCY_WINDOW.md)
- `alterSystem`：短期氛围惯性。[设计说明](../design/ALTER_SYSTEM.md)
- `logging.level`：`silent/error/warn/info/debug`；正文预览默认关闭。
- `logging.dumpRequests`：仅在 `logging.verbosity` 为 `diagnostic` 时生效，把每次发给模型的完整请求写到 `data/debug/requests/`（不含 API key），用于隐私隔离检查。文件包含私密内容，检查完请删除，平时保持关闭。
- `blindMode.enabled`：关闭管理命令及业务日志，仅保留周期健康心跳；恢复需要改配置并重启。
- `browser.enabled`：可选本机 Chrome 网页观察，默认关闭。其它浏览参数控制域名、超时、页数和文本预算。

## 工具（仅主人私聊）

工具默认关闭。开关不在配置文件里：在主人私聊发送 `/tools on` 开启、`/tools off` 关闭，状态存在数据库中，重启后保持。开启后，只有主人私聊的消息回合（以及命令结果回来的那一轮）能使用工具，其他私聊、群聊和后台推进都没有工具。

- `recall`：在全部记忆里全文检索更早的细节，最多返回 `tools.recall.maxResults` 条（默认 8）。
- `read_skill`：读取 `tools.skills.dir`（默认 `~/AliceWorkspace/skills`）下 `<名字>/SKILL.md` 的全文。每个 `SKILL.md` 开头写 `name:` 和 `description:`（`---` 包围），索引会放进提示词。
- `exec`：请求执行一条 shell 命令。Alice 回复后，Bot 会另发一条消息显示命令全文和理由，带【执行】【拒绝】按钮；只有主人本人在私聊里点击、且在 `tools.exec.approvalTtlMinutes`（默认 10 分钟）内才会执行，重复点击只执行一次。命令用 `/bin/zsh -c` 在 `tools.exec.workdir`（默认 `~/AliceWorkspace`）运行，超时 `timeoutSeconds`（默认 60 秒），输出截断到 `maxOutputChars`（默认 8000 字），同时最多 `maxPending`（默认 3）条待审批。子进程只继承 `PATH`、`HOME`、`LANG` 等少数环境变量，拿不到 token 和 API key。读网页也通过这里的 `curl` 完成。
- `tools.maxSteps`：一轮里最多几次工具往返，默认 6。

命令确实会在你的电脑上运行，点【执行】前请看清命令全文；含 `sudo` 的命令会有醒目提示。

## 网站接口（public）

网站接口默认关闭，关闭时不开任何端口。开关同样不在配置文件里：主人私聊发送 `/web on` 立即开启，`/web off` 立即关闭并释放端口，状态重启后保持。下面的 `web` 配置段只管端口、路径和限流。开启后 Alice 在 `127.0.0.1:<web.port>` 提供一个通用 HTTP 接口，外网经 Cloudflare Tunnel 以 `https://api.ignat.ai/alice/api/...` 访问（见 [部署说明](DEPLOYMENT.md#5-网站接口与-cloudflare-tunnel)）。**通过这个接口来的所有对话都是 public 等级**：没有工具，只能看到公开记忆和该访客自己的记录。不需要额外的密钥或环境变量。

```yaml
web:
  port: 8787
  basePath: /alice
  serveRootPage: true
  siteUrl: https://alice.ignat.ai
  perVisitorPerMinute: 6
  perVisitorPerHour: 60
  perIpPerMinute: 6
  perIpPerHour: 60
  maxStreamsPerVisitor: 3
  guestIdleMinutes: 60
  renamesPerMonth: 3
```

- `basePath`：Alice 在 `api.ignat.ai` 上占用的一级路径，其他路径留给以后的服务。公网上只有 `<basePath>/api/*` 转到 Alice，`/` 与 `<basePath>/` 由独立的文档站提供（见部署说明）。
- `serveRootPage`：本机 `127.0.0.1:<web.port>/` 是否显示总览页。公网的根路径已由文档站接管，这一项只影响本机检查，可保持默认。
- `siteUrl`：说明页上“去聊天”的链接，留空则不显示。
- 限流：每个访客每分钟、每小时的消息数，每个 IP 每分钟、每小时的请求数（消息与申请身份码合计，默认与单个访客相同：6 条/分钟、60 条/小时），超出返回 429。另有固定的输错限制：同一 IP 每小时最多输错 20 次、同一个码每小时最多被输错 10 次，超过后返回 429（正确的密码也要等）。
- `guestIdleMinutes`：访客码闲置多少分钟后作废，默认 60。
- `renamesPerMonth`：每个身份每月（按故事时区的自然月）最多改名几次，默认 3；`0` 表示不能改名。
- 同时开启 `memory.consolidateEnabled`，访客记录（含作废访客码留下的记录）、网页聊天记录和闲置的身份号才会按 `memory.visitorTtlDays`（默认 30 天）删除，与说明页告知一致。
- 每日轮数上限：所有非主人回合（网站访客、其他私聊、群聊发言）每天共用一个上限，默认 200，按故事时区零点重置；主人不受限。上限不在配置文件里，用 `/quota 300` 随时修改。用完后网站返回 429，响应体带 `code: "daily_limit"`、一句角色化的 `reply` 和 `Retry-After`（秒，到次日零点）。

### 怎么调用

先用 `POST /api/visitor` 申请身份码，再带着它发消息；不带身份码的请求一律返回 401。两种身份：

- **正式身份**：身份码 `v_` + 8 位（如 `v_K7M2Q9XP`）和 8 位密码（如 `4HNW8T3R`），调用方自己保存，以后可手输找回对话。只用大写字母和数字、去掉了易混的 `0 O 1 I L`，输入不分大小写。
- **访客模式**：申请时带 `"guest": true`，只发访客码 `g_` + 22 位，不要密码。闲置超过 `guestIdleMinutes`（默认 1 小时）就作废，之后用它会返回 401 `Guest code expired`；它留下的聊天和记忆不再对应任何码，仍保存在服务器上（只有主人能看到），按 `visitorTtlDays` 删除。

**姓名**：申请正式身份必须带 `name`（1–24 字），它与码绑定，Alice 会把它当作对方的名字。起名和改名先过内置词库，能确定的直接给结论；其余由模型审查。单纯的粗口名（如“傻逼”“SB”）可以用，有针对性的辱骂（“小明是傻逼”“你傻逼”、骂 Alice 或某个群体）不行；“妈妈”“主人”这类占便宜的称呼、冒充 Alice 或管理员的名字会被拒绝（422，`code: "name_rejected"`，带 `reason`），此时不发码、不改名；审查服务出错返回 503（`code: "name_review_unavailable"`）。访客模式不能取名，固定叫“访客”+ 访客码的前 6 位（如 `访客AbC1x2`），带 `name` 申请返回 400、调 `/api/name` 返回 403（`code: "guest_no_name"`）。改名每月有次数上限，超过返回 429（`code: "rename_limit"`）；被拒绝的尝试不计次数，但和发消息共用限流。

政治昵称只拦明确内容：政治人物全名、党政军机构或官方身份、明确政治事件、分裂主张、政治组织和口号；简繁体与明确外文全名同样检查。包子、维尼、64 等隐喻、暗语、谐音、拆字和缩写不做政治推断；普通姓名、地名和一般词不因联想拒绝。政治拒绝沿用 422 `name_rejected`，原因统一为“姓名包含明确政治内容，请换个称呼”。

```sh
# 申请正式身份：返回 visitorId 和 visitorKey（密码只返回这一次）
curl -X POST https://api.ignat.ai/alice/api/visitor -H 'Content-Type: application/json' -d '{"name":"小明"}'
# 或访客模式：只返回 visitorId（g_ 码），之后只带它就行
curl -X POST https://api.ignat.ai/alice/api/visitor -H 'Content-Type: application/json' -d '{"guest":true}'
# 发消息：带上身份码（和密码）
curl -X POST https://api.ignat.ai/alice/api/message -H 'Content-Type: application/json' -d '{"visitorId":"v_…","visitorKey":"…","text":"在吗"}'
# 读历史（Alice 的回复是异步的，稍等再读）
curl 'https://api.ignat.ai/alice/api/history?visitorId=v_…' -H 'X-Visitor-Key: …'
```

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/visitor` | `{ name, guest? }` → `201 { visitorId, visitorKey?, name, renamesLeft }`。`name` 正式身份必填、访客模式不能带；`guest: true` 为访客模式（无密码）；计入按 IP 的限流。申请后超过 24 小时没有任何请求、也从没发过消息的身份会被自动清理 |
| `POST` | `/api/name` | `{ visitorId, visitorKey?, name }` → `200 { name, renamesLeft }`。与当前名字相同时不审查、不计次；访客码返回 403 |
| `POST` | `/api/message` | `{ text, visitorId, visitorKey?, clientId? }` → `202 { id, visitorId }`。`text` 1–2000 字；`clientId` 用于网络重试去重 |
| `GET` | `/api/history?visitorId=…` | 密码只认请求头 `X-Visitor-Key`（访客码不需要） → `{ visitorId, name, renamesLeft, messages: [{ id, role: 'visitor'|'alice', text, at }] }`（最近 200 条） |
| `GET` | `/api/events?visitorId=…&visitorKey=…` | SSE 推送 `typing {active}` 与 `message`；浏览器 EventSource 不能带请求头，所以密码放查询参数 |

没带身份码、身份码或密码不对、访客码已作废都返回 401。任何网站、脚本都能调用（`Access-Control-Allow-Origin: *`）。

这些参数的完整字段定义位于 `src/config.ts`；通常保留默认值即可。
