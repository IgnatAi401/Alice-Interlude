import { emptyStoryState, type InterludeParticipant, type NarrativeRequest } from '../types'

export interface PublicContextOptions {
  /** Explicit profile for this chat from telegram.userAccounts; storyDefaults describe the owner and are never used here. */
  accountProfile?: { profile?: string; relationship?: string }
  /** memory.publicOwnerProfile: what may be said about the owner to strangers. */
  publicOwnerProfile: string
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
  const { character, world, perspective, supportingCast, location, style, timezone } = draft.story.setting
  return {
    phase: draft.phase,
    // Continuity is a private derived layer; a public turn may neither read nor rewrite it.
    refreshContinuity: false,
    outputRecovery: draft.outputRecovery,
    story: {
      ...draft.story,
      // Canon comes from config.json; user/relationship defaults describe the owner.
      setting: { character, world, perspective, supportingCast, location, style, timezone, user: { displayName: '', profile: '' }, relationship: '' },
      // continuity, settingOverlay, scene presence and the agency/alter internals are all private derived state.
      state: emptyStoryState(),
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
    memories: draft.memories,
    sceneContext: draft.sceneContext,
    facts: draft.facts,
    overlaySnapshots: draft.overlaySnapshots,
    webContext: ownOnly(draft.webContext ?? []),
    groupContext: draft.groupContext,
    alterEnabled: draft.alterEnabled,
    // Direction and intensity are shared mood; the description is generated from private scripts.
    emotionalOffset: draft.emotionalOffset ? { ...draft.emotionalOffset, description: '' } : null,
    agencyEnabled: false,
    agencyWindow: null,
    automaticDeliverySummaries: [],
    followUpCommitments: ownOnly(draft.followUpCommitments ?? []),
    publicOwnerProfile: options.publicOwnerProfile.trim(),
  }
}

function publicParticipant(participant: InterludeParticipant, account: PublicContextOptions['accountProfile']): InterludeParticipant {
  return {
    ...participant,
    profile: account?.profile?.trim() ?? '',
    relationship: account?.relationship?.trim() ?? '',
  }
}
