# 开发说明

修改后使用 `pnpm typecheck`、`pnpm test` 和 `pnpm build`。遵循已有 pnpm 锁文件，不加入另一套包管理器。构建先清理生成目录 `lib/`。

模型协议修改需同步更新类型、提示词、请求块、规范化和持久化路径，以及相关测试和说明。集成测试使用伪造 token 和模拟网络，不调用实际服务。

日志约束见 [logging/LOG_FORMAT_DESIGN.md](logging/LOG_FORMAT_DESIGN.md)，格式实现见 [logging/LAYERED_LOG_IMPLEMENTATION.md](logging/LAYERED_LOG_IMPLEMENTATION.md)。
