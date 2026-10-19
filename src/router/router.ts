import type { AdapterInboundEvent, InboundEvent } from './events'
import type { DailyQuota } from './quota'
import { resolveTier } from './tiers'

export interface RouterOptions {
  /** Validated ALICE_OWNER_CHAT_ID. */
  ownerChatId: string
}

/** The only place where an event receives its trust tier. */
export function routeInbound(event: AdapterInboundEvent, options: RouterOptions): InboundEvent {
  return { ...event, tier: resolveTier(event.channel, event.sourceId, options.ownerChatId) }
}

/**
 * Checked after routing and before the core sees the event, so a refused
 * message never reaches the model. The owner is never limited.
 */
export function admitInbound(event: InboundEvent, quota: DailyQuota) {
  return event.tier === 'owner' || quota.take(event.receivedAt)
}
