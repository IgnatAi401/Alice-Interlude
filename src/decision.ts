import { normalizeAlterValue } from './alter'
import { MemoryConfig, RuntimeConfig, SharedStoryConfig } from './config'
import { Time } from './runtime'
import { normalizeAutomaticDeliverySummary, normalizeContinuitySnapshot, normalizeScenePresenceState } from './state'
import { BrowserIntentDraft, FollowUpCommitmentDraft, FollowUpResolutionDraft, GroupContext, IntentDraft, MemoryDraft, NarrativeDecision, NarrativeIntent, NarrativeInteraction, NarrativeRequest, OutgoingMessageDraft, ParticipantState, ScenePresenceDraft, ScenePresenceState, ScriptEntry } from './types'
import { clampNumber, clip, isRecord, toDate } from './util'
import { normalizeBrowserIntentDraftLoose } from './web-policy'

/** Validates and normalizes the JSON a narrator model returns before anything is persisted or sent. */

export function normalizeGroupVisibleReply(raw: NarrativeDecision['groupReply'], interaction: NarrativeDecision['interaction'], maxCharacters: number) {
  return normalizeGroupReply(raw, maxCharacters) || normalizeGroupInteractionReply(interaction, maxCharacters)
}

export function requiresVisibleReplyRecovery(phase: NarrativeRequest['phase'], groupContext: GroupContext | undefined, decision: NarrativeDecision) {
  if (phase !== 'user-message') return false
  return groupContext ? !hasStructuredGroupReply(decision) : !hasStructuredInteraction(decision.interaction)
}

export function visibleReplyMode(decision: NarrativeDecision, groupContext?: GroupContext) {
  if (!groupContext) return hasStructuredInteraction(decision.interaction) ? decision.interaction!.reply.mode : '未提供或无效'
  if (hasStructuredGroupReplyField(decision.groupReply)) return `group:${decision.groupReply!.mode}`
  if (hasStructuredInteraction(decision.interaction)) return `group-fallback:${decision.interaction!.reply.mode}`
  return '未提供或无效'
}

export function hasStructuredGroupReply(decision: NarrativeDecision) {
  return hasStructuredGroupReplyField(decision.groupReply) || hasStructuredInteraction(decision.interaction)
}

export function hasStructuredGroupReplyField(value: unknown) {
  if (!isRecord(value) || (value.mode !== 'none' && value.mode !== 'immediate')) return false
  return value.mode === 'none' || typeof value.content === 'string' && !!value.content.trim()
}

export function hasStructuredInteraction(value: unknown) {
  if (!isRecord(value) || typeof value.seen !== 'boolean' || !isRecord(value.reply)) return false
  const mode = value.reply.mode
  if (mode !== 'none' && mode !== 'immediate' && mode !== 'delayed') return false
  if (mode === 'none') return true
  if (typeof value.reply.content !== 'string' || !value.reply.content.trim()) return false
  return mode === 'immediate' || typeof value.reply.sendAt === 'string' && !!value.reply.sendAt.trim()
}

export function normalizeGroupReply(raw: NarrativeDecision['groupReply'], maxCharacters: number) {
  if (!raw || raw.mode !== 'immediate') return ''
  return clip(raw.content, Math.max(1, maxCharacters))
}

export function normalizeGroupInteractionReply(raw: NarrativeDecision['interaction'], maxCharacters: number) {
  if (!raw || raw.reply.mode !== 'immediate') return ''
  return clip(raw.reply.content, Math.max(1, maxCharacters))
}

export function hasRequiredNarrativeScript(value: NarrativeDecision | undefined | null) {
  return typeof value?.script === 'string' && value.script.trim().length > 0
}

export function isAutomaticNarrativePhase(phase: NarrativeRequest['phase']) {
  return phase === 'advance' || phase === 'conversation-follow-up'
}

export function normalizeFollowUpSummary(value: unknown) {
  return typeof value === 'string' ? clip(value, 360).trim().replace(/\s+/g, ' ').toLowerCase() : ''
}

export function followUpExpiresAt(value: unknown, now: Date) {
  const requested = toDate(value)
  const maximum = new Date(now.getTime() + 24 * Time.hour)
  if (!requested || requested <= now) return maximum
  return requested < maximum ? requested : maximum
}

export function normalizeFollowUpCommitment(value: unknown, now: Date): FollowUpCommitmentDraft | undefined {
  if (!isRecord(value)) return undefined
  const kind = value.kind === 'thinking' || value.kind === 'checking' || value.kind === 'decision' || value.kind === 'emotional-settle'
    ? value.kind
    : undefined
  const summary = typeof value.summary === 'string' ? clip(value.summary, 360).trim() : ''
  const notBefore = toDate(value.notBefore)
  if (!kind || !summary || !notBefore || notBefore.getTime() - now.getTime() < 5 * Time.minute || notBefore.getTime() - now.getTime() > 12 * Time.hour) return undefined
  const sourceEntryIds = Array.isArray(value.sourceEntryIds)
    ? value.sourceEntryIds.filter(id => typeof id === 'number' && Number.isSafeInteger(id) && id > 0).slice(0, 4)
    : []
  const expiresAt = toDate(value.expiresAt)
  return {
    kind, summary, notBefore: notBefore.toISOString(),
    ...(expiresAt && expiresAt > notBefore ? { expiresAt: expiresAt.toISOString() } : {}),
    ...(sourceEntryIds.length ? { sourceEntryIds } : {}),
  }
}

export function inferredFollowUpCommitment(content: string, now: Date): FollowUpCommitmentDraft {
  return {
    kind: 'thinking', summary: clip(`The character promised to return after thinking: ${content}`, 360),
    notBefore: new Date(now.getTime() + 20 * Time.minute).toISOString(),
  }
}

export function interactionPromisesFollowUp(content: unknown) {
  if (typeof content !== 'string') return false
  return /我(?:先)?想想|我去(?:想想|看看|查查|确认)|晚点(?:回|说|告诉)|之后(?:回|说|告诉)|等我.{0,12}(?:回|说|告诉)|整理.{0,12}(?:回|说|告诉)/.test(content)
}

export function normalizeFollowUpResolutions(value: unknown): FollowUpResolutionDraft[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is Record<string, unknown> => isRecord(item)
      && typeof item.id === 'number' && Number.isInteger(item.id) && item.id > 0
      && (item.outcome === 'fulfilled' || item.outcome === 'rescheduled' || item.outcome === 'cancelled'))
    .map(item => ({
      id: item.id as number,
      outcome: item.outcome as FollowUpResolutionDraft['outcome'],
      ...(typeof item.notBefore === 'string' ? { notBefore: item.notBefore } : {}),
    }))
    .slice(0, 2)
}

export function automaticDeliveryFromPayload(value: unknown): OutgoingMessageDraft['automaticDelivery'] | undefined {
  const record = isRecord(value) && isRecord(value.automaticDelivery) ? value.automaticDelivery : undefined
  const summary = normalizeAutomaticDeliverySummary(record?.summary)
  const sourceEntryId = typeof record?.sourceEntryId === 'number' && Number.isSafeInteger(record.sourceEntryId)
    ? record.sourceEntryId
    : undefined
  return summary ? { summary, ...(sourceEntryId ? { sourceEntryId } : {}) } : undefined
}

export function mergeDeliverySummary(left: string, right: string) {
  if (!left || left === right || left.includes(right)) return left || right
  if (right.includes(left)) return right
  return clip(`${left}；${right}`, 240)
}

/** Scene compaction may update a tiny roster only with explicit observed
 * evidence. This keeps named supporting cast available without treating them
 * as automatically present. */
export function normalizeScenePresenceDrafts(value: unknown, entries: ScriptEntry[], now = new Date()): ScenePresenceState[] {
  if (!Array.isArray(value)) return []
  const byId = new Map(entries.map(entry => [entry.id, entry]))
  const next: ScenePresenceState[] = []
  for (const item of value as ScenePresenceDraft[]) {
    if (!isRecord(item)) continue
    const name = typeof item.name === 'string' ? clip(item.name, 80).trim() : ''
    const status = item.status === 'present' || item.status === 'off-scene' || item.status === 'expected'
      ? item.status
      : undefined
    const basis = typeof item.basis === 'string' ? clip(item.basis, 300).trim() : ''
    const sourceEntryIds = Array.isArray(item.sourceEntryIds)
      ? item.sourceEntryIds.filter(id => typeof id === 'number' && byId.has(id)).slice(0, 8)
      : []
    const evidence = sourceEntryIds.map(id => byId.get(id)!).filter(entry => entry.content.includes(name))
    if (!name || !status || !basis || !evidence.length || !hasExplicitPresenceEvidence(status, evidence)) continue
    next.push({ name, status, basis, sourceEntryIds, updatedAt: now.toISOString() })
  }
  return normalizeScenePresenceState(next)
}

export function hasExplicitPresenceEvidence(status: ScenePresenceState['status'], entries: ScriptEntry[]) {
  const text = entries.map(entry => entry.content).join('\n')
  if (status === 'off-scene') return /告别|道别|分别|先走|离开|离去|回家|回去了|独自|分开|告辞/.test(text)
  if (status === 'expected') return /约好|约在|等会|稍后|会来|准备来|约见/.test(text)
  return /一起|同行|身边|来到|抵达|进入|走进|拉着|坐在|站在|陪着/.test(text)
}

export function normalizeDecision(raw: NarrativeDecision, from: Date, now: Date, permitMessages: boolean, runtime: RuntimeConfig, shared: SharedStoryConfig, currentParticipantId: string, permittedParticipantIds: Set<string>, phase: NarrativeRequest['phase'] = 'advance', memory?: MemoryConfig, refreshContinuity = false) {
  const script = typeof raw?.script === 'string'
    ? raw.script.trim().slice(0, runtime.maxScriptCharacters)
    : ''
  // The only channel for a private reply is interaction. Automatic life
  // passes have no live participant event, so they cannot emit it at all.
  const interaction = phase === 'advance' ? undefined : normalizeInteraction(raw?.interaction, now, runtime)
  // Optional memories are model suggestions, not a source of truth.  Never
  // let a model turn an invented online contact into durable retrieval data.
  const memories = Array.isArray(raw?.memories)
    ? raw.memories.filter(validMemory).map(memory => ({ ...memory, participantId: permittedOrGlobal(memory.participantId, currentParticipantId, permittedParticipantIds) }))
    : []
  const intents = Array.isArray(raw?.intents) ? raw.intents
    .filter(intent => !isRecord(intent) || intent.type !== 'follow-up-commitment')
    .filter(intent => validIntent(intent, from, now, memory))
    .map(intent => ({ ...intent, participantId: permittedOrGlobal(intent.participantId, currentParticipantId, permittedParticipantIds) }))
    .slice(0, 8)
    : []
  const intentUpdates = normalizeIntentUpdates(raw?.intentUpdates)
  const browserIntents = Array.isArray(raw?.browserIntents)
    ? raw.browserIntents.map(normalizeBrowserIntentDraftLoose).filter((intent): intent is BrowserIntentDraft => !!intent).slice(0, 1)
    : []
  const proactive = phase === 'advance'
  const agencyGatedProactive = proactive && !isRecord(raw?.proactiveContact)
  const crossConversationActions = permitMessages && shared.allowCrossConversationMessages && Array.isArray(raw?.crossConversationActions)
    ? raw.crossConversationActions
      .map(action => normalizeConversationAction(action, runtime, permittedParticipantIds, currentParticipantId, now, agencyGatedProactive))
      .filter((action): action is NonNullable<ReturnType<typeof normalizeConversationAction>> => !!action)
      .slice(0, Math.max(0, shared.maxCrossConversationActions))
    : []
  const statePatch = isRecord(raw?.statePatch) ? pickParticipantStatePatch(raw.statePatch) : undefined
  const continuity = refreshContinuity ? normalizeContinuitySnapshot(raw?.continuity) : undefined
  const alter = normalizeAlterValue(raw?.alter)
  const automaticDeliverySummary = isAutomaticNarrativePhase(phase)
    ? normalizeAutomaticDeliverySummary(raw?.automaticDeliverySummary) || undefined
    : undefined
  const followUpCommitment = phase === 'user-message' ? normalizeFollowUpCommitment(raw?.followUpCommitment, now) : undefined
  const followUpResolutions = phase === 'user-message' || phase === 'intent-due'
    ? normalizeFollowUpResolutions(raw?.followUpResolutions)
    : []
  const agencyWindow = isRecord(raw?.agencyWindow) ? raw.agencyWindow : undefined
  const proactiveContact = isRecord(raw?.proactiveContact) ? raw.proactiveContact : undefined
  return { script, alter, agencyWindow, proactiveContact, interaction, automaticDeliverySummary, followUpCommitment, followUpResolutions, continuity, memories, intents, intentUpdates, browserIntents, statePatch, crossConversationActions }
}

export function normalizeInteraction(value: unknown, now: Date, runtime: RuntimeConfig): NarrativeInteraction | undefined {
  if (!isRecord(value) || typeof value.seen !== 'boolean' || !isRecord(value.reply)) return undefined
  const mode = value.reply.mode
  if (mode !== 'none' && mode !== 'immediate' && mode !== 'delayed') return undefined
  const content = typeof value.reply.content === 'string' ? value.reply.content.trim().slice(0, runtime.maxMessageCharacters) : undefined
  const sendAt = toDate(value.reply.sendAt)

  if (!value.seen) return { seen: false, reply: { mode: 'none' } }
  if (mode === 'none') return { seen: true, reply: { mode: 'none' } }
  if (!content) return { seen: true, reply: { mode: 'none' } }
  if (mode === 'immediate') return { seen: true, reply: { mode, content } }
  const delay = sendAt ? sendAt.getTime() - now.getTime() : NaN
  if (!sendAt || delay < runtime.minimumDelayedReplySeconds * 1_000 || delay > runtime.maximumDelayedReplyMinutes * Time.minute) return { seen: true, reply: { mode: 'none' } }
  return { seen: true, reply: { mode, content, sendAt: sendAt.toISOString() } }
}

export function validMemory(value: unknown): value is MemoryDraft {
  return isRecord(value) && typeof value.category === 'string' && typeof value.content === 'string' && !!value.content.trim()
}

export function validIntent(value: unknown, from: Date, now: Date, memory?: MemoryConfig): value is IntentDraft {
  if (!isRecord(value) || typeof value.type !== 'string' || typeof value.summary !== 'string') return false
  const notBefore = toDate(value.notBefore)
  if (!notBefore) return false
  if (!isActiveConsequenceDraft(value)) return notBefore > now
  const expiresAt = consequenceExpiresAt(value.payload)
  const payload = value.payload
  const effect = isRecord(payload) && typeof payload.effect === 'string' ? payload.effect.trim() : ''
  const strength = isRecord(payload) ? payload.strength : undefined
  // Consequences are intentionally short-to-medium-lived story pressure,
  // not a backdoor for permanently rewriting canon. Keep the source time
  // close to this writing turn and cap their natural lifetime at 30 days.
  const maximumLifetime = Math.max(1, memory?.activeConsequenceMaxDays ?? 7) * Time.day
  return !!memory?.activeConsequencesEnabled && !!effect
    && (strength === undefined || typeof strength === 'number' && Number.isFinite(strength) && strength >= 0 && strength <= 1)
    && notBefore <= now && notBefore >= from
    && !!expiresAt && expiresAt > now && expiresAt.getTime() - now.getTime() <= maximumLifetime
}

export type NormalizedIntentUpdate = { id: number; status: 'completed' | 'cancelled'; resolution?: string }

export function normalizeIntentUpdates(value: unknown): NormalizedIntentUpdate[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is Record<string, unknown> => isRecord(item) && Number.isInteger(item.id) && Number(item.id) > 0 && (item.status === 'completed' || item.status === 'cancelled'))
    .map(item => ({
      id: Number(item.id), status: item.status as 'completed' | 'cancelled',
      ...(typeof item.resolution === 'string' && item.resolution.trim() ? { resolution: clip(item.resolution, 1_000) } : {}),
    }))
    .slice(0, 8)
}

export function isActiveConsequence(intent: NarrativeIntent) {
  return intent.type === 'active-consequence' && isRecord(intent.payload) && intent.payload.lifecycle === 'active'
}

export function isActiveConsequenceDraft(intent: Pick<IntentDraft, 'type' | 'payload'> | Record<string, unknown>) {
  return intent.type === 'active-consequence' && isRecord(intent.payload) && intent.payload.lifecycle === 'active'
}

export function consequenceExpiresAt(payload: unknown) {
  if (!isRecord(payload)) return undefined
  return toDate(payload.expiresAt)
}

export function consequenceStrength(payload: unknown, fallback = 0.55) {
  return clampNumber(isRecord(payload) ? payload.strength : undefined, fallback, 0, 1)
}

export function hasCompactionEvidence(sourceEntryIds: number[] | undefined, entries: ScriptEntry[]) {
  if (!Array.isArray(sourceEntryIds) || sourceEntryIds.length === 0) return false
  const ids = new Set(entries.map(entry => entry.id))
  return sourceEntryIds.some(id => ids.has(id))
}

export function normalizeConversationAction(value: unknown, runtime: RuntimeConfig, permittedParticipantIds: Set<string>, currentParticipantId: string, now = new Date(), proactive = false) {
  if (!isRecord(value) || typeof value.participantId !== 'string' || !value.participantId || value.participantId === currentParticipantId) return undefined
  if (!permittedParticipantIds.has(value.participantId) || (value.mode !== 'immediate' && value.mode !== 'delayed')) return undefined
  const content = typeof value.content === 'string' ? value.content.trim().slice(0, runtime.maxMessageCharacters) : ''
  if (!content) return undefined
  const willingness = typeof value.willingness === 'number' && Number.isFinite(value.willingness)
    ? clampNumber(value.willingness, 0, 0, 1)
    : undefined
  if (proactive && (willingness === undefined || willingness < (runtime.proactiveWillingnessThreshold ?? 0.65))) return undefined
  const reason = typeof value.reason === 'string' ? clip(value.reason, 300) : undefined
  if (value.mode === 'immediate') return { participantId: value.participantId, mode: value.mode, content, ...(willingness === undefined ? {} : { willingness }), ...(reason ? { reason } : {}) }
  const sendAt = toDate(value.sendAt)
  const delay = sendAt ? sendAt.getTime() - now.getTime() : NaN
  if (!sendAt || delay < runtime.minimumDelayedReplySeconds * 1_000 || delay > runtime.maximumDelayedReplyMinutes * Time.minute) return undefined
  return { participantId: value.participantId, mode: value.mode, content, sendAt: sendAt.toISOString(), ...(willingness === undefined ? {} : { willingness }), ...(reason ? { reason } : {}) }
}

export function permittedOrGlobal(value: unknown, fallback: string, permittedParticipantIds: Set<string>) {
  const candidate = typeof value === 'string' ? value.trim() : ''
  if (candidate && permittedParticipantIds.has(candidate)) return candidate
  return fallback && permittedParticipantIds.has(fallback) ? fallback : ''
}

export function pickParticipantStatePatch(value: Record<string, unknown>): Partial<ParticipantState> {
  const patch: Partial<ParticipantState> = {}
  if (Array.isArray(value.openThreads) && value.openThreads.every(item => typeof item === 'string')) patch.openThreads = value.openThreads.map(item => clip(item, 500)).slice(0, 50)
  if (Array.isArray(value.relationshipNotes) && value.relationshipNotes.every(item => typeof item === 'string')) patch.relationshipNotes = value.relationshipNotes.map(item => clip(item, 500)).slice(0, 50)
  return patch
}
