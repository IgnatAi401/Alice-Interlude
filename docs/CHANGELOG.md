# 当前改造记录

## 未发布

- 运行环境改为 Node.js 24.x（不再支持 22.x）。
- 移除 `test/` 自动化测试与 `pnpm test`；开发检查改为 `pnpm typecheck`、`pnpm build` 和实际运行验证。
- 文档整理到 `docs/guide/`（使用说明）和 `docs/design/`（设计说明）。
- 新增必填环境变量 `ALICE_OWNER_CHAT_ID`（主人私聊 chat id，须在 `TELEGRAM_CHAT_IDS` 中）。
- 管理命令只允许主人私聊执行，其他聊天的管理命令静默忽略；移除 `sharedStory.managerAccounts`。
- 记忆类记录新增 `audience` 受众标签；模型输出的记忆、事实和设定变化提案需附带 `private`/`public`，后台推进可附 `scriptAudience`。启动时自动迁移（`schema_version=1`），已有记录全部标为 `private`。
- 记忆读取统一按受众过滤：非主人私聊和群聊只能读到公开记录和自己的记录。迁移前的旧记录都是 `private`，因此这些聊天之前的历史不再进入它们的上下文。
- 长期事实检索改用 SQLite FTS5 trigram 全文索引，中文可按三字片段命中（`schema_version=2` 自动建立索引）。
- 非主人聊天（其他私聊、群聊）改用隔离上下文：看不到 continuity、人物变化、其他参与者、全局计划和主人画像；不能给其他账号发消息或刷新 continuity。新增 `memory.publicOwnerProfile` 配置可以公开的主人信息。
- 主人回合中的访客记录包装在 `<visitor_notes>` 中，作为引用资料而非指令。
- 新增记忆管理命令 `/interlude.memory.search`、`.public`、`.private`、`.visitors`、`.visitor`；`.forget` 支持事实和剧本条目；列表显示 `f/e` 编号与 🔒/🌐/👤 受众标记。
- 记忆并入长期事实：模型输出的 `memories` 按 `category` 映射为事实的 scope 写入 `interlude_fact`，相同内容自动合并；启动时迁移（`schema_version=3`）把已有记忆复制为事实，旧行标为 `migrated`。提示词不再单独发送 `memories` 块，长期事实预算相应提高；`/interlude.memory` 改为显示长期事实。
- 新增公开版派生层（默认关闭，`memory.publicDigestEnabled`）：只用公开条目和公开事实单独生成场景摘要、剧情弧、continuity 与氛围描述，供非主人聊天使用；公开人物变化直接由公开提案合并。主人撤回或删除公开内容时自动清空重建。新增 `/interlude.context.public` 查看访客实际拿到的公开版。
- 新增每晚记忆整理（默认关闭，`memory.consolidateEnabled`、`consolidateAt`、`visitorTtlDays`）：合并近似重复的事实，让被新事实推翻的旧事实失效，删除超过保留期的访客记录（替换为占位符）。可用 `/interlude.memory.consolidate` 手动执行。
- 新增调试开关 `logging.dumpRequests`（需 `verbosity=diagnostic`），导出完整模型请求用于隐私检查。
- 新增主人私聊工具（默认关闭，`tools.enabled`）：`recall` 检索更早的记忆，`read_skill` 读取 `~/AliceWorkspace/skills` 中的说明书，`exec` 请求在 Mac 上执行命令。每条命令都会单独发来带【执行】【拒绝】按钮的消息，10 分钟内有效；执行结果会交回 Alice 回复。其他聊天没有任何工具。
- 新增 `/interlude.exec [编号]` 查看命令审批记录和输出。

- 打字节奏更像真人：每段延迟随机浮动（`runtime.typingJitterRatio`，默认 0.3）；私聊首条气泡按字数补足打字时间再发，等待中来了新消息会合并重写。
- 提示词说明 `[管理员注记]` 是主人写入的权威设定，Alice 会照此行事但不会提起注记本身；最近 3 条注记在上下文截断时保持完整。
- 私聊连续两次以上用相同条数（≥2 条）回复时，提醒模型不要沿用固定条数。
- 提示词补充“换行不分气泡，只有 `<sep/>` 分”和线上打字表达指引。

- Telegram 发送失败不再只记日志：网络或服务器原因的失败会在 30 分钟内自动补发（1、2、4、8 分钟间隔，重启后继续），后续分段按顺序等补发完成；被拒绝的消息记为未送达。未送达的消息在剧本中会被标出，Alice 不会以为你已经看到。补发期间你发来新消息时，旧消息不再补发，由新回复接手。
- 承诺回访超过有效期或重查、改期累计 5 次后停止调度，不再占用名额。
- 修复多个分段同时逾期时后面的分段可能先发出的问题。

- 新增 Urge 弹性推进（默认关闭，`runtime.urge`）：后台推进间隔随最近私聊密度和 Alice 的生活状态（玩手机/空闲/忙/躺着/睡觉）伸缩，你发消息会把她从睡觉或躺着的状态叫醒。
- 私聊回合在当前事件前附上最近 6 条真实收发消息（`recentExchange`），帮助模型对准最新语境。

## 0.1.3 · 独立 Telegram 版

- 改为 macOS 独立 Node 程序，复用持续叙事、记忆、状态变化和调度逻辑。
- Telegram 使用原生 Bot API 长轮询；token 和 chat id 白名单从环境读取。
- 主叙事、压缩、Overlay 和 Alter 统一使用 Anthropic Messages，关闭 thinking。
- 提示词按变化频率分层，固定排序，设置 1h/5m 缓存断点并记录缓存 token 用量。
- 使用 Node 内置 SQLite 保存独立数据，移除外部框架、平台适配、远程 embedding 和多服务商分支。
- 增加独立配置、部署文档，以及协议、授权、持久化和完整聊天链路测试。
