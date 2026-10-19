# Telegram 管理命令

在主人私聊（`ALICE_OWNER_CHAT_ID`）中发送。启动时 Bot 会自动把命令注册到 Telegram 菜单（只在主人私聊里显示，无须找 BotFather），输入 `/` 即可选择。菜单用短名，如 `/memory_facts`；旧写法 `/interlude.memory.facts` 仍然有效。其他聊天发送的管理命令会被静默忽略（短名在其他聊天里按普通消息处理，与以前一致）。失明模式或 `runtime.ignoreCommandMessages=false` 时关闭这些命令并清空菜单。

`/start` 检测 Bot 是否在线；`/help` 显示每条命令的详细用法和例子，`/help memory_add` 只看一条。

| 命令 | 用途 |
| --- | --- |
| `/start` | 检测是否在线，显示运行概况 |
| `/help [命令名]` | 全部命令的详细用法 |
| `/doctor` | 检查角色设定、权限和模型 |
| `/story_start` | 手动创建共享主剧本 |
| `/status` | 查看故事和模型状态 |
| `/pause`、`/resume` | 暂停、恢复处理 |
| `/advance` | 补写生活到现在 |
| `/timeline [条数]` | 查看近期记录 |
| `/memory [条数]` | 查看与当前私聊最相关的长期事实 |
| `/context` | 场景、长期事实与人物变化 |
| `/context_public` | 访客和频道回合拿到的公开版场景、剧情弧、continuity 与人物变化 |
| `/compact` | 立即整理已发生的剧本 |
| `/setup <JSON>` | 修改当前故事设定 |
| `/script [条数]` | 查看原始剧本条目 |
| `/script_note <正文>` | 写入管理员注记 |
| `/memory_facts [条数]` | 查看长期事实及编号 |
| `/memory_add <scope> <正文>` | 添加事实；scope 为 character/world/relationship/event/promise |
| `/memory_search <词>` | 全文搜索事实和剧本条目 |
| `/memory_public <编号>` | 把记录设为公开（访客和频道可见） |
| `/memory_private <编号>` | 把记录设为私密（只有主人回合可见） |
| `/memory_forget <编号>` | 事实标为失效；剧本条目替换为占位符（需确认） |
| `/memory_consolidate` | 立即执行一次每晚记忆整理（需确认） |
| `/memory_visitors` | 最近的访客（其他私聊、群聊） |
| `/memory_visitor <标识>` | 某个访客的记录；标识形如 `tg:123`、`tg-group:-100123` |
| `/exec [编号]` | 查看最近的命令审批；带编号时显示命令全文和输出 |
| `/memory_intents [条数]` | 查看待执行计划 |
| `/memory_cancel <编号>` | 取消计划或延迟消息 |
| `/memory_patches [条数]` | 查看设定变化提案 |
| `/memory_reject <编号>` | 拒绝尚未应用的提案 |
| `/overlay_status` | 查看人物变化及摘要 |
| `/overlay_compact` | 只压缩设定变化 |
| `/overlay_clear <target>` | 清理变化；target 取 character/world/relationship/all |
| `/purge_range <起始ISO时间> <结束ISO时间>` | 删除时间范围内的数据 |
| `/purge_all` | 清理历史并按当前配置重建初始设定 |
| `/database_clear` | 清空本地叙事数据 |

**记录编号**：`f12` 是事实（纯数字 `12` 或 `#12` 也按事实处理），`e34` 是剧本条目。列表中的标记：🔒 私密、🌐 公开、👤 某个访客。访客记录的受众由程序固定，不能用 public/private 修改。

方括号表示可选参数，不需要把括号发给 Bot。涉及大范围删除的命令会要求 60 秒内回复 `y` 或 `n`；这是运行中的数据操作确认。
