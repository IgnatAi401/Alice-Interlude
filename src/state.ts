import { normalizeAgencyWindowState } from './agency'
import { normalizeUrgeState } from './urge'
import { normalizeAlterSystemState } from './alter'
import { AutomaticDeliverySummary, ContinuitySnapshot, InterludeParticipant, InterludeStory, ParticipantState, ScenePresenceState, StorySetting, StoryState } from './types'
import { clip, isRecord, toDate } from './util'
import { normalizeAudience } from './memory/audience'

/** Normalizes stored story and participant state, and rows read from SQLite. */

export function isTransientDatabaseError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /disk\s*i\/o|database is locked|busy|unable to open/i.test(message)
}

export function normalizeAutomaticDeliverySummary(value: unknown) {
  return typeof value === 'string' ? clip(value, 240).trim() : ''
}

export function normalizeAutomaticDeliverySummaries(value: unknown): AutomaticDeliverySummary[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const normalized: AutomaticDeliverySummary[] = []
  for (const item of value) {
    if (!isRecord(item)) continue
    const participantId = typeof item.participantId === 'string' ? clip(item.participantId, 255) : ''
    const summary = normalizeAutomaticDeliverySummary(item.summary)
    const deliveredAt = typeof item.deliveredAt === 'string' && !Number.isNaN(new Date(item.deliveredAt).getTime())
      ? item.deliveredAt
      : ''
    const sourceEntryId = typeof item.sourceEntryId === 'number' && Number.isSafeInteger(item.sourceEntryId)
      ? item.sourceEntryId
      : undefined
    const key = `${participantId}|${sourceEntryId ?? 0}|${summary}`
    if (!participantId || !summary || !deliveredAt || seen.has(key)) continue
    seen.add(key)
    normalized.push({ participantId, summary, ...(sourceEntryId ? { sourceEntryId } : {}), deliveredAt })
  }
  return normalized.slice(-6)
}

export function normalizeScenePresenceState(value: unknown): ScenePresenceState[] {
  if (!Array.isArray(value)) return []
  const latest = new Map<string, ScenePresenceState>()
  for (const item of value) {
    if (!isRecord(item)) continue
    const name = typeof item.name === 'string' ? clip(item.name, 80).trim() : ''
    const status = item.status === 'present' || item.status === 'off-scene' || item.status === 'expected'
      ? item.status
      : undefined
    const basis = typeof item.basis === 'string' ? clip(item.basis, 300).trim() : ''
    const sourceEntryIds = Array.isArray(item.sourceEntryIds)
      ? item.sourceEntryIds.filter(id => typeof id === 'number' && Number.isSafeInteger(id)).slice(0, 8)
      : []
    const updatedAt = typeof item.updatedAt === 'string' && !Number.isNaN(new Date(item.updatedAt).getTime())
      ? item.updatedAt
      : ''
    if (!name || !status || !basis || !sourceEntryIds.length || !updatedAt) continue
    latest.set(name, { name, status, basis, sourceEntryIds, updatedAt })
  }
  return [...latest.values()].slice(-8)
}

export function normalizeContinuitySnapshot(value: unknown): ContinuitySnapshot | undefined {
  if (!isRecord(value)) return undefined
  const text = (item: unknown, limit: number) => typeof item === 'string' ? clip(item, limit).trim() : ''
  const list = (item: unknown, limit: number) => Array.isArray(item)
    ? item.map(value => text(value, limit)).filter(Boolean).slice(0, 5)
    : []
  const current = text(value.current, 500)
  const next = list(value.next, 300).slice(0, 3)
  const recent = list(value.recent, 300)
  const salient = list(value.salient, 400)
  if (!current && !next.length && !recent.length && !salient.length) return undefined
  return { current, next, recent, salient }
}

export function mergeSetting(base: StorySetting, patch: Partial<StorySetting>): StorySetting {
  return { ...base, ...patch, character: { ...base.character, ...patch.character }, user: { ...base.user, ...patch.user } }
}

export function mergeParticipantState(base: ParticipantState, patch: Partial<ParticipantState>): ParticipantState {
  return {
    ...base, ...patch,
    openThreads: Array.isArray(patch.openThreads) ? patch.openThreads : base.openThreads,
    relationshipNotes: Array.isArray(patch.relationshipNotes) ? patch.relationshipNotes : base.relationshipNotes,
  }
}

export function normalizeParticipantState(value: unknown): ParticipantState {
  const record = isRecord(value) ? value : {}
  return {
    openThreads: Array.isArray(record.openThreads) ? record.openThreads.filter(item => typeof item === 'string').map(item => clip(item, 500)).slice(0, 50) : [],
    relationshipNotes: Array.isArray(record.relationshipNotes) ? record.relationshipNotes.filter(item => typeof item === 'string').map(item => clip(item, 500)).slice(0, 50) : [],
    relationshipOverlay: typeof record.relationshipOverlay === 'string' ? clip(record.relationshipOverlay, 4_000) : undefined,
    unreadMessageCount: Math.max(0, Math.floor(typeof record.unreadMessageCount === 'number' ? record.unreadMessageCount : 0)),
    pendingReplyCount: Math.max(0, Math.floor(typeof record.pendingReplyCount === 'number' ? record.pendingReplyCount : 0)),
    lastUserMessageAt: typeof record.lastUserMessageAt === 'string' ? record.lastUserMessageAt : undefined,
    lastCharacterMessageAt: typeof record.lastCharacterMessageAt === 'string' ? record.lastCharacterMessageAt : undefined,
  }
}

export function normalizeStoryState(value: unknown): StoryState {
  const record = isRecord(value) ? value : {}
  const overlay = isRecord(record.settingOverlay) ? record.settingOverlay : {}
  const automation = isRecord(record.automation) ? record.automation : {}
  const continuity = isRecord(record.continuitySnapshot) ? normalizeContinuitySnapshot(record.continuitySnapshot) : undefined
  return {
    settingOverlay: {
      characterProfile: typeof overlay.characterProfile === 'string' ? overlay.characterProfile : undefined,
      perspective: typeof overlay.perspective === 'string' ? clip(overlay.perspective, 1_000) : undefined,
      relationship: typeof overlay.relationship === 'string' ? overlay.relationship : undefined,
      world: typeof overlay.world === 'string' ? overlay.world : undefined,
      supportingCast: typeof overlay.supportingCast === 'string' ? overlay.supportingCast : undefined,
      location: typeof overlay.location === 'string' ? overlay.location : undefined,
      characterTraits: Array.isArray(overlay.characterTraits) ? overlay.characterTraits.filter(item => typeof item === 'string') : [],
    },
    activeSceneId: typeof record.activeSceneId === 'number' ? record.activeSceneId : undefined,
    activeArcId: typeof record.activeArcId === 'number' ? record.activeArcId : undefined,
    continuitySnapshot: continuity,
    narrativeUpdateCount: Math.max(0, Math.floor(typeof record.narrativeUpdateCount === 'number' ? record.narrativeUpdateCount : 0)),
    lastContinuityUpdateAt: typeof record.lastContinuityUpdateAt === 'string' ? record.lastContinuityUpdateAt : undefined,
    alterSystem: normalizeAlterSystemState(record.alterSystem),
    agencyWindow: normalizeAgencyWindowState(record.agencyWindow),
    scenePresence: normalizeScenePresenceState(record.scenePresence),
    automaticDeliverySummaries: normalizeAutomaticDeliverySummaries(record.automaticDeliverySummaries),
    automation: {
      quietUntil: typeof automation.quietUntil === 'string' ? automation.quietUntil : undefined,
      nextAdvanceAt: typeof automation.nextAdvanceAt === 'string' ? automation.nextAdvanceAt : undefined,
      lastAutoAdvanceAt: typeof automation.lastAutoAdvanceAt === 'string' ? automation.lastAutoAdvanceAt : undefined,
      lastUserMessageAt: typeof automation.lastUserMessageAt === 'string' ? automation.lastUserMessageAt : undefined,
      conversationFollowUpAt: Array.isArray(automation.conversationFollowUpAt)
        ? automation.conversationFollowUpAt.filter(item => typeof item === 'string').slice(0, 8)
        : [],
      conversationFollowUpParticipantId: typeof automation.conversationFollowUpParticipantId === 'string'
        ? clip(automation.conversationFollowUpParticipantId, 255)
        : undefined,
      urge: normalizeUrgeState(automation.urge),
    },
  }
}

export function participantRelevance(participant: InterludeParticipant) {
  const state = normalizeParticipantState(participant.state)
  const pending = state.pendingReplyCount * 2 + state.unreadMessageCount
  const last = toDate(state.lastUserMessageAt)?.getTime() ?? participant.updatedAt.getTime()
  return pending * 1_000_000_000 + last
}

export const DATABASE_DATE_FIELDS: Record<string, string[]> = {
  interlude_story: ['cursorAt', 'createdAt', 'updatedAt'],
  interlude_participant: ['createdAt', 'updatedAt'],
  interlude_script_entry: ['occurredAt', 'createdAt'],
  interlude_memory: ['createdAt', 'updatedAt'],
  interlude_intent: ['notBefore', 'createdAt', 'updatedAt'],
  interlude_scene: ['startedAt', 'endedAt', 'createdAt', 'updatedAt'],
  interlude_arc: ['createdAt', 'updatedAt'],
  interlude_fact: ['lastSeenAt', 'createdAt', 'updatedAt'],
  interlude_state_patch: ['createdAt', 'appliedAt'],
  interlude_overlay_snapshot: ['periodStart', 'periodEnd', 'createdAt', 'updatedAt'],
  interlude_web_observation: ['accessedAt', 'createdAt'],
  interlude_approval: ['createdAt', 'requestedAt', 'expiresAt', 'decidedAt', 'finishedAt'],
}

/** Memory tables whose rows carry an audience label (roadmap §4.2). */
export const AUDIENCE_TABLES = [
  'interlude_script_entry', 'interlude_memory', 'interlude_fact', 'interlude_state_patch',
  'interlude_scene', 'interlude_arc', 'interlude_overlay_snapshot',
] as const

/** Minato normally materializes timestamp columns as Date objects. Some
 * drivers and hot-reload paths can return ISO strings, so normalize every row
 * crossing the service boundary before time arithmetic or prompt building. */
export function normalizeDatabaseRow(table: string, value: unknown): any {
  if (!isRecord(value)) return value
  const row: Record<string, unknown> = { ...value }
  for (const field of DATABASE_DATE_FIELDS[table] ?? []) {
    if (row[field] === null || row[field] === undefined) continue
    row[field] = toDate(row[field])
  }
  // Fail closed for rows written before audiences existed or edited by hand (S6).
  if ((AUDIENCE_TABLES as readonly string[]).includes(table)) row.audience = normalizeAudience(row.audience)
  if (table === 'interlude_story') {
    const createdAt = toDate(row.createdAt) ?? new Date()
    const updatedAt = toDate(row.updatedAt) ?? createdAt
    row.createdAt = createdAt
    row.updatedAt = updatedAt
    row.cursorAt = toDate(row.cursorAt) ?? updatedAt
    row.state = normalizeStoryState(row.state)
  } else if (table === 'interlude_participant') {
    row.createdAt = toDate(row.createdAt) ?? new Date()
    row.updatedAt = toDate(row.updatedAt) ?? row.createdAt
    row.state = normalizeParticipantState(row.state)
  }
  return row
}

/** A corrupted/future cursor must never make the narrator "fill in" time
 * backwards. Clamp only the prompt interval; normal successful persistence
 * still advances the stored cursor to the actual wall-clock time. */
export function narrativeCursor(story: InterludeStory, now: Date) {
  const cursor = toDate(story.cursorAt) ?? now
  return cursor > now ? now : cursor
}
