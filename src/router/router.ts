import type { AdapterInboundEvent, InboundEvent } from './events'
import { resolveTier } from './tiers'

export interface RouterOptions {
  /** Validated ALICE_OWNER_CHAT_ID. */
  ownerChatId: string
}

/**
 * The only place where an event receives its trust tier.
 * 限流与 usage_ledger 预算检查以后也放在这里，在调用模型之前完成。
 */
export function routeInbound(event: AdapterInboundEvent, options: RouterOptions): InboundEvent {
  return { ...event, tier: resolveTier(event.channel, event.sourceId, options.ownerChatId) }
}
