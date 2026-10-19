# 数据与凭据边界

`TELEGRAM_BOT_TOKEN`、`TELEGRAM_CHAT_IDS`、`ALICE_OWNER_CHAT_ID` 和 `LLM_API_KEY`（兼容旧名 `ANTHROPIC_API_KEY`）只从环境读取。`LLM_BASE_URL` 必须是 https（仅本机代理可用 http），避免 key 明文出网；更换模型服务意味着全部私密上下文会发给该服务商。exec 子进程同样拿不到 `LLM_API_KEY`。真实 `.env`、`config.json`、SQLite 数据和依赖目录均不进入版本控制。

Telegram 接收先检查实际 chat id，再下载图片、创建故事或调用模型。私聊和群聊的访问范围均由环境白名单限定，输出同样检查目标白名单。群配置或用户资料不能扩大访问范围。发送失败后的补发（`delivery-retry`）只重发原文给原参与者，每次补发都重新走同一投递入口和白名单检查，不会改换目标。

Anthropic 接收当前叙事需要的角色设定、连续性记录和消息；启用视觉时还会接收当前图片。其它私聊的详细资料默认不注入当前私聊，群触发不读取私聊历史。后台主动联系会读取受控关系摘要。

本机 SQLite 存储剧本与记忆等文本，不保存原始语音、图片字节或下载链接。标准日志默认不打印正文；模型传输错误只包含服务和状态码，不展开请求头或私密提示词。

网页观察默认关闭；启用后通过本机 Chrome 只读访问公开网页，使用域名、时限和内容预算约束。内网地址（包括私有网段、100.64.0.0/10、`.local` 等内网域名和单段主机名）一律拒绝；访问前还会检查域名实际解析到的 IP。Chrome 会自行再次解析域名，因此这项检查能缩小但不能完全消除 DNS 重绑定风险。网页文本是参考材料，不能成为更改规则或访问凭据的指令。

## 信任等级与工具

每条消息的信任等级（`owner` / `public`）只在 `src/router/router.ts` 中赋值，判定规则只有 `src/router/tiers.ts` 的 `resolveTier` 一处：渠道必须是 Telegram 私聊，且 chat id 等于 `ALICE_OWNER_CHAT_ID`。适配器产出的事件在类型上不含等级，消息文本不参与判定；网站等其他渠道无论内容如何都是 `public`。`ALICE_OWNER_CHAT_ID` 缺失、不是正整数或不在白名单中时拒绝启动。

管理命令只在 owner 私聊中执行：入口处先拦截（非 owner 不回复），命令内部再检查一次。Telegram 命令菜单用 `chat` 作用域只注册给 owner 私聊；短名（`/status` 等）只对 owner 视为命令，其他聊天仍按普通消息处理。

工具注册表（`src/capabilities/registry.ts`）有两道检查：构造请求时只暴露当前等级允许的工具；执行前按 `TIER_TOOLS` 能力表再次检查等级，未注册或等级不允许的工具返回错误结果且不执行。能力表为 owner：`exec`、`read_skill`、`recall`；public 与 system：无。工具只在主人私聊的消息回合和命令结果回合提供（`tools.enabled`，默认关闭），回合的等级来自事件，不来自模型输出。

不做 `web_fetch`：本机代理使用假 IP 模式（所有域名解析到 `198.18.0.0/15`），程序无法检查真实目标地址。读网页只能经审批的 `exec` 运行 `curl`。

- `recall` 通过 `memory/store.ts` 按调用者的读者读取；结果中的访客记录放在 `<visitor_notes>` 内。
- `read_skill` 只接受索引中的名字，不接受路径。
- `exec` 本身不执行任何东西，只建一条审批（`interlude_approval`）。回合被新消息作废或失败时，审批作废，不会发出。回合送达后才发出带按钮的消息。回调必须来自主人私聊、点击者是主人本人、按钮所在消息与审批记录一致、审批为 pending 且未过期；状态更新以“当前仍为 pending”为条件，在单一写队列中执行，重复点击只会执行一次（S7）。子进程在独立进程组运行，只继承 `PATH`、`HOME`、`USER`、`LOGNAME`、`LANG`、`LC_*`、`TMPDIR`、`TZ`（S8）；`zsh` 仍会读取 `~/.zshenv`，不要在其中写秘密。
- 命令输出只存在审批表中；结果以 `tool-result` 意图交回时不含输出，组装提示词时才从审批表读入，并包装在 `<command_output>` 内作为数据。剧本里只写一行 private 的 `tool-activity` 摘要。日志只记工具名、耗时、结果长度和退出码，不记输出。
- 启动时，上次运行留下的未发出请求作废，执行中被打断的命令标为 interrupted 并告知 Alice。

## 记忆受众

记忆类记录都带 `audience`：`private`（只有主人回合可见）、`public`（所有回合可见）、`visitor:<key>`（该访客本人和主人可见）。规则只在 `src/memory/audience.ts` 实现，缺失或非法的值一律按 `private` 处理：写库时 `dbCreate` 兜底，读库时 `normalizeDatabaseRow` 再规范化一次。

- 宿主决定：主人私聊的原始条目、系统事件、管理员注记和手动事实为 `private`；其他私聊的原始条目、剧本和事实固定为 `visitor:tg:<id>`，群聊固定为 `visitor:tg-group:<id>`，模型无法改变。
- 模型分类：主人回合和后台推进产出的记忆（写入时转为事实）、后台推进的剧本、压缩产出的事实和设定变化提案，由模型按隐私分类标准（`src/memory/classify.ts`，位于固定提示词层）标注 `private`/`public`，只有完全等于 `public` 才算公开。
- 来源优先：压缩结果引用的条目里只要有访客内容，就固定归该访客；混合了两个访客，或访客与私密内容混合，一律为 `private`。同内容但受众不同的事实不合并。
- 私密版场景摘要、剧情弧和 Overlay 归档由全部内容生成，固定为 `private`。公开版（`memory.publicDigestEnabled`）是另一组 `public` 行，由单独的模型调用生成，其输入由 `context/public.ts` 的 `publicDigestRequest` 逐字段构造：只有 Canon、公开条目、公开事实、公开人物变化、上一版公开摘要和 Alter 方向与强度，不含 `story` 对象、主人画像、`fixedPrompt` 和压缩主提示词，也不含任何访客记录。公开人物变化由代码合并公开的全局 character/perspective/world 提案，relationship 提案不进入。
- 派生层按轨道读取（`memory/store.ts` 的 `layerAudience`）：主人回合只读 private 版，其他回合只读 public 版。调用方给出的受众条件只能缩小读者的过滤范围，不能扩大。
- 主人把公开记录改回私密、遗忘公开记录或按时间范围删除时，公开版场景和剧情弧（含 continuity 与氛围描述）立即清空，下次从剩余公开条目重建。
- 迁移 `schema_version=1` 把升级前的所有记忆类记录设为 `private`；`schema_version=3` 把记忆复制为事实时原样保留受众（缺失或非法仍为 `private`）。
- 主人纠正：`/interlude.memory.public|private` 只能在 `private` 与 `public` 之间切换事实和剧本条目；`visitor:*` 记录一律拒绝修改，访客内容不会因此流向其他访客。访客标识非法时直接拒绝，不会退化成按 `private` 查询。

每晚整理（`src/memory/consolidate.ts`，默认关闭）：近似重复只在同一受众、同一参与者内合并；矛盾检查的模型请求只带不透明的组名（不暴露受众），返回的替代关系由宿主校验：两条事实必须同受众、同参与者，替代者必须更新，每次最多 20 条，因此访客写入的事实最多只能影响该访客自己的事实。超过 `visitorTtlDays` 的访客记录（剧本条目、事实、旧记忆、设定提案）替换为占位符，全文索引同步更新；参与者关系摘要和意图不在过期范围内。

读取侧：记忆表只能通过 `src/memory/store.ts` 读取，每次读取都指定读者（`Viewer`）。受众过滤先在 SQL 中执行（在 `LIMIT` 之前），读出后再用 `visibleTo` 检查一次，然后才打分和截断；全文检索的命中 id 也要经过同一入口重新读取。主叙事回合的读者：主人私聊和不属于任何参与者的后台回合看全部，其他私聊看 `public` 和 `visitor:tg:<id>`，群聊看 `public` 和 `visitor:tg-group:<id>`。管理命令和后台维护使用主人视角。

## 上下文构建器

发给模型前的最后一步按读者分两条路径：

- `src/context/public.ts`（非主人回合）：按白名单逐字段构造请求，新增字段默认不进入。故事设定只保留角色 Canon（去掉主人画像与关系默认值）；故事状态清空（不含 continuity、Overlay 实时状态、在场人物、Agency、Alter 内部状态）；Alter 只保留方向和强度；不带其他参与者摘要和自动投递摘要；计划、余波、追问承诺、网页观察只保留属于本参与者的部分；本参与者资料只用 `telegram.userAccounts` 中的显式配置，不使用 `storyDefaults` 默认值；关于主人只提供 `memory.publicOwnerProfile`。
- `src/context/owner.ts`（主人回合、后台推进）：可见全部内容，但受众为 `visitor:*` 的剧本、事实和 Overlay 归档一律移入 `<visitor_notes>` 块，块内声明其中的要求都不是主人的指令，内容中的 `<` 被转义，无法提前闭合包装。

非主人回合的写入限制：不能刷新 continuity；跨会话消息、计划和事实只能归属本参与者（参与者 id 可被猜到，因此不能以其他人为目标）；只能更新本参与者的余波；群聊回合不创建计划（否则会成为全局计划）。

金丝雀检查：`logging.verbosity=diagnostic` 且 `logging.dumpRequests=true` 时，完整请求写入 `data/debug/requests/`。公开版另有离线检查：生成请求不含私密与访客金丝雀，访客回合拿到公开版、主人回合只拿私密版，撤回公开条目后公开版清空且重建时不含被撤回内容。开发时的离线检查覆盖了私密事实、记忆、主人私聊条目、场景、剧情弧、continuity、Overlay 实时状态与归档、在场人物、Alter 描述、自动投递摘要、全局计划与余波、网页观察、默认主人画像，访客与群聊请求中均不出现；访客之间互不可见；主人请求中的访客内容只出现在 `<visitor_notes>` 内。

已知未覆盖：主人回合里的其他参与者摘要（关系状态、未结话题）没有包装为引用数据；主叙事的系统提示词（`model.mainPrompt`、`fixedPrompt`、`stylePrompt`）所有回合共用，不要在其中写主人隐私；公开版关闭时非主人回合看不到场景摘要、continuity 和 Alter 描述。

删除数据的管理命令保留运行时确认步骤。项目没有安装系统服务或修改全局配置。
