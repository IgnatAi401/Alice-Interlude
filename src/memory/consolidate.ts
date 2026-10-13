import type { FactConsolidationDecision, FactConsolidationRequest, NarrativeFact } from '../types'
import { normalizeFact } from '../util'
import { normalizeAudience } from './audience'

/**
 * Nightly consolidation rules (dev/ROADMAP.md §4.8). Pure functions; the
 * service applies the result. Facts are only ever compared inside one
 * audience and relationship, so a merge or supersession can never move
 * content between private, public and visitor records (S4, S5).
 */

/** Trigram Jaccard similarity at or above this counts as a near duplicate. */
export const DUPLICATE_SIMILARITY = 0.8
/** A bad model answer can retire at most this many facts per run. */
export const MAX_SUPERSESSIONS_PER_RUN = 20
export const EXPIRED_PLACEHOLDER = '[访客记录已过期删除]'

const groupKey = (fact: NarrativeFact) => `${normalizeAudience(fact.audience)}|${fact.participantId || ''}`

/** Letters and digits only, so punctuation and spacing differences do not count. */
const comparable = (text: string) => normalizeFact(text).replace(/[^\p{L}\p{N}]+/gu, '')
const digits = (text: string) => (normalizeFact(text).match(/\d+/g) ?? []).join(',')

function trigrams(text: string) {
  const value = comparable(text)
  const grams = new Set<string>()
  if (value.length < 3) grams.add(value)
  for (let index = 0; index + 3 <= value.length; index++) grams.add(value.slice(index, index + 3))
  return grams
}

export function similarity(left: string, right: string) {
  const a = trigrams(left), b = trigrams(right)
  let shared = 0
  for (const gram of a) if (b.has(gram)) shared++
  return shared / (a.size + b.size - shared || 1)
}

/** Most evidence first, then quality, then the most recently seen. */
function evidenceOrder(a: NarrativeFact, b: NarrativeFact) {
  return b.sourceEntryIds.length - a.sourceEntryIds.length
    || b.importance * b.confidence - a.importance * a.confidence
    || b.lastSeenAt.getTime() - a.lastSeenAt.getTime()
    || a.id - b.id
}

/** Near-duplicate clusters inside one audience + relationship; the first fact of each cluster is kept. */
export function duplicateMerges(facts: readonly NarrativeFact[]) {
  const groups = new Map<string, NarrativeFact[]>()
  for (const fact of facts) groups.set(groupKey(fact), [...groups.get(groupKey(fact)) ?? [], fact])
  const merges: Array<{ keep: NarrativeFact; drop: NarrativeFact[] }> = []
  for (const group of groups.values()) {
    const ordered = [...group].sort(evidenceOrder)
    const merged = new Set<number>()
    for (const keep of ordered) {
      if (merged.has(keep.id)) continue
      // Texts that differ in a number (date, time, amount) differ in substance however similar they look.
      const drop = ordered.filter(other => other.id !== keep.id && !merged.has(other.id)
        && digits(keep.content) === digits(other.content)
        && similarity(keep.content, other.content) >= DUPLICATE_SIMILARITY)
      if (!drop.length) continue
      for (const fact of [keep, ...drop]) merged.add(fact.id)
      merges.push({ keep, drop })
    }
  }
  return merges
}

/** Request for the contradiction check; groups with a single fact cannot contradict anything and are left out. */
export function consolidationRequest(facts: readonly NarrativeFact[], maxCharacters = 40_000): FactConsolidationRequest {
  const counts = new Map<string, number>()
  for (const fact of facts) counts.set(groupKey(fact), (counts.get(groupKey(fact)) ?? 0) + 1)
  const labels = new Map<string, string>()
  let remaining = maxCharacters
  const selected: FactConsolidationRequest['facts'] = []
  for (const fact of [...facts].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())) {
    const key = groupKey(fact)
    if ((counts.get(key) ?? 0) < 2 || remaining <= 0) continue
    if (!labels.has(key)) labels.set(key, `g${labels.size + 1}`)
    const content = fact.content.slice(0, 500)
    remaining -= content.length
    selected.push({ id: fact.id, group: labels.get(key)!, scope: fact.scope, content, createdAt: fact.createdAt.toISOString() })
  }
  return { facts: selected.sort((a, b) => a.group.localeCompare(b.group) || a.createdAt.localeCompare(b.createdAt)) }
}

/**
 * Host-side check of the model's answer: both facts active and distinct, in
 * the same audience and relationship, and the replacing fact strictly newer.
 */
export function validSupersessions(facts: readonly NarrativeFact[], decision: FactConsolidationDecision) {
  const byId = new Map(facts.map(fact => [fact.id, fact]))
  const accepted: Array<{ drop: NarrativeFact; by: NarrativeFact }> = []
  const dropped = new Set<number>()
  for (const item of Array.isArray(decision?.superseded) ? decision.superseded : []) {
    const drop = byId.get(Number(item?.id)), by = byId.get(Number(item?.by))
    if (!drop || !by || drop.id === by.id || dropped.has(drop.id) || dropped.has(by.id)) continue
    if (groupKey(drop) !== groupKey(by) || by.createdAt.getTime() <= drop.createdAt.getTime()) continue
    dropped.add(drop.id)
    accepted.push({ drop, by })
    if (accepted.length >= MAX_SUPERSESSIONS_PER_RUN) break
  }
  return accepted
}

/** Cut-off for visitor records; undefined when expiry is disabled (ttlDays = 0). */
export function visitorExpiryCutoff(ttlDays: number | undefined, now: Date) {
  const days = ttlDays ?? 30
  return days > 0 ? new Date(now.getTime() - days * 86_400_000) : undefined
}
