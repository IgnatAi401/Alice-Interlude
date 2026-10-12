/**
 * Channel-independent message types. Adapters translate platform payloads into
 * these shapes so the narrative core never depends on a specific transport.
 */

export type InboundChannel = 'telegram-private' | 'telegram-group' | 'web'
export type OutboundChannel = InboundChannel | 'telegram-channel'

/** What a turn is allowed to do; see dev/ROADMAP.md §2. */
export type Tier = 'owner' | 'public'

/** Adapter-private way back to where an event came from. */
export interface ReplyHandle {
  send(text: string): Promise<unknown>
}

export interface InboundEvent {
  channel: InboundChannel
  /** Unique within the channel: Telegram chat id, web visitorId, etc. */
  sourceId: string
  /** Assigned only by router.ts; adapters and message content cannot set it. */
  tier: Tier
  /** Stable cross-channel key such as 'tg:123456' or 'web:v_xxx'. */
  participantKey: string
  senderId: string
  senderName: string
  /** Platform message id, kept for script metadata. */
  messageId?: string
  text: string
  /** Image attachments as data: URIs; the core decodes and filters them. */
  imageSources?: string[]
  voiceCount?: number
  receivedAt: Date
  reply: ReplyHandle
}

/** Adapters produce events without a tier, so the type system keeps tier assignment in the router. */
export type AdapterInboundEvent = Omit<InboundEvent, 'tier'>

export interface OutboundMessage {
  channel: OutboundChannel
  /** Delivery target within the channel; checked against that channel's allowlist before sending. */
  targetId: string
  text: string
}
