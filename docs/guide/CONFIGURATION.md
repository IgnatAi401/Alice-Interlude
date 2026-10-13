# 配置指南

环境变量由 `.env` 或启动终端提供；角色与运行设置从 `config.json` 读取。未填写的配置使用 `src/config.ts` 中的默认值，未知字段和明显类型错误会在启动时拒绝。配置更改后重启。

## 环境变量

| 名称 | 用途 |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | 唯一 Telegram Bot 的 token |
| `TELEGRAM_CHAT_IDS` | 唯一访问白名单；逗号或空白分隔的完整 chat id |
| `ALICE_OWNER_CHAT_ID` | 主人私聊的 chat id（正整数），必须在 `TELEGRAM_CHAT_IDS` 中；只有这个私聊能执行管理命令，以后也只有它能使用电脑操控工具 |
| `ANTHROPIC_API_KEY` | 所有 Claude 请求共同使用的官方 API key |

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
  "model": { "model": "claude-sonnet-4-6", "mainMaxTokens": 4096 },
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

## Claude

`model.model` 填 Claude 模型代码。主叙事可调 `mainMaxTokens`、`mainTimeout`（毫秒）和 `mainTemperature`（0 到 1），以及 `mainPrompt`、`fixedPrompt`、`formatPrompt`、`stylePrompt`。

记忆与 Overlay 压缩使用 `model.compaction` 的 `model`、`maxTokens`、`timeout`、`temperature`。`alterSystem` 可单独设分析模型；留空复用主模型。所有任务均使用 Messages API，thinking 固定关闭，不提供服务商、协议或推理强度选择。

视觉通过 `model.vision.enabled` 开关，图片采用 Anthropic 原生 base64 格式。

## 生活、记忆和日志

- `runtime.userMessageDebounceSeconds`：等待短时连续消息，默认 2 秒。
- `runtime.autoAdvanceEnabled`、`autoAdvanceIntervalMinutes`、`restWindows`：后台生活节奏。
- `runtime.conversationFollowUpMinutes`：对话结束后的短期生活补写。
- `runtime.splitReplyMessages` 和打字延迟：自然拆分多条回复。
- `runtime.allowProactiveMessages`：是否允许主动可见联系，默认关闭。
- `memory`：场景压缩阈值、事实数量、人物变化证据和冷却期；检索为全文索引（中文三字片段）与重要度排序。
- `memory.publicOwnerProfile`：非主人聊天（其他私聊、群聊，以后的网站）里 Alice 可以知道的主人信息，默认为空。这些聊天看不到 `storyDefaults.userProfile`、`relationship` 和主人的私密记忆；只在这里写愿意公开的内容。
- `memory.publicDigestEnabled`：默认 `false`。开启后，后台会只用公开条目和公开事实另外生成一份场景摘要、剧情弧、continuity 和氛围描述，给非主人聊天使用（关闭时这些聊天看不到这几项）。每次生成是一次额外的压缩模型调用。可用 `/interlude.context.public` 检查生成结果。
- `memory.publicDigestEntryThreshold`：公开版每积累多少条新的公开条目刷新一次，默认 20；第一次只要 3 条。
- `agency`：日程、隐私、设备和主动联系间隔。[设计说明](../design/AGENCY_WINDOW.md)
- `alterSystem`：短期氛围惯性。[设计说明](../design/ALTER_SYSTEM.md)
- `logging.level`：`silent/error/warn/info/debug`；正文预览默认关闭。
- `logging.dumpRequests`：仅在 `logging.verbosity` 为 `diagnostic` 时生效，把每次发给模型的完整请求写到 `data/debug/requests/`（不含 API key），用于隐私隔离检查。文件包含私密内容，检查完请删除，平时保持关闭。
- `blindMode.enabled`：关闭管理命令及业务日志，仅保留周期健康心跳；恢复需要改配置并重启。
- `browser.enabled`：可选本机 Chrome 网页观察，默认关闭。其它浏览参数控制域名、超时、页数和文本预算。

这些参数的完整字段定义位于 `src/service.ts`；通常保留默认值即可。
