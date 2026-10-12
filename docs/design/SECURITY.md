# 数据与凭据边界

`TELEGRAM_BOT_TOKEN`、`TELEGRAM_CHAT_IDS`、`ALICE_OWNER_CHAT_ID` 和 `ANTHROPIC_API_KEY` 只从环境读取。真实 `.env`、`config.json`、SQLite 数据和依赖目录均不进入版本控制。

Telegram 接收先检查实际 chat id，再下载图片、创建故事或调用模型。私聊和群聊的访问范围均由环境白名单限定，输出同样检查目标白名单。群配置或用户资料不能扩大访问范围。

Anthropic 接收当前叙事需要的角色设定、连续性记录和消息；启用视觉时还会接收当前图片。其它私聊的详细资料默认不注入当前私聊，群触发不读取私聊历史。后台主动联系会读取受控关系摘要。

本机 SQLite 存储剧本与记忆等文本，不保存原始语音、图片字节或下载链接。标准日志默认不打印正文；模型传输错误只包含服务和状态码，不展开请求头或私密提示词。

网页观察默认关闭；启用后通过本机 Chrome 只读访问公开网页，使用域名、时限和内容预算约束。内网地址（包括私有网段、100.64.0.0/10、`.local` 等内网域名和单段主机名）一律拒绝；访问前还会检查域名实际解析到的 IP。Chrome 会自行再次解析域名，因此这项检查能缩小但不能完全消除 DNS 重绑定风险。网页文本是参考材料，不能成为更改规则或访问凭据的指令。

## 信任等级与工具

每条消息的信任等级（`owner` / `public`）只在 `src/router/router.ts` 中赋值，判定规则只有 `src/router/tiers.ts` 的 `resolveTier` 一处：渠道必须是 Telegram 私聊，且 chat id 等于 `ALICE_OWNER_CHAT_ID`。适配器产出的事件在类型上不含等级，消息文本不参与判定；网站等其他渠道无论内容如何都是 `public`。`ALICE_OWNER_CHAT_ID` 缺失、不是正整数或不在白名单中时拒绝启动。

管理命令只在 owner 私聊中执行：入口处先拦截（非 owner 不回复），命令内部再检查一次。

工具注册表（`src/capabilities/registry.ts`）有两道检查：构造请求时只暴露当前等级允许的工具；执行前按 `TIER_TOOLS` 能力表再次检查等级，未注册或等级不允许的工具返回错误结果且不执行。能力表为 owner：`exec`、`read_skill`、`recall`、`web_fetch`；public：`web_fetch`；system：无。目前尚未注册任何工具。

删除数据的管理命令保留运行时确认步骤。项目没有安装系统服务或修改全局配置。
