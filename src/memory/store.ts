import type { MemoryConfig } from '../config'
import type { FtsIndex } from '../database'
import { factScore } from '../memory-helpers'
import type { AUDIENCE_TABLES } from '../state'
import type { InterludeArc, InterludeScene, NarrativeFact, NarrativeMemory, ScriptEntry } from '../types'
import { audienceFilter, visibleTo, type Viewer } from './audience'
import { buildFtsQuery } from './fts'

export type AudienceTable = typeof AUDIENCE_TABLES[number]

/** Full access for owner turns, owner commands and background maintenance (roadmap §7). */
export const OWNER_VIEWER: Viewer = Object.freeze({ tier: 'owner' as const })

export interface MemoryStoreBackend {
  get(table: string, query: Record<string, unknown>, options?: Record<string, unknown>): Promise<any[]>
  ftsSearch(index: FtsIndex, match: string, limit: number): Promise<Array<{ id: number; rank: number }>>
}

/** Candidate pool taken from full-text search before audience filtering and scoring. */
const FTS_CANDIDATES = 100

const FTS_TABLES = { fact: 'interlude_fact', entry: 'interlude_script_entry' } as const satisfies Record<FtsIndex, AudienceTable>

/** Tables an owner command can address by a short reference such as f12 / e34 / m5. */
export const MEMORY_REF_TABLES = { fact: 'interlude_fact', entry: 'interlude_script_entry', memory: 'interlude_memory' } as const satisfies Record<string, AudienceTable>
export interface MemoryRef { kind: keyof typeof MEMORY_REF_TABLES; id: number }

/**
 * The single read path for memory tables (roadmap §4.5). Every read names its
 * viewer, and the audience filter runs in SQL before any limit, then again in
 * code before scoring or truncation. service.ts must not read memory tables
 * any other way.
 */
export class MemoryStore {
  constructor(private backend: MemoryStoreBackend, private memoryConfig: () => MemoryConfig) {}

  async rows<T = any>(viewer: Viewer, table: AudienceTable, query: Record<string, unknown> = {}, options: Record<string, unknown> = {}): Promise<T[]> {
    const filter = audienceFilter(viewer)
    // The filter is spread last so a caller-supplied audience condition cannot widen it.
    const rows = await this.backend.get(table, filter ? { ...query, audience: filter } : query, options)
    return rows.filter(row => visibleTo(row.audience, viewer))
  }

  async recentEntries(viewer: Viewer, storyId: string, limit: number): Promise<ScriptEntry[]> {
    const rows = await this.rows<ScriptEntry>(viewer, 'interlude_script_entry', { storyId }, {
      limit: Math.max(1, Math.min(limit, 200)), sort: { occurredAt: 'desc' },
    })
    return rows.reverse()
  }

  async memories(viewer: Viewer, storyId: string, limit: number, participantId?: string): Promise<NarrativeMemory[]> {
    const rows = await this.rows<NarrativeMemory>(viewer, 'interlude_memory', { storyId, status: 'active' }, {
      limit: Math.max(1, Math.min(limit * 4, 500)), sort: { importance: 'desc', updatedAt: 'desc' },
    })
    return rows
      .filter(memory => participantId === undefined || !memory.participantId || memory.participantId === participantId)
      .sort((a, b) => b.importance - a.importance || b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, limit)
  }

  /** Visible facts ranked by quality, recency and (when the query is long enough) bm25 relevance. */
  async facts(viewer: Viewer, storyId: string, limit: number, query = '', participantId?: string): Promise<NarrativeFact[]> {
    const config = this.memoryConfig()
    const base = { storyId, status: 'active' }
    // Keep enough candidates for re-ranking without scanning the whole table on the live path.
    const candidateLimit = Math.max(20, Math.min(limit * 5, config.maxFactsPerStory, 300))
    const rows = await this.rows<NarrativeFact>(viewer, 'interlude_fact', base, {
      limit: candidateLimit, sort: { importance: 'desc', updatedAt: 'desc' },
    })
    const match = query ? buildFtsQuery(query) : undefined
    const relevance = new Map<number, number>()
    if (match) {
      const hits = await this.backend.ftsSearch('fact', match, FTS_CANDIDATES)
      const best = Math.min(0, ...hits.map(hit => hit.rank))
      for (const hit of hits) relevance.set(hit.id, best < 0 ? hit.rank / best : 1)
      const known = new Set(rows.map(row => row.id))
      const extra = hits.map(hit => hit.id).filter(id => !known.has(id))
      // Hits are unfiltered ids; re-reading them through rows() applies story, status and audience.
      if (extra.length) rows.push(...await this.rows<NarrativeFact>(viewer, 'interlude_fact', { ...base, id: { $in: extra } }))
    }
    return rows
      .filter(fact => participantId === undefined || !fact.participantId || fact.participantId === participantId)
      .map(fact => ({ fact, score: factScore(fact, config, query, match ? relevance.get(fact.id) ?? 0 : undefined) }))
      .sort((a, b) => b.score - a.score
        || b.fact.updatedAt.getTime() - a.fact.updatedAt.getTime()
        || b.fact.id - a.fact.id)
      .slice(0, limit)
      .map(item => item.fact)
  }

  /**
   * Plain lookup for /interlude.memory.search: bm25 order when the text is long
   * enough for trigram search, otherwise a substring scan of recent rows.
   */
  async search<T = any>(viewer: Viewer, index: FtsIndex, storyId: string, text: string, limit: number, query: Record<string, unknown> = {}): Promise<T[]> {
    const table = FTS_TABLES[index]
    const match = buildFtsQuery(text)
    if (!match) {
      const needle = text.trim().toLowerCase()
      if (!needle) return []
      const recent = await this.rows(viewer, table, { ...query, storyId }, { limit: 1000, sort: { id: 'desc' } })
      return recent.filter(row => String(row.content ?? '').toLowerCase().includes(needle)).slice(0, limit)
    }
    const hits = await this.backend.ftsSearch(index, match, FTS_CANDIDATES)
    if (!hits.length) return []
    const order = new Map(hits.map((hit, position) => [hit.id, position]))
    const rows = await this.rows(viewer, table, { ...query, storyId, id: { $in: [...order.keys()] } })
    return rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!).slice(0, limit)
  }

  async activeScene(viewer: Viewer, storyId: string): Promise<InterludeScene | null> {
    return (await this.rows<InterludeScene>(viewer, 'interlude_scene', { storyId, status: 'active' }, { limit: 1, sort: { updatedAt: 'desc' } }))[0] ?? null
  }

  async activeArc(viewer: Viewer, storyId: string): Promise<InterludeArc | null> {
    return (await this.rows<InterludeArc>(viewer, 'interlude_arc', { storyId, status: 'active' }, { limit: 1, sort: { updatedAt: 'desc' } }))[0] ?? null
  }
}
