import type { AdapterInboundEvent, InboundEvent } from './events'

/**
 * The only place where an event receives its trust tier.
 * 阶段 0 还没有 ALICE_OWNER_CHAT_ID，因此一律按 public 处理（fail-closed）；
 * 目前没有任何代码读取 tier，阶段 1 在这里加入 owner 判定、限流与预算。
 */
export function routeInbound(event: AdapterInboundEvent): InboundEvent {
  return { ...event, tier: 'public' }
}
