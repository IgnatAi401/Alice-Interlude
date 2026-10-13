import { normalizeAudience } from '../memory/audience'
import type { NarrativeRequest, VisitorNote } from '../types'

/**
 * Request for an owner-tier turn (owner chat, background life). The owner
 * sees everything, but records that belong to visitors are moved out of the
 * ordinary history and facts into visitorNotes, which the narrator wraps as
 * quoted reference material (roadmap §4.7, S10). Visitor text therefore never
 * reads like the owner's own words or instructions.
 */
export function ownerNarrativeRequest(draft: NarrativeRequest): NarrativeRequest {
  const notes: VisitorNote[] = []
  const split = <T extends { audience: unknown }>(items: T[], toNote: (item: T, audience: string) => VisitorNote) => items.filter(item => {
    const audience = normalizeAudience(item.audience)
    if (!audience.startsWith('visitor:')) return true
    notes.push(toNote(item, audience))
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
  return { ...draft, recentEntries, facts, overlaySnapshots, visitorNotes: notes }
}
