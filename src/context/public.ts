import { emptyStoryState, type EmotionalOffset, type InterludeArc, type InterludeParticipant, type InterludeScene, type InterludeStory, type NarrativeFact, type NarrativeRequest, type PublicDigestRequest, type ScriptEntry, type StorySettingOverlay } from '../types'

export interface PublicContextOptions {
  /** Explicit profile for this chat from telegram.userAccounts; storyDefaults describe the owner and are never used here. */
  accountProfile?: { profile?: string; relationship?: string }
  /** memory.publicOwnerProfile: what may be said about the owner to strangers. */
  publicOwnerProfile: string
  /** Code-merged overlay from public patches (memory-helpers publicSettingOverlay). */
  publicOverlay: StorySettingOverlay
}

/**
 * Request for a public-tier turn (other private chats, groups; later the
 * website and channel). Built from an allowlist: a field reaches the model
 * only if it is copied here, so a new NarrativeRequest field stays out of
 * public turns until someone decides it is safe (roadmap §4.7, S4).
 *
 * Memory records in the draft were already read through MemoryStore with a
 * public viewer; this layer handles everything that does not live in a
 * memory table: story state, derived layers, other relationships and intents.
 */
export function publicNarrativeRequest(draft: NarrativeRequest, options: PublicContextOptions): NarrativeRequest {
  const own = draft.participant ? publicParticipant(draft.participant, options.accountProfile) : null
  const ownId = own?.id
  const ownOnly = <T extends { participantId: string }>(items: T[]) => ownId ? items.filter(item => item.participantId === ownId) : []
  // sceneContext was read with a public viewer, so it holds the public scene and arc (roadmap §4.6).
  const publicArc = draft.sceneContext?.arc ?? null
  const { continuity, mood, ...arc } = publicArc ?? {} as Partial<InterludeArc>
  const offset = draft.emotionalOffset
  return {
    phase: draft.phase,
    // Continuity is a private derived layer; a public turn may neither read nor rewrite it.
    refreshContinuity: false,
    outputRecovery: draft.outputRecovery,
    story: {
      ...draft.story,
      setting: publicCanon(draft.story),
      // Private continuity, overlay, scene presence and agency/alter internals never come in;
      // only their public versions do.
      state: { ...emptyStoryState(), settingOverlay: options.publicOverlay, continuitySnapshot: continuity ?? undefined },
    },
    from: draft.from,
    now: draft.now,
    userMessage: draft.userMessage,
    images: draft.images,
    participant: own,
    // Other relationships are third-party information.
    participants: [],
    shareParticipantDetails: false,
    dueIntents: ownOnly(draft.dueIntents),
    activeConsequences: ownOnly(draft.activeConsequences),
    supersededIntents: ownOnly(draft.supersededIntents),
    recentEntries: draft.recentEntries,
    sceneContext: { scene: draft.sceneContext?.scene ?? null, arc: publicArc ? arc as InterludeArc : null },
    facts: draft.facts,
    overlaySnapshots: draft.overlaySnapshots,
    webContext: ownOnly(draft.webContext ?? []),
    groupContext: draft.groupContext,
    alterEnabled: draft.alterEnabled,
    // Direction and intensity are shared mood. The private description comes from private
    // scripts; the public one is used only while it was written for the same direction.
    emotionalOffset: offset ? { ...offset, description: mood?.direction === offset.direction ? mood.description : '' } : null,
    agencyEnabled: false,
    agencyWindow: null,
    automaticDeliverySummaries: [],
    followUpCommitments: ownOnly(draft.followUpCommitments ?? []),
    publicOwnerProfile: options.publicOwnerProfile.trim(),
  }
}

/** Canon comes from config.yaml; user/relationship defaults describe the owner and are dropped. */
function publicCanon(story: InterludeStory): InterludeStory['setting'] {
  const { character, world, perspective, supportingCast, location, style, timezone } = story.setting
  return { character, world, perspective, supportingCast, location, style, timezone, user: { displayName: '', profile: '' }, relationship: '' }
}

export interface PublicDigestSources {
  story: InterludeStory
  now: Date
  scene: InterludeScene | null
  arc: InterludeArc | null
  /** Records read with PUBLIC_VIEWER; the builder rechecks the label anyway. */
  entries: ScriptEntry[]
  facts: NarrativeFact[]
  publicOverlay: StorySettingOverlay
  offset: Pick<EmotionalOffset, 'direction' | 'intensity'> | null
}

/**
 * Input of the public digest (roadmap §4.6), copied field by field. The
 * model call that writes the public layer sees nothing else, so private
 * material cannot leak into it even through a summarizing model (S4).
 */
export function publicDigestRequest(sources: PublicDigestSources): PublicDigestRequest {
  const isPublic = (record: { audience: unknown }) => record.audience === 'public'
  const { user: _user, relationship: _relationship, ...canon } = publicCanon(sources.story)
  const scene = sources.scene && isPublic(sources.scene) ? sources.scene : null
  const arc = sources.arc && isPublic(sources.arc) ? sources.arc : null
  return {
    interval: { from: (scene?.updatedAt ?? sources.entries[0]?.occurredAt ?? sources.now).toISOString(), now: sources.now.toISOString() },
    canon,
    settingOverlay: sources.publicOverlay,
    scene: scene ? { hook: scene.hook, summary: scene.summary } : null,
    arc: arc ? { title: arc.title, summary: arc.summary } : null,
    continuity: arc?.continuity ?? null,
    facts: sources.facts.filter(isPublic).map(fact => ({ scope: fact.scope, content: fact.content, importance: fact.importance, unresolved: fact.unresolved })),
    entries: sources.entries.filter(isPublic).map(entry => ({ id: entry.id, kind: entry.kind, actor: entry.actor, content: entry.content, occurredAt: entry.occurredAt.toISOString() })),
    mood: sources.offset ? { direction: sources.offset.direction, intensity: sources.offset.intensity } : null,
  }
}

function publicParticipant(participant: InterludeParticipant, account: PublicContextOptions['accountProfile']): InterludeParticipant {
  return {
    ...participant,
    profile: account?.profile?.trim() ?? '',
    relationship: account?.relationship?.trim() ?? '',
  }
}
