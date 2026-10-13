import { DatabaseSync, SQLInputValue } from 'node:sqlite'

const TABLES: Record<string, boolean> = {
  interlude_story: false, interlude_participant: false,
  interlude_script_entry: true, interlude_memory: true, interlude_intent: true,
  interlude_scene: true, interlude_arc: true, interlude_fact: true,
  interlude_state_patch: true, interlude_overlay_snapshot: true, interlude_web_observation: true,
  interlude_approval: true,
}

type Row = Record<string, any>

/** Full-text indexes kept in sync with a JSON table's content field by triggers (roadmap §4.5). */
const FTS_INDEXES = { fact: 'interlude_fact', entry: 'interlude_script_entry' } as const
export type FtsIndex = keyof typeof FTS_INDEXES
interface QueryOptions { limit?: number; offset?: number; sort?: Record<string, 'asc' | 'desc'> }

/** Native SQLite storage; each record preserves the existing narrative data shape. */
export class Storage {
  private db: DatabaseSync
  constructor(path: string) {
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;')
    for (const [table, autoId] of Object.entries(TABLES)) {
      this.db.exec(`CREATE TABLE IF NOT EXISTS ${table} (id ${autoId ? 'INTEGER PRIMARY KEY AUTOINCREMENT' : 'TEXT PRIMARY KEY'}, data TEXT NOT NULL CHECK(json_valid(data)))`)
      for (const field of ['storyId', 'participantId', 'status', 'audience']) {
        this.db.exec(`CREATE INDEX IF NOT EXISTS ${table}_${field} ON ${table}(json_extract(data, '$.${field}'))`)
      }
    }
    this.db.exec('CREATE TABLE IF NOT EXISTS runtime_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    for (const [index, table] of Object.entries(FTS_INDEXES)) {
      const fts = `${index}_fts`, content = "json_extract(new.data, '$.content')"
      this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS ${fts} USING fts5(content, tokenize='trigram')`)
      this.db.exec(`CREATE TRIGGER IF NOT EXISTS ${index}_fts_ai AFTER INSERT ON ${table} BEGIN
        INSERT INTO ${fts}(rowid, content) VALUES (new.id, ${content}); END`)
      this.db.exec(`CREATE TRIGGER IF NOT EXISTS ${index}_fts_au AFTER UPDATE ON ${table} BEGIN
        UPDATE ${fts} SET content = ${content} WHERE rowid = new.id; END`)
      this.db.exec(`CREATE TRIGGER IF NOT EXISTS ${index}_fts_ad AFTER DELETE ON ${table} BEGIN
        DELETE FROM ${fts} WHERE rowid = old.id; END`)
    }
  }

  private table(name: string) {
    if (!Object.hasOwn(TABLES, name)) throw new Error('Unknown narrative table.')
    return name
  }

  private field(name: string) {
    if (!/^[a-zA-Z]\w*$/.test(name)) throw new Error('Invalid storage field.')
    return name === 'id' ? 'id' : `json_extract(data, '$.${name}')`
  }

  private where(query: unknown) {
    const clauses: string[] = [], values: SQLInputValue[] = []
    const add = (expression: string, value: unknown) => {
      clauses.push(expression)
      values.push(value instanceof Date ? value.toISOString() : typeof value === 'boolean' ? Number(value) : value as SQLInputValue)
    }
    for (const [key, value] of Object.entries((query ?? {}) as Row)) {
      const field = this.field(key)
      if (value && typeof value === 'object' && !(value instanceof Date)) {
        for (const [operator, operand] of Object.entries(value)) {
          if (operator === '$in' && Array.isArray(operand)) {
            clauses.push(operand.length ? `${field} IN (${operand.map(() => '?').join(',')})` : '0')
            values.push(...operand as SQLInputValue[])
          } else if (operator === '$startsWith' && typeof operand === 'string') {
            add(`${field} LIKE ? ESCAPE '\\'`, `${operand.replace(/[\\%_]/g, '\\$&')}%`)
          } else {
            const op = ({ $gt: '>', $gte: '>=', $lte: '<=' } as Record<string, string>)[operator]
            if (!op) throw new Error('Unsupported storage query operator.')
            add(`${field} ${op} ?`, operand)
          }
        }
      } else if (value == null) clauses.push(`${field} IS NULL`)
      else add(`${field} = ?`, value)
    }
    return { sql: clauses.length ? clauses.join(' AND ') : '1', values }
  }

  async get(table: string, query: unknown = {}, options: unknown = {}): Promise<Row[]> {
    const filter = this.where(query), opts = (options ?? {}) as QueryOptions
    const sort = Object.entries(opts.sort ?? {}).map(([field, direction]) => `${this.field(field)} ${direction === 'desc' ? 'DESC' : 'ASC'}`)
    let sql = `SELECT data FROM ${this.table(table)} WHERE ${filter.sql}`
    if (sort.length) sql += ` ORDER BY ${sort.join(',')}`
    if (opts.limit != null) {
      sql += ' LIMIT ? OFFSET ?'
      filter.values.push(Math.max(0, Math.floor(opts.limit)), Math.max(0, Math.floor(opts.offset ?? 0)))
    }
    return this.db.prepare(sql).all(...filter.values).map(row => JSON.parse(row.data as string))
  }

  async create(table: string, data: unknown): Promise<Row> {
    const name = this.table(table), row = { ...(data as Row) }
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = this.db.prepare(`INSERT INTO ${name}(id, data) VALUES (?, ?)`).run(row.id ?? null, JSON.stringify(row))
      if (row.id == null) row.id = Number(result.lastInsertRowid)
      this.db.prepare(`UPDATE ${name} SET data = ? WHERE id = ?`).run(JSON.stringify(row), row.id)
      this.db.exec('COMMIT')
      return row
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }

  async set(table: string, query: unknown, patch: unknown) {
    const rows = await this.get(table, query), name = this.table(table)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const statement = this.db.prepare(`UPDATE ${name} SET data = ? WHERE id = ?`)
      for (const row of rows) statement.run(JSON.stringify({ ...row, ...(patch as Row), id: row.id }), row.id)
      this.db.exec('COMMIT')
      return { matched: rows.length }
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }

  async remove(table: string, query: unknown) {
    const filter = this.where(query)
    const result = this.db.prepare(`DELETE FROM ${this.table(table)} WHERE ${filter.sql}`).run(...filter.values)
    return { removed: Number(result.changes) }
  }

  /** Sets a JSON field on rows where it is missing; returns the number of rows changed. Used by one-time migrations. */
  backfillField(table: string, field: string, value: string) {
    const column = this.field(field)
    const result = this.db.prepare(`UPDATE ${this.table(table)} SET data = json_set(data, '$.${field}', ?) WHERE ${column} IS NULL`).run(value)
    return Number(result.changes)
  }

  /**
   * Row ids ranked by bm25 (lower rank is better). Results span every story
   * and audience: callers must re-read the rows through memory/store.ts,
   * which applies the audience filter.
   */
  ftsSearch(index: FtsIndex, match: string, limit: number): Array<{ id: number; rank: number }> {
    if (!Object.hasOwn(FTS_INDEXES, index)) throw new Error('Unknown full-text index.')
    return this.db.prepare(`SELECT rowid AS id, bm25(${index}_fts) AS rank FROM ${index}_fts WHERE ${index}_fts MATCH ? ORDER BY rank LIMIT ?`)
      .all(match, Math.max(1, Math.floor(limit))).map(row => ({ id: Number(row.id), rank: Number(row.rank) }))
  }

  /** Rebuilds a full-text index from its table; used by migrations for rows written before the triggers existed. */
  rebuildFts(index: FtsIndex) {
    const table = FTS_INDEXES[index]
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.exec(`DELETE FROM ${index}_fts`)
      this.db.exec(`INSERT INTO ${index}_fts(rowid, content) SELECT id, json_extract(data, '$.content') FROM ${table}`)
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }

  getMeta(key: string) { return this.db.prepare('SELECT value FROM runtime_meta WHERE key = ?').get(key)?.value as string | undefined }
  setMeta(key: string, value: string) { this.db.prepare('INSERT INTO runtime_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value) }
  close() { this.db.close() }
}
