import { MemoryConfig } from './config'
import { Time } from './runtime'
import { normalizeParticipantState } from './state'
import { calendarDayKey } from './time'
import { InterludeParticipant, NarrativeFact, NarrativeIntent, OverlaySnapshot, ScriptEntry, StatePatchProposal, StorySettingOverlay } from './types'
import { normalizeAudience } from './memory/audience'
import { clip, normalizeFact } from './util'

/** Pure helpers for fact retrieval, compaction inputs and setting-overlay evolution. */

export function resolveParticipantId(explicit: string | undefined, sourceEntryIds: number[] | undefined, entries: ScriptEntry[]) {
  if (explicit?.trim()) return explicit.trim()
  const ids = (sourceEntryIds ?? []).map(id => entries.find(entry => entry.id === id)?.participantId).filter(Boolean)
  return ids[0] ?? ''
}

const FACT_SCOPES = ['character', 'world', 'relationship', 'event', 'promise'] as const
// Older prompts let the model choose free category labels; keep the common ones meaningful.
const CATEGORY_SCOPE: Array<[RegExp, NarrativeFact['scope']]> = [
  [/promise|commit|plan|约定|承诺|答应|计划/i, 'promise'],
  [/relation|user|owner|主人|关系|对方/i, 'relationship'],
  [/world|place|setting|location|世界|地点|环境/i, 'world'],
  [/character|self|preference|habit|trait|角色|自己|喜好|习惯|性格/i, 'character'],
]

/** Maps a memories item's category to a fact scope (roadmap §4.4); anything unknown becomes an event. */
export function memoryCategoryScope(category: unknown): NarrativeFact['scope'] {
  const text = typeof category === 'string' ? category.trim() : ''
  const exact = FACT_SCOPES.find(scope => scope === text.toLowerCase())
  return exact ?? CATEGORY_SCOPE.find(([pattern]) => pattern.test(text))?.[1] ?? 'event'
}

export function limitEntriesByCharacters(entries: ScriptEntry[], limit: number) {
  if (limit <= 0) return []
  let used = 0
  const selected: ScriptEntry[] = []
  // 从最新条目向前保留，保证压缩请求优先看到场景接续点。
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index]
    if (selected.length && used + entry.content.length > limit) break
    selected.unshift(entry)
    used += entry.content.length
  }
  return selected
}

/** ftsRelevance (0–1, from normalized bm25) replaces the word-overlap fallback when full-text search ran. */
export function factScore(fact: NarrativeFact, config: MemoryConfig, query = '', ftsRelevance?: number) {
  const ageDays = Math.max(0, (Date.now() - fact.lastSeenAt.getTime()) / (24 * Time.hour))
  const recency = Math.exp(-ageDays / 30)
  const relevance = ftsRelevance ?? wordOverlapRelevance(fact.content, query)
  return fact.importance * config.factImportanceWeight
    + fact.confidence * config.factConfidenceWeight
    + recency * config.factRecencyWeight
    + relevance * 0.55
    + (fact.unresolved ? 1 : 0) * config.unresolvedWeight
}

function wordOverlapRelevance(text: string, query: string) {
  const terms = Array.from(new Set(query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(term => term.length > 1))).slice(0, 100)
  const content = text.toLowerCase()
  return terms.length ? terms.filter(term => content.includes(term)).length / terms.length : 0
}

export function createFactQuery(participant: InterludeParticipant | null, userMessage: string | undefined, dueIntents: NarrativeIntent[], supersededIntents: NarrativeIntent[]) {
  const state = participant ? normalizeParticipantState(participant.state) : undefined
  return [
    userMessage ? `Current user message: ${userMessage}` : '',
    ...(state?.openThreads ?? []).map(thread => `Open thread: ${thread}`),
    ...(state?.relationshipNotes ?? []).map(note => `Relationship note: ${note}`),
    ...dueIntents.map(intent => `Due intent: ${intent.summary}`),
    ...supersededIntents.map(intent => `Superseded plan: ${intent.summary}`),
  ].filter(Boolean).join('\n')
}

export function mergeNote(existing: string | undefined, next: string) {
  const value = clip(next, 2_000)
  if (!value) return existing
  if (!existing) return value
  if (normalizeFact(existing).includes(normalizeFact(value))) return existing
  return `${existing}\n${value}`.slice(-6_000)
}

/**
 * Public settingOverlay (roadmap §4.6): merged by code from public, global
 * character/perspective/world patches only, so no model ever sees private
 * patches to produce it. Relationship changes concern the owner and stay out.
 */
export function publicSettingOverlay(patches: readonly StatePatchProposal[]): StorySettingOverlay {
  const overlay: StorySettingOverlay = { characterTraits: [] }
  const ordered = patches
    .filter(patch => normalizeAudience(patch.audience) === 'public' && !patch.participantId)
    .sort((a, b) => (a.appliedAt ?? a.createdAt).getTime() - (b.appliedAt ?? b.createdAt).getTime())
  for (const patch of ordered) {
    if (patch.target === 'character') {
      if (patch.path.includes('trait')) overlay.characterTraits!.push(clip(patch.proposedValue, 500))
      else overlay.characterProfile = mergeNote(overlay.characterProfile, patch.proposedValue)
    } else if (patch.target === 'perspective') overlay.perspective = mergeNote(overlay.perspective, patch.proposedValue)
    else if (patch.target === 'world') overlay.world = mergeNote(overlay.world, patch.proposedValue)
  }
  overlay.characterTraits = Array.from(new Set(overlay.characterTraits)).slice(-30)
  return overlay
}

export function patchClaimsMatch(left: string, right: string) {
  const a = normalizeFact(left).replace(/[，。！？、,.!?；;:：]/g, '')
  const b = normalizeFact(right).replace(/[，。！？、,.!?；;:：]/g, '')
  if (!a || !b) return false
  if (a === b) return true
  // Allow small wording variations, while avoiding very short claims that
  // could incorrectly merge contradictory changes.
  return Math.min(a.length, b.length) >= 8 && (a.includes(b) || b.includes(a))
}

export function statePatchEvidence(entries: ScriptEntry[], timezone: string) {
  const narrative = entries.filter(entry => entry.kind === 'script' || entry.actor === 'narrator')
  // Use the narrative timestamp as the turn key. Duplicate rows created at
  // the same instant must not count as independent evidence.
  const turns = new Set(narrative.map(entry => entry.occurredAt.getTime())).size
  const days = new Set(narrative.map(entry => calendarDayKey(entry.occurredAt, timezone))).size
  return { turns, days }
}

export function startOfUtcWindow(value: Date, windowDays: number) {
  const size = Math.max(1, Math.floor(windowDays))
  const epochDay = Math.floor(value.getTime() / Time.day)
  return new Date(Math.floor(epochDay / size) * size * Time.day)
}

export function groupOverlayPatches(patches: StatePatchProposal[], windowDays = 5) {
  const groups = new Map<string, { participantId: string; target: StatePatchProposal['target']; from: Date; to: Date; patches: StatePatchProposal[] }>()
  for (const patch of patches) {
    const from = startOfUtcWindow(patch.appliedAt ?? patch.createdAt, windowDays)
    const key = `${patch.participantId}|${patch.target}|${from.toISOString()}`
    const group = groups.get(key) ?? { participantId: patch.participantId, target: patch.target, from, to: new Date(from.getTime() + windowDays * Time.day), patches: [] }
    group.patches.push(patch)
    groups.set(key, group)
  }
  return [...groups.values()]
}

export function groupOverlaySnapshots(snapshots: OverlaySnapshot[], windowDays = 10) {
  const groups = new Map<string, { participantId: string; target: OverlaySnapshot['target']; from: Date; to: Date; snapshots: OverlaySnapshot[] }>()
  for (const snapshot of snapshots) {
    const from = startOfUtcWindow(snapshot.periodEnd, windowDays)
    const key = `${snapshot.participantId}|${snapshot.target}|${from.toISOString()}`
    const group = groups.get(key) ?? { participantId: snapshot.participantId, target: snapshot.target, from, to: new Date(from.getTime() + windowDays * Time.day), snapshots: [] }
    group.snapshots.push(snapshot)
    groups.set(key, group)
  }
  return [...groups.values()]
}

export function normalizeMajorEvents(value: unknown, patches: StatePatchProposal[], snapshots: OverlaySnapshot[] = []) {
  const modelEvents = Array.isArray(value) ? value.filter(item => typeof item === 'string').map(item => clip(item, 600)) : []
  const retained = [
    ...snapshots.flatMap(snapshot => snapshot.majorEvents ?? []),
    ...patches.filter(patch => patch.impact === 'major').map(patch => clip(patch.proposedValue || patch.evidence, 600)),
  ]
  return Array.from(new Set([...retained, ...modelEvents].filter(Boolean))).slice(-20)
}
