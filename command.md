# Telegram 管理命令

在获授权私聊中发送以下完整文本。Telegram 的命令菜单只支持有限命名形式，本项目直接解析 `/interlude.xxx` 文本，无须向 BotFather 注册菜单。管理权限由 `sharedStory.managerAccounts` 限制；留空时允许全部获授权私聊。失明模式关闭这些命令。

| 命令 | 用途 |
| --- | --- |
| `/interlude.doctor` | 检查角色设定、权限和模型 |
| `/interlude.story.start` | 手动创建共享主剧本 |
| `/interlude.status` | 查看故事和模型状态 |
| `/interlude.pause`、`/interlude.resume` | 暂停、恢复处理 |
| `/interlude.advance` | 补写生活到现在 |
| `/interlude.timeline [条数]` | 查看近期记录 |
| `/interlude.memory [条数]` | 查看叙事记忆 |
| `/interlude.context` | 场景、长期事实与人物变化 |
| `/interlude.compact` | 立即整理已发生的剧本 |
| `/interlude.setup <JSON>` | 修改当前故事设定 |
| `/interlude.script [条数]` | 查看原始剧本条目 |
| `/interlude.script.note <正文>` | 写入管理员注记 |
| `/interlude.memory.facts [条数]` | 查看长期事实及编号 |
| `/interlude.memory.add <scope> <正文>` | 添加事实；scope 为 character/world/relationship/event/promise |
| `/interlude.memory.forget <编号>` | 将事实标为失效 |
| `/interlude.memory.intents [条数]` | 查看待执行计划 |
| `/interlude.memory.cancel <编号>` | 取消计划或延迟消息 |
| `/interlude.memory.patches [条数]` | 查看设定变化提案 |
| `/interlude.memory.reject <编号>` | 拒绝尚未应用的提案 |
| `/interlude.overlay.status` | 查看人物变化及摘要 |
| `/interlude.overlay.compact` | 只压缩设定变化 |
| `/interlude.overlay.clear <target>` | 清理变化；target 取 character/world/relationship/all |
| `/interlude.purge.range <起始ISO时间> <结束ISO时间>` | 删除时间范围内的数据 |
| `/interlude.purge.all` | 清理历史并按当前配置重建初始设定 |
| `/interlude.database.clear` | 清空本地叙事数据 |

方括号表示可选参数，不需要把括号发给 Bot。涉及大范围删除的命令会要求 60 秒内回复 `y` 或 `n`；这是运行中的数据操作确认。
