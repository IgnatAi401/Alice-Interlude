import type { Storage } from '../database'
import { AUDIENCE_TABLES } from '../state'

const SCHEMA_VERSION_KEY = 'schema_version'

/**
 * One-time data migrations, gated by runtime_meta.schema_version.
 * Each step only fills missing data, so rerunning after a crash is harmless.
 */
export function runMigrations(storage: Storage, log: (message: string) => void = message => console.info(message)) {
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
}
