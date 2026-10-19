# 配置指南

环境变量由 `.env` 或启动终端提供；角色与运行设置从 `config.json` 读取。未填写的配置使用 `src/config.ts` 中的默认值，未知字段和明显类型错误会在启动时拒绝。配置更改后重启。

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

`LLM_*` 填了就优先于 `config.json` 的 `model` 设置，没填的项继续用 `config.json` 或默认值。

私聊 ID 为正整数，群聊 ID 为负整数。`config.json` 中的资料和群配置不授予环境白名单以外的访问权。消息接收、附件下载和发送都会检查白名单。

## 最小配置

```json
{
  "storyDefaults": {
    "characterName": "Alice",
    "characterProfile": "在这里填写完整的人设和日常生活。",
    "world": "当代现实生活。",
    "location": "新加坡",
    "timezone": "Asia/Singapore"
  },
  "runtime": { "autoCreate": true, "allowProactiveMessages": false }
}
```

`storyDefaults` 还支持 `perspective`（个人价值观）、`userProfile`、`relationship`、`supportingCast` 和 `style`。

## 用户资料和群聊

以下配置为已在环境白名单中的聊天补充资料：

```json
{
  "telegram": {
    "userAccounts": [
      { "chatId": "123456789", "label": "小林", "profile": "Alice 的朋友", "relationship": "长期熟悉的朋友" }
    ],
    "groupChats": [
      { "groupId": "-1001234567890", "label": "朋友群", "enabled": true, "responseMode": "mention-only" }
    ]
  }
}
```

每个 Bot 共享一个主剧本，参与者有独立的资料与关系状态。默认不把其它私聊的详细资料传给当前私聊的模型请求；后台主动联系会使用受控的关系摘要。`shareParticipantDetails` 可显式开启跨参与者详细资料。

管理命令只允许 `ALICE_OWNER_CHAT_ID` 对应的私聊执行，其他私聊和群聊发送的管理命令会被静默忽略。旧版的 `sharedStory.managerAccounts` 已移除，配置中保留该项会导致启动报错。群聊 `responseMode` 可设为 `always`；默认 `mention-only`。群意愿累积可用 `willingness.enabled` 单独开启。

## 模型

常用设置建议放 `.env`（见上表）。`config.json` 中对应 `model.baseUrl`、`model.model`，主叙事可调 `mainMaxTokens`、`mainTimeout`（毫秒）和 `mainTemperature`（0 到 1），以及 `mainPrompt`、`fixedPrompt`、`formatPrompt`、`stylePrompt`。

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

`tools.enabled` 默认 `false`。开启后，只有主人私聊的消息回合（以及命令结果回来的那一轮）能使用工具，其他私聊、群聊和后台推进都没有工具。

- `recall`：在全部记忆里全文检索更早的细节，最多返回 `tools.recall.maxResults` 条（默认 8）。
- `read_skill`：读取 `tools.skills.dir`（默认 `~/AliceWorkspace/skills`）下 `<名字>/SKILL.md` 的全文。每个 `SKILL.md` 开头写 `name:` 和 `description:`（`---` 包围），索引会放进提示词。
- `exec`：请求执行一条 shell 命令。Alice 回复后，Bot 会另发一条消息显示命令全文和理由，带【执行】【拒绝】按钮；只有主人本人在私聊里点击、且在 `tools.exec.approvalTtlMinutes`（默认 10 分钟）内才会执行，重复点击只执行一次。命令用 `/bin/zsh -c` 在 `tools.exec.workdir`（默认 `~/AliceWorkspace`）运行，超时 `timeoutSeconds`（默认 60 秒），输出截断到 `maxOutputChars`（默认 8000 字），同时最多 `maxPending`（默认 3）条待审批。子进程只继承 `PATH`、`HOME`、`LANG` 等少数环境变量，拿不到 token 和 API key。读网页也通过这里的 `curl` 完成。
- `tools.maxSteps`：一轮里最多几次工具往返，默认 6。

命令确实会在你的电脑上运行，点【执行】前请看清命令全文；含 `sudo` 的命令会有醒目提示。

这些参数的完整字段定义位于 `src/config.ts`；通常保留默认值即可。
