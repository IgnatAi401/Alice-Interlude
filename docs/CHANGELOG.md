# 当前改造记录

## 未发布

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
- 新增调试开关 `logging.dumpRequests`（需 `verbosity=diagnostic`），导出完整模型请求用于隐私检查。

## 0.1.3 · 独立 Telegram 版

- 改为 macOS 独立 Node 程序，复用持续叙事、记忆、状态变化和调度逻辑。
- Telegram 使用原生 Bot API 长轮询；token 和 chat id 白名单从环境读取。
- 主叙事、压缩、Overlay 和 Alter 统一使用 Anthropic Messages，关闭 thinking。
- 提示词按变化频率分层，固定排序，设置 1h/5m 缓存断点并记录缓存 token 用量。
- 使用 Node 内置 SQLite 保存独立数据，移除外部框架、平台适配、远程 embedding 和多服务商分支。
- 增加独立配置、部署文档，以及协议、授权、持久化和完整聊天链路测试。
