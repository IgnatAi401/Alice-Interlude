# 当前改造记录

## 0.1.3 · 独立 Telegram 版

- 改为 macOS 独立 Node 程序，复用持续叙事、记忆、状态变化和调度逻辑。
- Telegram 使用原生 Bot API 长轮询；token 和 chat id 白名单从环境读取。
- 主叙事、压缩、Overlay 和 Alter 统一使用 Anthropic Messages，关闭 thinking。
- 提示词按变化频率分层，固定排序，设置 1h/5m 缓存断点并记录缓存 token 用量。
- 使用 Node 内置 SQLite 保存独立数据，移除外部框架、平台适配、远程 embedding 和多服务商分支。
- 增加独立配置、部署文档，以及协议、授权、持久化和完整聊天链路测试。
