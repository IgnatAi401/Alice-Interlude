# 独立程序架构

## 数据流

```text
Telegram getUpdates 长轮询
  → 环境 chat id 白名单检查
  → 私聊叙事 / 已配置群聊 / 私聊管理命令
  → 消息持久化、短时合并和故事队列
  → 分层缓存提示词 → Anthropic Messages（thinking disabled）
  → JSON 解析、叙事与证据检查
  → 保存剧本、关系状态、记忆和未来计划
  → 白名单检查 → Telegram sendMessage
```

## 模块

| 文件 | 责任 |
| --- | --- |
| `main.ts` | macOS 检查、环境和配置加载、启动与退出 |
| `telegram.ts` | 原生 Bot API、长轮询、图片、白名单、投递和确认回答 |
| `runtime.ts` | 请求取消、计时器、日志和轻量命令解析 |
| `database.ts` | Node 内置 SQLite、JSON 记录、查询和接收位置 |
| `config.ts` | JSON 默认值与校验 |
| `commands.ts` | 私聊管理操作 |
| `service.ts` | 原有持续叙事、调度、参与者、记忆和状态演化 |
| `narrator.ts` | 原生 Messages 请求、提示词分层、缓存和 JSON 输出解析 |
| `alter.ts`、`agency.ts` | 氛围变化与现实行动容量 |
| `time.ts`、`logging.ts`、`group-willingness.ts` | 本地时间、日志与群聊意愿 |

模型调用固定官方 endpoint，API key 来自环境。不会注册插件、实例控制台、消息适配器或外部数据库服务。

## 数据与连续性

一个 Telegram Bot 对应一份共享主剧本。私聊参与者拥有各自关系状态；不同私聊的事实与计划按参与者隔离。每个故事串行提交，SQLite 写入也通过单个队列执行。

Canon 是显式配置的初始设定；Overlay 是证据支持的缓慢变化。场景摘要、剧情弧线、长期事实、记忆和短期余波共同构成受预算约束的连续性包。后台压缩继续使用 Claude，事实检索使用本地文本相关度、重要性、置信度和近期程度。

当前新消息可以替换首条回复尚未提交的旧模型请求。延迟回复和后续分段保存为意图，到期重新检查当前参与者授权再投递。群聊按群 chat id 授权，管理操作仅限私聊。

## 缓存和生命周期

固定规则、Canon、慢速记录分别使用 1h 断点，历史末尾使用 5m 断点。时间、事件和本轮策略在后部。缓存 token 用量由 Anthropic 响应记录。历史上下文截断、事实集合或设定变化会使对应前缀重新生成。

`Ctrl+C`/`SIGTERM` 停止轮询、取消计时器和 HTTP 请求、失效未提交草稿，随后关闭 Chrome 和 SQLite。接收位置与故事记录保存在同一数据库，下次启动继续读取。
