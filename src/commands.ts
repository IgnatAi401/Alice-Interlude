import { normalizeAudience } from './memory/audience'
import type { MemoryRef } from './memory/store'
import { Runtime, MessageSession as Session } from './runtime'
import { InterludeService } from './service'
import { StorySetting } from './types'

function missingSession(): never { throw new Error('管理命令只能在 Telegram 聊天中执行。') }

export function registerCommands(ctx: Runtime, service: InterludeService) {
  ctx.command('interlude', 'HDS Interlude：私聊故事测试与管理命令')

  const startStoryFromConfig = async (session: Session) => {
    if (!requireManager(service, session)) return '无权限：手动启动共享主剧本只允许主人私聊。'
    const readiness = await service.storyStartReadiness(session)
    if (readiness.existing) return `当前已有 ${readiness.existing.setting.character.name} 的活动主剧本；请使用 interlude.status 查看状态。`
    if (!readiness.ready) return formatStoryStartReadiness(readiness, 'config.json 档案尚未适合启动')
    const preview = readiness.preview
    const message = [
      '即将从当前 config.json 档案启动故事：',
      `主角：${preview.characterName}`,
      `角色设定：${preview.characterProfile ? '已填写' : '未填写'}`,
      `Perspective：${preview.perspective ? '已填写' : '未填写'}`,
      `世界与地点：${preview.world ? '已填写' : '未填写'}`,
      `时区：${preview.timezone}`,
      `主模型：${preview.model}`,
      `自动创建：${preview.autoCreate ? '开启（首次私聊通常无需手动启动）' : '关闭'}`,
      ...readiness.warnings.map(warning => `提示：${warning}`),
    ].filter(Boolean).join('\n')
    if (!await askConfirmation(session, `${message}\n确认从此档案启动吗？(y/n)`)) return '操作已取消。'
    const story = await service.createStory(session)
    const participant = await service.findParticipant(session, story)
    return `已从 config.json 档案启动 ${story.setting.character.name} 的共享主剧本，并加入 ${participant?.displayName || session.userId}。`
  }

  ctx.command('interlude.doctor', '检查当前 config.json 档案、权限与模型是否适合启动故事')
    .action(async ({ session = missingSession() }) => formatStoryStartReadiness(await service.storyStartReadiness(session)))

  ctx.command('interlude.story.start', '管理员：从当前 config.json 档案手动启动第一份运行中故事')
    .action(async ({ session = missingSession() }) => startStoryFromConfig(session))


  ctx.command('interlude.setup <json:text>', '高级：用 JSON 单独修改当前故事设定；普通测试请优先在 config.json 填 storyDefaults')
    .action(async ({ session = missingSession() }, json) => {
      if (!requireManager(service, session)) return '当前 Telegram 聊天没有管理权限：管理命令只允许 ALICE_OWNER_CHAT_ID 对应的主人私聊。'
      const story = await requireStory(service, session)
      if (typeof story === 'string') return story
      try {
        const patch = JSON.parse(json) as Partial<StorySetting>
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('设定必须是 JSON 对象。普通测试无需使用此命令。')
        const updated = await service.updateSetting(story, patch)
        return `已保存 ${updated.setting.character.name} 的当前故事设定。`
      } catch (error) {
        return `JSON 格式不正确：${(error as Error).message}`
      }
    })

  ctx.command('interlude.status', '查看当前故事是否启用、主角、游标和主动消息开关')
    .action(async ({ session = missingSession() }) => {
      const story = await requireStory(service, session)
      if (typeof story === 'string') return story
      return [
        `主角：${story.setting.character.name}`,
        `关系人数：${(await service.participants(story.id)).length}`,
        `故事状态：${story.status}`,
        `已写到：${story.cursorAt.toISOString()}`,
        `模型：Anthropic Messages / ${service.config.model.model}（thinking 关闭）`,
        `允许主动可见消息：${service.config.runtime.allowProactiveMessages ? '开启' : '关闭'}`,
        `Agency Window：${service.config.agency?.enabled === false ? '关闭' : '开启'}（${story.state.agencyWindow?.activityLoad || '尚未建立'}）`,
      ].join('\n')
    })

  ctx.command('interlude.pause', '暂停当前故事的自动处理，不删除任何记录')
    .action(async ({ session = missingSession() }) => changeStatus(service, session, 'paused'))

  ctx.command('interlude.resume', '恢复当前故事的自动处理')
    .action(async ({ session = missingSession() }) => changeStatus(service, session, 'active'))

  ctx.command('interlude.advance', '手动把故事补写到现在；用于测试自动生活推进')
    .action(async ({ session = missingSession() }) => {
      if (!requireManager(service, session)) return '当前 Telegram 聊天没有管理权限。'
      const story = await requireStory(service, session)
      if (typeof story === 'string') return story
      const messages = await service.advanceStory(story)
      await service.deliverMessages(story, messages, session)
      return messages.length ? '剧本已补写到现在，并已发送其中已经发生的可见角色消息。' : '剧本已补写到现在；这次没有发生可见角色消息。'
    })

  ctx.command('interlude.timeline [limit:number]', '查看最近剧本记录；limit 为条数，默认 10')
    .action(async ({ session = missingSession() }, limit = 10) => {
      const story = await requireStory(service, session)
      if (typeof story === 'string') return story
      const participant = await service.findParticipant(session, story)
      const entries = (await service.recentEntries(story.id, Math.max(1, Math.min(limit * 3, 90))))
        .filter(entry => !entry.participantId || entry.participantId === participant?.id)
        .slice(-Math.max(1, Math.min(limit, 30)))
      if (!entries.length) return '当前故事还没有剧本记录。'
      return entries.map(entry => `[${entry.occurredAt.toISOString()}] ${entry.actor}/${entry.kind}: ${entry.content}`).join('\n')
    })

  ctx.command('interlude.memory [limit:number]', '查看与当前私聊相关、检索优先级最高的长期事实；limit 为条数，默认 10')
    .action(async ({ session = missingSession() }, limit = 10) => {
      const story = await requireStory(service, session)
      if (typeof story === 'string') return story
      const participant = await service.findParticipant(session, story)
      const facts = await service.facts(story.id, Math.max(1, Math.min(limit, 30)), '', participant?.id)
      if (!facts.length) return '暂时还没有长期记忆；多进行一些对话并等待后台整理后再看。'
      return facts.map(fact => `f${fact.id} ${audienceMark(fact.audience)} [${fact.scope}/${fact.importance.toFixed(2)}] ${fact.content}`).join('\n')
    })

  ctx.command('interlude.context', '查看场景摘要、剧情弧线、人物变化覆写和长期事实')
    .action(async ({ session = missingSession() }) => {
      const story = await requireStory(service, session)
      if (typeof story === 'string') return story
      const participant = await service.findParticipant(session, story)
      const [scene, arc, facts] = await Promise.all([
        service.activeScene(story.id), service.activeArc(story.id), service.facts(story.id, 8, '', participant?.id),
      ])
      return [
        `场景引子：${scene?.hook || '尚未整理'}`,
        `场景摘要：${scene?.summary || '尚未整理'}`,
        `剧情弧线：${arc?.title || '开场'} — ${arc?.summary || '尚未整理'}`,
        `当前关系：${participant?.displayName || session.userId}（${participant?.relationship || '未填写'}）`,
        `当前关系状态：${JSON.stringify(participant?.state ?? {})}`,
        `主角个体价值观 / 看待世界的方式：${story.setting.perspective || '未填写'}（当前 overlay：${story.state.settingOverlay?.perspective || '未形成'}）`,
        `主角全局变化：${JSON.stringify(story.state.settingOverlay ?? {})}`,
        `主体行动窗口：${JSON.stringify(story.state.agencyWindow ?? null)}`,
        `长期事实：${facts.length ? facts.map(fact => `[${fact.scope}/${fact.importance.toFixed(2)}] ${fact.content}`).join(' | ') : '暂无'}`,
      ].join('\n')
    })

  ctx.command('interlude.context.public', '管理员：查看访客与频道回合拿到的公开版场景、剧情弧、continuity 和人物变化')
    .action(async ({ session = missingSession() }) => {
      if (!requireManager(service, session)) return '当前 Telegram 聊天没有管理权限。'
      const story = await requireStory(service, session)
      if (typeof story === 'string') return story
      const { enabled, scene, arc, overlay } = await service.adminPublicLayer(story.id)
      const continuity = arc?.continuity
      return [
        `公开版生成：${enabled ? '开启' : '关闭（memory.publicDigestEnabled）'}`,
        `场景引子：${scene?.hook || '尚未生成'}`,
        `场景摘要：${scene?.summary || '尚未生成'}`,
        `剧情弧线：${arc?.title || '无'} — ${arc?.summary || '尚未生成'}`,
        `continuity：${continuity ? [continuity.current, ...continuity.next, ...continuity.recent, ...continuity.salient].filter(Boolean).join(' / ') : '尚未生成'}`,
        `氛围描述：${arc?.mood ? `[${arc.mood.direction}] ${arc.mood.description}` : '无'}`,
        `人物变化（来自公开提案）：${JSON.stringify(overlay)}`,
      ].join('\n')
    })

  ctx.command('interlude.compact', '立即整理一次当前故事的旧剧本；用于测试记忆压缩')
    .action(async ({ session = missingSession() }) => {
      if (!requireManager(service, session)) return '当前 Telegram 聊天没有管理权限。'
      const story = await requireStory(service, session)
      if (typeof story === 'string') return story
      const compacted = await service.compactStory(story)
      return compacted ? '已完成一次连续性记忆整理。' : '当前还没有达到需要整理的剧本量。'
    })

  ctx.command('interlude.script [limit:number]', '管理员：查看当前主剧本的最近原始条目，默认 20 条')
    .action(async ({ session = missingSession() }, limit = 20) => {
      if (!requireManager(service, session)) return '当前 Telegram 聊天没有管理权限。'
      const story = await requireStory(service, session)
      if (typeof story === 'string') return story
      const entries = await service.recentEntries(story.id, Math.max(1, Math.min(limit, 50)))
      if (!entries.length) return '当前主剧本还没有原始条目。'
      return entries.map(entry => `e${entry.id} ${audienceMark(entry.audience)} [${entry.occurredAt.toISOString()}] ${entry.actor}/${entry.kind}${entry.participantId ? `/${entry.participantId}` : ''}\n${entry.content}`).join('\n\n')
    })

  ctx.command('interlude.script.note <content:text>', '管理员：向剧本写入一条人工注记，不伪装成模型输出')
    .action(async ({ session = missingSession() }, content) => {
      if (!requireManager(service, session)) return '当前 Telegram 聊天没有管理权限。'
      const story = await requireStory(service, session)
      if (typeof story === 'string') return story
      return await service.addAdminScriptNote(story, content) ? '已写入管理员注记，后续压缩会将其纳入连续性。' : '注记为空，未写入。'
    })

  ctx.command('interlude.memory.facts [limit:number]', '管理员：列出长期事实及其编号，默认 20 条')
    .action(async ({ session = missingSession() }, limit = 20) => {
      if (!requireManager(service, session)) return '当前 Telegram 聊天没有管理权限。'
      const story = await requireStory(service, session)
      if (typeof story === 'string') return story
      const facts = await service.adminFacts(story.id, limit)
      if (!facts.length) return '当前没有有效的长期事实。'
      return facts.map(fact => `f${fact.id} ${audienceMark(fact.audience)} [${fact.scope}] 重要度=${fact.importance.toFixed(2)} 置信度=${fact.confidence.toFixed(2)} 未解决=${fact.unresolved}\n${fact.content}`).join('\n\n')
    })

  ctx.command('interlude.memory.add <scope:string> <content:text>', '管理员：手动添加长期事实；scope 为 character/world/relationship/event/promise')
    .action(async ({ session = missingSession() }, scope, content) => {
      if (!requireManager(service, session)) return '当前 Telegram 聊天没有管理权限。'
      if (!isFactScope(scope)) return 'scope 必须是 character、world、relationship、event 或 promise。'
      const story = await requireStory(service, session)
      if (typeof story === 'string') return story
      return await service.addAdminFact(story, scope, content) ? '已添加高置信度长期事实。' : '事实内容为空，未添加。'
    })

  ctx.command('interlude.memory.forget <ref:string>', '管理员：删除一条记录；f12 事实标为失效，e34 剧本条目替换为占位符（会询问 y/n）')
    .action(async ({ session = missingSession() }, refText) => {
      if (!requireManager(service, session)) return '当前 Telegram 聊天没有管理权限。'
      const ref = parseMemoryRef(refText)
      if (!ref) return MEMORY_REF_HELP
      const story = await requireStory(service, session)
      if (typeof story === 'string') return story
      const label = formatMemoryRef(ref)
      if (ref.kind === 'entry') {
        const entry = await service.adminRecord(story.id, ref)
        if (!entry) return `未找到 ${label}。`
        if (!await askConfirmation(session, `即将把剧本条目 ${label} 替换为占位符，无法恢复：\n${clip(entry.content, 200)}\n确认执行吗？(y/n)`)) return '操作已取消。'
      }
      return await service.forgetAdminRecord(story.id, ref) ? `${label} 已删除${ref.kind === 'fact' ? '（保留为失效记录）' : ''}。` : `未找到有效的 ${label}。`
    })

  ctx.command('interlude.memory.search <query:text>', '管理员：全文搜索长期事实和剧本条目')
    .action(async ({ session = missingSession() }, query) => {
      if (!requireManager(service, session)) return '当前 Telegram 聊天没有管理权限。'
      if (!query?.trim()) return '请提供搜索词，例如 /interlude.memory.search 樱花'
      const story = await requireStory(service, session)
      if (typeof story === 'string') return story
      const { facts, entries } = await service.adminSearch(story.id, query)
      if (!facts.length && !entries.length) return '没有找到匹配的记录。'
      return [
        ...facts.map(fact => `f${fact.id} ${audienceMark(fact.audience)} [${fact.scope}] ${clip(fact.content, 200)}`),
        ...entries.map(entry => `e${entry.id} ${audienceMark(entry.audience)} [${entry.occurredAt.toISOString()}] ${entry.actor}/${entry.kind}: ${clip(entry.content, 200)}`),
      ].join('\n\n')
    })

  for (const audience of ['public', 'private'] as const) {
    const verb = audience === 'public' ? '公开（访客和频道可见）' : '设为私密（只有主人回合可见）'
    ctx.command(`interlude.memory.${audience} <ref:string>`, `管理员：把一条记录${verb}；f12 事实、e34 剧本条目`)
      .action(async ({ session = missingSession() }, refText) => {
        if (!requireManager(service, session)) return '当前 Telegram 聊天没有管理权限。'
        const ref = parseMemoryRef(refText)
        if (!ref) return MEMORY_REF_HELP
        const story = await requireStory(service, session)
        if (typeof story === 'string') return story
        const label = formatMemoryRef(ref)
        const result = await service.setAdminAudience(story.id, ref, audience)
        if (result === 'not-found') return `未找到有效的 ${label}。`
        if (result === 'visitor') return `${label} 属于访客，受众由程序固定，不能修改；如需删除请用 /interlude.memory.forget。`
        if (result === 'unchanged') return `${label} 已经是 ${audienceMark(audience)}。`
        const note = audience === 'public' && ref.kind === 'entry' ? '原文会出现在访客和频道回合的上下文中。' : ''
        return `${label} 已改为 ${audienceMark(audience)}。${note}`
      })
  }

  ctx.command('interlude.memory.visitors', '管理员：查看最近的访客（其他私聊和群聊）')
    .action(async ({ session = missingSession() }) => {
      if (!requireManager(service, session)) return '当前 Telegram 聊天没有管理权限。'
      const story = await requireStory(service, session)
      if (typeof story === 'string') return story
      const visitors = await service.adminVisitors(story.id)
      if (!visitors.length) return '最近的剧本中没有访客记录。'
      return visitors.map(visitor => [
        `👤${visitor.key}${visitor.displayName ? `（${visitor.displayName}）` : ''} 近期 ${visitor.count} 条，最后 ${visitor.last.occurredAt.toISOString()}`,
        `  ${visitor.last.actor}: ${clip(visitor.last.content, 120)}`,
      ].join('\n')).join('\n\n')
    })

  ctx.command('interlude.memory.visitor <key:string>', '管理员：查看某个访客的记录；key 形如 tg:123 或 tg-group:-100123')
    .action(async ({ session = missingSession() }, key) => {
      if (!requireManager(service, session)) return '当前 Telegram 聊天没有管理权限。'
      const story = await requireStory(service, session)
      if (typeof story === 'string') return story
      const records = key ? await service.adminVisitor(story.id, key) : undefined
      if (!records) return '访客标识无效，应形如 tg:123 或 tg-group:-100123（可用 /interlude.memory.visitors 查看）。'
      if (!records.entries.length && !records.facts.length) return `没有 ${records.audience} 的记录。`
      return [
        ...records.entries.map(entry => `e${entry.id} [${entry.occurredAt.toISOString()}] ${entry.actor}/${entry.kind}: ${clip(entry.content, 200)}`),
        ...(records.facts.length ? ['事实：', ...records.facts.map(fact => `f${fact.id} [${fact.scope}] ${clip(fact.content, 200)}`)] : []),
      ].join('\n')
    })

  ctx.command('interlude.memory.consolidate', '管理员：立即执行一次每晚记忆整理（合并重复事实、矛盾检查、删除过期访客记录）；执行前会询问 y/n')
    .action(async ({ session = missingSession() }) => {
      if (!requireManager(service, session)) return '当前 Telegram 聊天没有管理权限。'
      const story = await requireStory(service, session)
      if (typeof story === 'string') return story
      const ttl = service.config.memory?.visitorTtlDays ?? 30
      const expiry = ttl > 0 ? `超过 ${ttl} 天的访客记录会被替换为占位符，无法恢复` : '访客记录不会过期（visitorTtlDays=0）'
      if (!await askConfirmation(session, `即将整理长期事实：合并重复、让被新事实推翻的旧事实失效；${expiry}。确认执行吗？(y/n)`)) return '操作已取消。'
      const result = await service.consolidateStory(story)
      return `记忆整理完成：合并重复事实 ${result.merged} 条，矛盾失效 ${result.contradicted} 条，过期访客记录 ${result.expired} 条。`
    })

  ctx.command('interlude.memory.intents [limit:number]', '管理员：查看等待中的计划、提醒、承诺与剧情余波')
    .action(async ({ session = missingSession() }, limit = 20) => {
      if (!requireManager(service, session)) return '当前 Telegram 聊天没有管理权限。'
      const story = await requireStory(service, session)
      if (typeof story === 'string') return story
      const intents = await service.adminPendingIntents(story.id, limit)
      if (!intents.length) return '当前没有等待中的计划、提醒、承诺或剧情余波。'
      return intents.map(intent => {
        const active = intent.type === 'active-consequence' && intent.payload?.lifecycle === 'active'
        const timing = active
          ? `持续影响至=${String(intent.payload?.expiresAt || '未设置')}`
          : `最早执行=${intent.notBefore.toISOString()}`
        return `#${intent.id} [${intent.type}] 参与者=${intent.participantId || '全局'} ${timing}\n${intent.summary}`
      }).join('\n\n')
    })

  ctx.command('interlude.memory.cancel <id:number>', '管理员：取消指定的等待中意图或延迟消息')
    .action(async ({ session = missingSession() }, id) => {
      if (!requireManager(service, session)) return '当前 Telegram 聊天没有管理权限。'
      const story = await requireStory(service, session)
      if (typeof story === 'string') return story
      return await service.cancelAdminIntent(story.id, id) ? `意图 #${id} 已取消。` : `未找到等待中的意图 #${id}。`
    })

  ctx.command('interlude.memory.patches [limit:number]', '管理员：查看人物、关系和世界设定的演化提案')
    .action(async ({ session = missingSession() }, limit = 20) => {
      if (!requireManager(service, session)) return '当前 Telegram 聊天没有管理权限。'
      const story = await requireStory(service, session)
      if (typeof story === 'string') return story
      const patches = await service.adminStatePatches(story.id, limit)
      if (!patches.length) return '当前没有设定演化提案。'
      return patches.map(patch => `#${patch.id} [${patch.status}/${patch.target}/${patch.impact}] 置信度=${patch.confidence.toFixed(2)}\n提案：${patch.proposedValue}\n证据：${patch.evidence}`).join('\n\n')
    })

  ctx.command('interlude.memory.reject <id:number>', '管理员：拒绝一条尚未应用的设定演化提案')
    .action(async ({ session = missingSession() }, id) => {
      if (!requireManager(service, session)) return '当前 Telegram 聊天没有管理权限。'
      const story = await requireStory(service, session)
      if (typeof story === 'string') return story
      return await service.rejectAdminStatePatch(story.id, id) ? `设定演化提案 #${id} 已拒绝。` : `未找到待审核的设定演化提案 #${id}。`
    })

  ctx.command('interlude.overlay.clear <target:string>', '管理员：只清理指定部分的设定演化 overlay，不删除剧本和记忆；执行前会询问 y/n')
    .action(async ({ session = missingSession() }, target) => {
      if (!requireManager(service, session)) return '无权限：当前账号不是主人。'
      const normalized = String(target || '').trim().toLowerCase() as 'character' | 'perspective' | 'relationship' | 'world' | 'all'
      if (!['character', 'perspective', 'relationship', 'world', 'all'].includes(normalized)) return 'target 必须是 character、perspective、relationship、world 或 all。'
      if (!await askConfirmation(session, `即将清理 ${normalized} overlay；剧本和记忆不会删除。确认执行吗？(y/n)`)) return '操作已取消。'
      const story = await requireStory(service, session)
      if (typeof story === 'string') return story
      const result = await service.clearSettingOverlay(story, normalized)
      const participantNote = normalized === 'relationship' || normalized === 'all' ? `，已清理 ${result.participantCount} 个参与者关系 overlay` : ''
      return `已清理 ${normalized} overlay${participantNote}；剧本、长期事实和普通记忆均未删除。`
    })

  ctx.command('interlude.overlay.status', '管理员：查看当前 overlay、待积累提案和压缩归档状态')
    .action(async ({ session = missingSession() }) => {
      if (!requireManager(service, session)) return '无权限：当前账号不是主人。'
      const story = await requireStory(service, session)
      if (typeof story === 'string') return story
      const status = await service.adminOverlayStatus(story.id)
      const overlay = JSON.stringify(status.state)
      return [
        `当前全局 overlay：${overlay === '{}' ? '空' : overlay}`,
        `待积累提案：${status.proposed.length} 条（需要跨多个剧本回合和日期后才会应用）`,
        `已应用/已归档提案：${status.applied.length} 条`,
        `已清理提案：${status.cleared.length} 条`,
        `overlay 压缩快照：${status.snapshots.length} 条`,
        `参与者关系 overlay：${status.participantOverlays.length} 个`,
      ].join('\n')
    })

  ctx.command('interlude.overlay.compact', '管理员：只合并和压缩已应用的 overlay，不整理普通剧本记忆')
    .action(async ({ session = missingSession() }) => {
      if (!requireManager(service, session)) return '无权限：当前账号不是主人。'
      const story = await requireStory(service, session)
      if (typeof story === 'string') return story
      const changed = await service.compactOverlay(story)
      return changed ? 'overlay 合并和压缩完成。' : '没有需要合并或压缩的 overlay。'
    })

  ctx.command('interlude.database.clear', '管理员：清空本地叙事数据库；执行前会询问 y/n')
    .action(async ({ session = missingSession() }) => {
      if (!requireManager(service, session)) return '无权限：当前账号不是主人。'
      if (!await askConfirmation(session, '即将清空 HDSI 自有数据库，剧本、记忆和状态记录都会删除。确认执行吗？(y/n)')) return '操作已取消。'
      const result = await service.clearDatabase()
      return `HDSI 数据库清空完成：处理 ${result.removed} 条记录${result.logicallyCleared ? `，其中 ${result.logicallyCleared} 条因 SQLite 锁定改为逻辑清空` : ''}。`
    })

  ctx.command('interlude.purge.all', '管理员：彻底重置剧本、记忆与 Canon；执行前会询问 y/n')
    .action(async ({ session = missingSession() }) => {
      if (!requireManager(service, session)) return '当前 Telegram 聊天没有管理权限。'
      if (!await askConfirmation(session, '即将删除剧本、记忆、事实、意图和状态。确认执行吗？(y/n)')) return '操作已取消。'
      const story = await requireStory(service, session)
      if (typeof story === 'string') return story
      await service.purgeAllData(story.id)
      return '已彻底重置：旧剧本、场景摘要、剧情弧线、长期事实、记忆、意图、状态演化和参与者关系状态均已清除；当前故事保留为空白的全局主剧本，Canon 已按当前 config.json 配置重建。'
    })

  // text 参数读取剩余全文；两个时间参数分别使用 string。
  ctx.command('interlude.purge.range <from:string> <to:string>', '管理员：删除时间范围内的剧本和关联记忆；时间使用 ISO-8601；执行前会询问 y/n')
    .action(async ({ session = missingSession() }, fromText, toText) => {
      if (!requireManager(service, session)) return '当前 Telegram 聊天没有管理权限。'
      const from = new Date(String(fromText ?? '').trim())
      const to = new Date(String(toText ?? '').trim())
      if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to) return '时间范围无效，请使用 ISO-8601，例如 2026-08-01T00:00:00+08:00。'
      if (!await askConfirmation(session, `即将删除 ${from.toISOString()} 至 ${to.toISOString()} 范围内的剧本和关联记忆。确认执行吗？(y/n)`)) return '操作已取消。'
      const story = await requireStory(service, session)
      if (typeof story === 'string') return story
      await service.purgeStoryRange(story.id, from, to)
      return `已删除 ${from.toISOString()} 至 ${to.toISOString()} 范围内的剧本和关联记忆；Canon 与参与者身份未删除。`
    })
}

async function askConfirmation(session: Session, message: string) {
  await session.send(`${message}\n请在 60 秒内回复 y 或 n。`)
  const answer = await session.prompt(60_000)
  return /^(?:y|yes)$/i.test(String(answer ?? '').trim())
}

function formatStoryStartReadiness(readiness: import('./service').StoryStartReadiness, title = 'config.json 档案检查') {
  const preview = readiness.preview
  return [
    title,
    `主角：${preview.characterName || '未填写'}`,
    `角色设定：${preview.characterProfile ? '已填写' : '未填写'}`,
    `Perspective：${preview.perspective ? '已填写' : '未填写'}`,
    `世界：${preview.world ? '已填写' : '未填写'}`,
    `时区：${preview.timezone}`,
    `主模型：${preview.model}`,
    `自动创建：${preview.autoCreate ? '开启' : '关闭'}`,
    ...(readiness.existing ? [`运行中故事：${readiness.existing.setting.character.name}（${readiness.existing.status}）`] : ['运行中故事：尚未创建']),
    ...readiness.blockers.map(item => `阻断：${item}`),
    ...readiness.warnings.map(item => `提示：${item}`),
    readiness.existing
      ? '结果：已有运行中故事，无需再次启动。'
      : readiness.ready ? '结果：可以启动。' : '结果：请先完成阻断项。',
  ].join('\n')
}

async function requireStory(service: InterludeService, session: Session) {
  if (!service.canHandleSession(session)) return '当前 Telegram 聊天未获授权。请检查环境变量 TELEGRAM_CHAT_IDS。'
  return await service.findStory(session) ?? '当前私聊还没有故事。请先在 config.json 完成档案，然后执行 interlude.doctor；手动启动请使用 interlude.story.start，或开启 runtime.autoCreate 后直接发送第一条私聊。'
}

async function changeStatus(service: InterludeService, session: Session, status: 'active' | 'paused') {
  if (!requireManager(service, session)) return '当前 Telegram 聊天没有管理权限。'
  const story = await requireStory(service, session)
  if (typeof story === 'string') return story
  await service.setStatus(story, status)
  return status === 'active' ? '故事已恢复自动处理。' : '故事已暂停自动处理；已有记录不会删除。'
}

function requireManager(service: InterludeService, session: Session) { return service.canManageSession(session) }

const MEMORY_REF_HELP = '编号格式：f12（事实，纯数字或 #12 也算事实）、e34（剧本条目）。'
const MEMORY_REF_KINDS = { f: 'fact', e: 'entry' } as const

function parseMemoryRef(text: unknown): MemoryRef | undefined {
  const match = /^(?:#|([fe]))?(\d{1,15})$/i.exec(String(text ?? '').trim())
  if (!match) return undefined
  const kind = MEMORY_REF_KINDS[(match[1]?.toLowerCase() ?? 'f') as keyof typeof MEMORY_REF_KINDS]
  return { kind, id: Number(match[2]) }
}

function formatMemoryRef(ref: MemoryRef) {
  return `${({ fact: '事实', entry: '剧本条目' })[ref.kind]} ${ref.kind[0]}${ref.id}`
}

/** 🔒 private, 🌐 public, 👤<key> one visitor (roadmap §4.9). */
function audienceMark(value: unknown) {
  const audience = normalizeAudience(value)
  return audience === 'public' ? '🌐' : audience === 'private' ? '🔒' : `👤${audience.slice('visitor:'.length)}`
}

function clip(text: string, max: number) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

function isFactScope(value: string): value is 'character' | 'world' | 'relationship' | 'event' | 'promise' {
  return ['character', 'world', 'relationship', 'event', 'promise'].includes(value)
}

