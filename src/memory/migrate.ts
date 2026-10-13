import type { Storage } from '../database'
import { memoryCategoryScope } from '../memory-helpers'
import { AUDIENCE_TABLES } from '../state'
import { normalizeFact } from '../util'
import { normalizeAudience } from './audience'

const SCHEMA_VERSION_KEY = 'schema_version'

/**
 * One-time data migrations, gated by runtime_meta.schema_version.
 * Each step only fills missing data, so rerunning after a crash is harmless.
 */
export async function runMigrations(storage: Storage, log: (message: string) => void = message => console.info(message)) {
  const current = Number(storage.getMeta(SCHEMA_VERSION_KEY) ?? 0)
  if (!Number.isSafeInteger(current) || current < 0) throw new Error('runtime_meta.schema_version 无效，请检查数据库。')
  if (current < 1) {
    // v1: every pre-existing memory record becomes private (roadmap §4.4, fail-closed);
    // the owner can publish individual records later.
    let changed = 0
    for (const table of AUDIENCE_TABLES) changed += storage.backfillField(table, 'audience', 'private')
    storage.setMeta(SCHEMA_VERSION_KEY, '1')
    log(`数据迁移完成：schema_version=1，已有 ${changed} 条记忆记录标记为 private。`)
  }
  if (current < 2) {
    // v2: index rows written before the full-text triggers existed.
    storage.rebuildFts('fact')
    storage.rebuildFts('entry')
    storage.setMeta(SCHEMA_VERSION_KEY, '2')
    log('数据迁移完成：schema_version=2，已建立事实与剧本的全文索引。')
  }
  if (current < 3) {
    const moved = await mergeMemoriesIntoFacts(storage)
    storage.setMeta(SCHEMA_VERSION_KEY, '3')
    log(`数据迁移完成：schema_version=3，${moved} 条记忆已并入长期事实。`)
  }
}

/**
 * v3: interlude_memory overlapped interlude_fact (roadmap §4.4). Active
 * memories are copied into facts with their audience unchanged and the old
 * rows marked 'migrated'. A row that was copied but not yet marked before a
 * crash is matched by content on the rerun instead of being copied twice.
 */
async function mergeMemoriesIntoFacts(storage: Storage) {
  const memories = await storage.get('interlude_memory', { status: 'active' }, { sort: { id: 'asc' } })
  let moved = 0
  for (const memory of memories) {
    const audience = normalizeAudience(memory.audience)
    const participantId = typeof memory.participantId === 'string' ? memory.participantId : ''
    const content = String(memory.content ?? '').trim()
    const existing = content ? await storage.get('interlude_fact', { storyId: memory.storyId, status: 'active', audience, participantId }) : []
    if (content && !existing.some(fact => normalizeFact(String(fact.content ?? '')) === normalizeFact(content))) {
      const scope = memoryCategoryScope(memory.category)
      const updatedAt = memory.updatedAt ?? memory.createdAt ?? new Date().toISOString()
      await storage.create('interlude_fact', {
        storyId: memory.storyId, participantId, scope, content,
        importance: typeof memory.importance === 'number' ? memory.importance : 0.5, confidence: 0.5,
        unresolved: scope === 'promise', status: 'active',
        sourceEntryIds: typeof memory.sourceEntryId === 'number' ? [memory.sourceEntryId] : [],
        audience, lastSeenAt: updatedAt, createdAt: memory.createdAt ?? updatedAt, updatedAt,
      })
      moved++
    }
    await storage.set('interlude_memory', { id: memory.id }, { status: 'migrated' })
  }
  return moved
}
