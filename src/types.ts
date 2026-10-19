import type { Audience, ClassifiedAudience } from './memory/audience'
import type { LifeRhythm, UrgeState } from './urge'
import type { TurnTools } from './capabilities/loop'

export type StoryStatus = 'active' | 'paused' | 'archived'

export interface CharacterSetting {
  name: string
  profile: string
}

export interface StorySetting {
  /**
   * 初始 canon：只由显式配置修改。模型引起的长期变化应写入
   * StoryState.settingOverlay，避免一次生成把人物设定直接改写。
   */
  character: CharacterSetting
  user: { displayName: string; profile: string }
  relationship: string
  world: string
  /** Independent outer layer: the protagonist's values and way of seeing the world. */
  perspective: string
  supportingCast: string
  location: string
  style: string
  timezone: string
}

export interface StoryState {
  /** Evolving overlay. The original setting remains the story's canon/base. */
  settingOverlay: StorySettingOverlay
  activeSceneId?: number
  activeArcId?: number
  /** Low-frequency continuity note refreshed on the first auto pass and then after every 15 successful narrative updates. */
  continuitySnapshot?: ContinuitySnapshot
  narrativeUpdateCount: number
  lastContinuityUpdateAt?: string
  /** 自动推进时钟；ISO 字符串便于跨进程/数据库 JSON 持久化。 */
  automation: StoryAutomationState
  alterSystem?: AlterSystemState
  agencyWindow?: AgencyWindowState
  /** Small, evidence-backed roster emitted only by scene compaction. */
  scenePresence?: ScenePresenceState[]
  /** Recent completed background deliveries; hidden from live user turns. */
  automaticDeliverySummaries?: AutomaticDeliverySummary[]
}

export type ScenePresenceStatus = 'present' | 'off-scene' | 'expected'

export interface ScenePresenceState {
  name: string
  status: ScenePresenceStatus
  basis: string
  sourceEntryIds: number[]
  updatedAt: string
}

/** A bounded action-level reminder, never a second copy of chat history. */
export interface AutomaticDeliverySummary {
  participantId: string
  summary: string
  sourceEntryId?: number
  deliveredAt: string
}

/** Compact replace-in-place reminder of the protagonist's current state and notable threads. */
export interface ContinuitySnapshot {
  current: string
  next: string[]
  recent: string[]
  salient: string[]
}

/**
 * One character can maintain several relationships in the same main story.
 * This state belongs to one real person / account, rather than to the whole
 * world, so one conversation cannot accidentally overwrite another person's
 * relationship notes or pending messages.
 */
export interface ParticipantState {
  openThreads: string[]
  relationshipNotes: string[]
  relationshipOverlay?: string
  unreadMessageCount: number
  pendingReplyCount: number
  lastUserMessageAt?: string
  lastCharacterMessageAt?: string
}

export interface StoryAutomationState {
  /** 对话活跃期结束时间；在此之前只处理必要的到期意图，不补写日常生活。 */
  quietUntil?: string
  /** 下一次自动生活补写的最早时间。 */
  nextAdvanceAt?: string
  lastAutoAdvanceAt?: string
  lastUserMessageAt?: string
  /** Short continuity passes scheduled from the latest conversation endpoint. */
  conversationFollowUpAt?: string[]
  /** Relationship branch whose recent conversation supplies the 10/20-minute
   * continuity context. Omitted for ordinary background advancement. */
  conversationFollowUpParticipantId?: string
  urge?: UrgeState
}

export type AgencyActivityLoad = 'free' | 'occupied' | 'overloaded'
export type AgencyPrivacy = 'private' | 'shared' | 'public'
export type AgencyDeviceAccess = 'available' | 'limited' | 'unavailable'

export interface AgencyWindowState {
  activityLoad: AgencyActivityLoad
  privacy: AgencyPrivacy
  deviceAccess: AgencyDeviceAccess
  nextOpportunityAt?: string
  validUntil: string
  basis: string
  sourceEntryIds: number[]
  updatedAt: string
}

export type ProactiveContactOrigin = 'life-event' | 'promise' | 'practical-update' | 'relationship-follow-up'
export type ProactiveDisclosure = 'ordinary' | 'personal'
export type ProactiveOutcome = 'send-now' | 'recheck-later' | 'let-go'

export interface ProactiveContactDraft {
  participantId: string
  origin: ProactiveContactOrigin
  motive: string
  disclosure: ProactiveDisclosure
  sourceEntryIds?: number[]
  willingness?: number
  outcome: ProactiveOutcome
  notBefore?: string
  expiresAt?: string
}

export interface AgencyConfig {
  enabled: boolean
  maxWindowMinutes: number
  minimumProactiveIntervalMinutes: number
  maxCandidateHours: number
}

export interface StorySettingOverlay {
  characterProfile?: string
  /** Current accumulated expression of the separate perspective layer. */
  perspective?: string
  relationship?: string
  world?: string
  supportingCast?: string
  location?: string
  /** Small, accumulated trait changes expressed as evidence-backed notes. */
  characterTraits?: string[]
}

export interface InterludeStory {
  id: string
  platform: 'telegram'
  selfId: string
  userId: string
  channelId: string
  status: StoryStatus
  setting: StorySetting
  state: StoryState
  cursorAt: Date
  createdAt: Date
  updatedAt: Date
}

/** A private-message endpoint and its relationship branch inside one story. */
export interface InterludeParticipant {
  id: string
  storyId: string
  /** 'web' is a website visitor: userId and channelId are its visitorId. */
  platform: 'telegram' | 'web'
  selfId: string
  userId: string
  channelId: string
  /** Multiple accounts may deliberately share the same real-person id. */
  personId: string
  displayName: string
  profile: string
  relationship: string
  state: ParticipantState
  status: 'active' | 'paused'
  createdAt: Date
  updatedAt: Date
}

export interface ScriptEntry {
  id: number
  storyId: string
  /** Empty for world/system events; otherwise identifies the involved account. */
  participantId: string
  kind: string
  actor: string
  content: string
  occurredAt: Date
  metadata: Record<string, unknown>
  /** Transport outcome of a protagonist message that failed its first send; absent means delivered. */
  delivery?: DeliveryState
  /** Who may see this record; see memory/audience.ts. */
  audience: Audience
  createdAt: Date
}

/** pending: waiting for a delivery-retry; unknown: may or may not have arrived; sent: delivered by a retry. */
export type DeliveryState = 'pending' | 'failed' | 'unknown' | 'sent'

export type SceneStatus = 'active' | 'closed'

export interface InterludeScene {
  id: number
  storyId: string
  status: SceneStatus
  startedAt: Date
  endedAt: Date | null
  hook: string
  summary: string
  entryCount: number
  /** 最近一次已经被写入场景摘要的条目；下一轮只压缩它之后的新内容。 */
  lastEntryId: number | null
  /** Built from every entry, so always private; a public version is generated separately. */
  audience: Audience
  createdAt: Date
  updatedAt: Date
}

export interface InterludeArc {
  id: number
  storyId: string
  status: 'active' | 'closed'
  title: string
  summary: string
  sceneCount: number
  /** Public arc only: continuity and mood text written by the public digest. */
  continuity?: ContinuitySnapshot | null
  mood?: PublicMood | null
  audience: Audience
  createdAt: Date
  updatedAt: Date
}

export type StatePatchTarget = 'character' | 'perspective' | 'world' | 'relationship'
export type StatePatchStatus = 'proposed' | 'applied' | 'compacted' | 'rejected' | 'cleared'

export interface StatePatchProposal {
  /**
   * 压缩器提出、程序审核的变化，而不是对 canon 的直接写入。
   * 保留证据和状态可支持审计、人工确认与日后的重新评估。
   */
  id: number
  storyId: string
  participantId: string
  target: StatePatchTarget
  path: string
  proposedValue: string
  evidence: string
  confidence: number
  impact: 'minor' | 'major'
  status: StatePatchStatus
  sourceEntryIds: number[]
  audience: Audience
  createdAt: Date
  appliedAt: Date | null
}

/** A compressed, auditable layer of setting evolution. Raw applied patches
 * remain intact and are only marked compacted after a snapshot is stored. */
export interface OverlaySnapshot {
  id: number
  storyId: string
  participantId: string
  target: StatePatchTarget
  /** Kept as weekly/monthly for database compatibility; runtime windows are
   * five days and ten days respectively. */
  tier: 'weekly' | 'monthly'
  periodStart: Date
  periodEnd: Date
  summary: string
  majorEvents: string[]
  sourcePatchIds: number[]
  status: 'active' | 'superseded'
  audience: Audience
  createdAt: Date
  updatedAt: Date
}

export interface NarrativeFact {
  id: number
  storyId: string
  /** Empty means a world-wide fact; otherwise it is relationship-specific. */
  participantId: string
  scope: 'character' | 'world' | 'relationship' | 'event' | 'promise'
  content: string
  importance: number
  confidence: number
  unresolved: boolean
  status: 'active' | 'superseded'
  sourceEntryIds: number[]
  audience: Audience
  lastSeenAt: Date
  createdAt: Date
  updatedAt: Date
}

export type IntentStatus = 'pending' | 'completed' | 'cancelled'

export interface NarrativeIntent {
  id: number
  storyId: string
  /** Target private-message relationship for a future contact. */
  participantId: string
  type: string
  summary: string
  notBefore: Date
  status: IntentStatus
  payload: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

/** A bounded, read-only observation collected through local Chrome.
 * Web pages are untrusted source material: only the extracted text below is
 * sent back to the narrator, never page HTML, scripts, cookies, or actions. */
export interface WebObservation {
  id: number
  storyId: string
  /** Empty means a world-level observation; otherwise it belongs to one relationship. */
  participantId: string
  intentId: number | null
  mode: 'search' | 'visit'
  query: string
  url: string
  title: string
  excerpt: string
  summary: string
  status: 'success' | 'failed' | 'blocked' | 'deleted'
  accessedAt: Date
  createdAt: Date
}

export interface ScriptEntryDraft {
  kind: string
  actor?: string
  content: string
  occurredAt?: string
  metadata?: Record<string, unknown>
  delivery?: DeliveryState
}

export interface MemoryDraft { category: string; content: string; importance?: number; participantId?: string; audience?: ClassifiedAudience }
export interface IntentDraft { type: string; summary: string; notBefore: string; payload?: Record<string, unknown>; participantId?: string }
/** A narrator may close an active narrative consequence once the script has
 * naturally absorbed it. Scheduled intents complete through their due-turn
 * path, so this is deliberately limited to existing persistent context. */
export interface IntentUpdateDraft {
  id: number
  status: 'completed' | 'cancelled'
  resolution?: string
}
export interface OutgoingMessageDraft {
  participantId: string
  content: string
  /** Attached only to no-current-user background deliveries. */
  automaticDelivery?: Pick<AutomaticDeliverySummary, 'summary' | 'sourceEntryId'>
  /** The script entry already written for this message; a failed send is recorded on it. */
  entryId?: number
}

/** A future browsing action proposed by the narrator. It is not an observed
 * fact until Puppeteer finishes and produces a WebObservation. */
export interface BrowserIntentDraft {
  mode: 'search' | 'visit'
  query?: string
  url?: string
  purpose: string
  timing?: 'deferred' | 'immediate'
  participantId?: string
}

/** A message to another relationship branch generated in the same writing turn. */
export interface ConversationActionDraft {
  participantId: string
  mode: 'immediate' | 'delayed'
  content: string
  sendAt?: string
  /** 0..1: how strongly the protagonist actually wants to initiate contact now. */
  willingness?: number
  /** Short audit note explaining the concrete reason for this contact. */
  reason?: string
}

export type InteractionReplyMode = 'none' | 'immediate' | 'delayed'

export interface NarrativeInteraction {
  seen: boolean
  reply: {
    mode: InteractionReplyMode
    content?: string
    sendAt?: string
  }
}

export type FollowUpCommitmentKind = 'thinking' | 'checking' | 'decision' | 'emotional-settle'

/** A user-facing promise to return with an answer; persisted as an existing intent row. */
export interface FollowUpCommitmentDraft {
  kind: FollowUpCommitmentKind
  summary: string
  notBefore: string
  expiresAt?: string
  sourceEntryIds?: number[]
}

export interface FollowUpResolutionDraft {
  id: number
  outcome: 'fulfilled' | 'rescheduled' | 'cancelled'
  notBefore?: string
}

export interface NarrativeDecision {
  /** The continuous prose written by the main narrative model. */
  script?: string
  /** Net atmosphere movement introduced by this turn: -5 relaxed, +5 serious. */
  alter?: number
  /** Background passages only, when Urge is enabled: her current life rhythm, used for scheduling. */
  lifeRhythm?: LifeRhythm
  /** Optional external-action capacity update; it never controls prose style. */
  agencyWindow?: Partial<AgencyWindowState>
  /** Optional life-grounded contact decision for advance/proactive-check turns. */
  proactiveContact?: ProactiveContactDraft
  /** Present only when the request explicitly asks for a low-frequency continuity refresh. */
  continuity?: ContinuitySnapshot
  /** The machine-readable result placed after the prose. */
  interaction?: NarrativeInteraction
  /** Required when a visible user-turn reply promises a later answer. */
  followUpCommitment?: FollowUpCommitmentDraft
  /** Resolves a visible pending commitment on a live or due turn. */
  followUpResolutions?: FollowUpResolutionDraft[]
  /** Required only for an immediate background delivery; it records the newly communicated delta. */
  automaticDeliverySummary?: string
  memories?: MemoryDraft[]
  /** Advance passages only: the model's privacy label for the script itself; otherwise the host decides. */
  scriptAudience?: ClassifiedAudience
  intents?: IntentDraft[]
  /** Resolves existing active-consequence intents visible in this turn. */
  intentUpdates?: IntentUpdateDraft[]
  browserIntents?: BrowserIntentDraft[]
  /** Applies to the current participant only; world state uses compaction proposals. */
  statePatch?: Partial<ParticipantState>
  /** Optional outbound actions aimed at other accounts in the same main story. */
  crossConversationActions?: ConversationActionDraft[]
  /** Optional visible reply to the configured Telegram group that caused this turn. */
  groupReply?: {
    mode: 'none' | 'immediate'
    content?: string
  }
}

export type NarrativePhase = 'advance' | 'conversation-follow-up' | 'user-message' | 'intent-due'

/** A transient native-vision attachment for the current private-message turn.
 * It is intentionally never persisted in script entries, memories, or facts. */
export interface NarrativeImage {
  id: string
  mimeType: string
  dataUri: string
}

export interface NarrativeRequest {
  /** 主模型只读取经过预算控制的连续性包，不读取完整历史。 */
  phase: NarrativePhase
  /** Refresh the compact continuity note on this turn. */
  refreshContinuity?: boolean
  /** A prior unpublished draft omitted its required visible-reply structure. */
  outputRecovery?: boolean
  story: InterludeStory
  from: Date
  now: Date
  userMessage?: string
  /** Native image inputs observed in this one incoming user event only. */
  images?: NarrativeImage[]
  /** The relationship that caused this turn; null for unattended life updates. */
  participant: InterludeParticipant | null
  /** Other currently enrolled relationship branches, ordered by relevance. */
  participants: InterludeParticipant[]
  /** Sensitive details of other participants are opt-in because the model may be remote. */
  shareParticipantDetails: boolean
  dueIntents: NarrativeIntent[]
  /** Consequences already in motion. They are context, never newly due events. */
  activeConsequences: NarrativeIntent[]
  supersededIntents: NarrativeIntent[]
  recentEntries: ScriptEntry[]
  sceneContext?: SceneContext
  facts?: NarrativeFact[]
  /** Older setting evolution, separated from the live three-day overlay. */
  overlaySnapshots?: OverlaySnapshot[]
  /** Recent, safety-filtered web observations available as narrative context. */
  webContext?: WebObservation[]
  /** Present only for a group-scene turn; private-message privacy remains unchanged. */
  groupContext?: GroupContext
  alterEnabled?: boolean
  /** Ask background passages for lifeRhythm (Urge scheduling). */
  urgeEnabled?: boolean
  emotionalOffset?: EmotionalOffsetPrompt | null
  agencyEnabled?: boolean
  agencyWindow?: AgencyWindowState | null
  /** Present only for background advance/follow-up turns. */
  automaticDeliverySummaries?: AutomaticDeliverySummary[]
  /** At most two relationship-local promises, included only on live/due turns. */
  followUpCommitments?: NarrativeIntent[]
  /** Owner turns only: visitor records, rendered inside <visitor_notes> as quoted material. */
  visitorNotes?: VisitorNote[]
  /** Public turns only: memory.publicOwnerProfile, what may be said about the owner. */
  publicOwnerProfile?: string
}

export interface VisitorNote {
  audience: string
  source: 'script' | 'fact' | 'overlay'
  kind: string
  content: string
  occurredAt: string
}

export interface GroupMessageContext {
  senderId: string
  senderName: string
  content: string
  occurredAt: Date
  direction?: 'user' | 'character'
}

export interface GroupContext {
  groupId: string
  channelId: string
  label: string
  purpose: string
  characterRole: string
  messages: GroupMessageContext[]
}



export interface NarrativeProvider {
  /** tools is present only for turns whose tier allows tools (capabilities/loop.ts). */
  decide(request: NarrativeRequest, tools?: TurnTools): Promise<NarrativeDecision>
  /** A low-frequency side analysis; absent providers leave the trigger pending. */
  analyzeAlter?(request: AlterAnalysisRequest, config: AlterSystemConfig): Promise<AlterAnalysisDecision>
}

export const emptyStorySetting = (): StorySetting => ({
  character: { name: 'Unnamed character', profile: '' },
  user: { displayName: '', profile: '' },
  relationship: '', world: '', perspective: '', supportingCast: '', location: '',
  style: 'Realistic, restrained, and centered on ordinary life.',
  timezone: 'Asia/Shanghai',
})

export const emptyStoryState = (): StoryState => ({ settingOverlay: { characterTraits: [] }, automation: {}, narrativeUpdateCount: 0 })

export const emptyParticipantState = (): ParticipantState => ({
  openThreads: [], relationshipNotes: [], unreadMessageCount: 0, pendingReplyCount: 0,
})

export interface SceneContext {
  scene: InterludeScene | null
  arc: InterludeArc | null
}

export interface CompactionRequest {
  /**
   * 后台压缩只处理已发生、且尚未写进当前场景摘要的原始条目。
   * 它与主叙事回合分离，不能增加用户发送消息时的等待时间。
   */
  story: InterludeStory
  from: Date
  now: Date
  entries: ScriptEntry[]
  scene: InterludeScene | null
  arc: InterludeArc | null
  participants: InterludeParticipant[]
  facts: NarrativeFact[]
}

export interface FactDraft {
  scope: NarrativeFact['scope']
  participantId?: string
  content: string
  importance?: number
  confidence?: number
  unresolved?: boolean
  sourceEntryIds?: number[]
  audience?: ClassifiedAudience
}

export interface StatePatchDraft {
  target: StatePatchTarget
  participantId?: string
  path: string
  proposedValue: string
  evidence: string
  confidence?: number
  impact?: 'minor' | 'major'
  sourceEntryIds?: number[]
  audience?: ClassifiedAudience
}

export interface ScenePresenceDraft {
  name: string
  status: ScenePresenceStatus
  basis: string
  sourceEntryIds: number[]
}

export interface CompactionDecision {
  scene?: { hook?: string; summary?: string; close?: boolean; presence?: ScenePresenceDraft[] }
  arc?: { title?: string; summary?: string }
  facts?: FactDraft[]
  statePatches?: StatePatchDraft[]
}

export interface OverlayCompactionRequest {
  story: InterludeStory
  participant?: InterludeParticipant
  target: StatePatchTarget
  tier: OverlaySnapshot['tier']
  from: Date
  to: Date
  patches: StatePatchProposal[]
  snapshots?: OverlaySnapshot[]
}

export interface OverlayCompactionDecision {
  summary: string
  majorEvents?: string[]
}

/** Mood text for public turns; used only while the live Alter direction still matches. */
export interface PublicMood {
  direction: EmotionalOffset['direction']
  description: string
  generatedAt: string
}

/**
 * Input of the public digest (roadmap §4.6). Plain data only, built by
 * context/public.ts from public records: it deliberately has no story or
 * participant objects, whose state carries private derived layers.
 */
export interface PublicDigestRequest {
  interval: { from: string; now: string }
  canon: Record<string, unknown>
  settingOverlay: StorySettingOverlay
  scene: { hook: string; summary: string } | null
  arc: { title: string; summary: string } | null
  continuity: ContinuitySnapshot | null
  facts: Array<{ scope: string; content: string; importance: number; unresolved: boolean }>
  entries: Array<{ id: number; kind: string; actor: string; content: string; occurredAt: string }>
  mood: { direction: EmotionalOffset['direction']; intensity: number } | null
}

export interface PublicDigestDecision {
  scene?: { hook?: string; summary?: string; close?: boolean }
  arc?: { title?: string; summary?: string }
  continuity?: unknown
  mood?: string
}

/**
 * Nightly contradiction check (roadmap §4.8). Groups are opaque labels for
 * audience + relationship; the host only accepts a supersession inside one
 * group and by a newer fact.
 */
export interface FactConsolidationRequest {
  facts: Array<{ id: number; group: string; scope: string; content: string; createdAt: string }>
}

export interface FactConsolidationDecision {
  superseded?: Array<{ id: number; by: number }>
}

export interface NarrativeCompactor {
  compact(request: CompactionRequest): Promise<CompactionDecision>
  compactOverlay(request: OverlayCompactionRequest): Promise<OverlayCompactionDecision>
  compactPublic(request: PublicDigestRequest): Promise<PublicDigestDecision>
  consolidateFacts(request: FactConsolidationRequest): Promise<FactConsolidationDecision>
}

// ========== Alter System Types ==========

export interface AlterSystemState {
  alterValue: number
  alterWeight: number
  lastTriggerDirection: -1 | 0 | 1
  emotionalOffset: EmotionalOffset | null
  history: AlterHistoryEntry[]
  lastUpdatedAt: string
  lastAnalysisAttemptAt?: string
}

export interface EmotionalOffset {
  direction: 'serious' | 'relaxed'
  description: string
  intensity: number
  generatedAt: string
}

export interface EmotionalOffsetPrompt extends EmotionalOffset {
  weight: number
}

export interface AlterHistoryEntry {
  turn: number
  phase: NarrativePhase
  alter: number
  alterValue: number
  timestamp: string
}

export interface AlterAnalysisRequest {
  characterName: string
  triggerValue: number
  threshold: number
  direction: 'serious' | 'relaxed'
  recentScripts: Array<{ content: string; occurredAt: string }>
  history: AlterHistoryEntry[]
  settingOverlay: StorySettingOverlay
  currentOffset: EmotionalOffsetPrompt | null
}

export interface AlterAnalysisDecision {
  description: string
}

export interface AlterSystemConfig {
  enabled: boolean
  baseThreshold: number
  densityFactor: number
  sameDirectionBoost: number
  oppositeDecay: number
  minWeight: number
  maxIntensity: number
  model?: string
  temperature?: number
  maxTokens?: number
  timeout?: number
  prompt?: string
}
