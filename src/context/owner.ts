import { normalizeAudience } from '../memory/audience'
import { OWNER_VIEWER, type MemoryStore } from '../memory/store'
import type { NarrativeRequest, ScriptEntry, VisitorNote } from '../types'
import { Time } from '../runtime'

export interface OwnerContextOptions {
  /**
   * Participant-free background turns drop visitor records instead of quoting
   * them: their prose and facts may be classified public, and a visitor's
   * words must not reach other visitors that way (S5).
   */
  keepVisitorRecords: boolean
  /** Recent visitor lines from readVisitorDigest (owner chat turns only). */
  digest?: VisitorNote[]
}

/**
 * Request for an owner-tier turn (owner chat, background life). The owner
 * sees everything, but records that belong to visitors are moved out of the
 * ordinary history and facts into visitorNotes, which the narrator wraps as
 * quoted reference material (roadmap §4.7, S10). Visitor text therefore never
 * reads like the owner's own words or instructions.
 */
export function ownerNarrativeRequest(draft: NarrativeRequest, options: OwnerContextOptions): NarrativeRequest {
  const notes: VisitorNote[] = []
  const split = <T extends { audience: unknown }>(items: T[], toNote: (item: T, audience: string) => VisitorNote) => items.filter(item => {
    const audience = normalizeAudience(item.audience)
    if (!audience.startsWith('visitor:')) return true
    if (options.keepVisitorRecords) notes.push(toNote(item, promptAudience(audience)))
    return false
  })
  const recentEntries = split(draft.recentEntries, (entry, audience) => ({
    audience, source: 'script', kind: entry.kind, content: entry.content, occurredAt: entry.occurredAt.toISOString(),
  }))
  const facts = split(draft.facts ?? [], (fact, audience) => ({
    audience, source: 'fact', kind: fact.scope, content: fact.content, occurredAt: fact.updatedAt.toISOString(),
  }))
  const overlaySnapshots = split(draft.overlaySnapshots ?? [], (snapshot, audience) => ({
    audience, source: 'overlay', kind: snapshot.target, content: snapshot.summary, occurredAt: snapshot.periodEnd.toISOString(),
  }))
  if (options.keepVisitorRecords) {
    const seen = new Set(notes.map(noteKey))
    for (const note of options.digest ?? []) if (!seen.has(noteKey(note))) notes.push(note)
  }
  return { ...draft, recentEntries, facts, overlaySnapshots, visitorNotes: notes }
}

export interface VisitorDigestOptions {
  /** How many visitors, most recently active first. */
  visitors: number
  days: number
  now: Date
  /** participantKey → display name, for a readable header per visitor. */
  names: Map<string, string>
}

const DIGEST_KINDS = ['user-message', 'character-message', 'group-message', 'character-group-message']
const DIGEST_LINES_PER_VISITOR = 4
const DIGEST_LINE_CHARACTERS = 240

/**
 * "最近的访客：…" for owner chat turns (roadmap §4.7). Owner turns otherwise
 * see only their own chat, so without this the owner could not ask Alice
 * about visitors. Reads through MemoryStore like every other memory read.
 */
export async function readVisitorDigest(store: MemoryStore, storyId: string, options: VisitorDigestOptions): Promise<VisitorNote[]> {
  if (options.visitors <= 0) return []
  const since = new Date(options.now.getTime() - Math.max(1, options.days) * Time.day)
  const rows = await store.rows<ScriptEntry>(OWNER_VIEWER, 'interlude_script_entry', {
    storyId, audience: { $startsWith: 'visitor:' }, kind: { $in: DIGEST_KINDS }, occurredAt: { $gte: since },
  }, { limit: 400, sort: { occurredAt: 'desc' } })
  const byVisitor = new Map<string, ScriptEntry[]>()
  for (const entry of rows) {
    if (!entry.content.trim()) continue
    const audience = normalizeAudience(entry.audience)
    if (!audience.startsWith('visitor:')) continue
    const lines = byVisitor.get(audience) ?? []
    if (!byVisitor.has(audience)) {
      if (byVisitor.size >= options.visitors) continue
      byVisitor.set(audience, lines)
    }
    if (lines.length < DIGEST_LINES_PER_VISITOR) lines.push(entry)
  }
  return [...byVisitor].flatMap(([audience, lines]) => {
    const name = options.names.get(audience.slice('visitor:'.length))
    return lines.reverse().map(entry => ({
      audience: promptAudience(audience),
      ...(name ? { name } : {}),
      source: 'script' as const,
      kind: entry.kind,
      content: entry.content.length > DIGEST_LINE_CHARACTERS ? `${entry.content.slice(0, DIGEST_LINE_CHARACTERS)}…` : entry.content,
      occurredAt: entry.occurredAt.toISOString(),
    }))
  })
}

/** A guest code is the whole credential, so only its first six characters reach a prompt. */
function promptAudience(audience: string) {
  return audience.replace(/^(visitor:web:g_[A-Za-z0-9_-]{6})[A-Za-z0-9_-]+$/, '$1…')
}

function noteKey(note: VisitorNote) {
  return `${note.audience}\n${note.occurredAt}\n${note.kind}`
}
