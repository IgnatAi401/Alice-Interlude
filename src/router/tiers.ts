import type { InboundChannel } from './events'

/** What a turn is allowed to do; see dev/ROADMAP.md §2. */
export type Tier = 'owner' | 'public' | 'system'
/** Tiers an inbound message can have; 'system' is reserved for background turns. */
export type InboundTier = Exclude<Tier, 'system'>

/**
 * Fixed capability table. A tool must be both registered and listed here for
 * the tier, so a newly registered tool is unavailable until this table names it.
 * system 默认没有工具；频道发帖回合以后单独放开 web_fetch。
 */
export const TIER_TOOLS: Readonly<Record<Tier, readonly string[]>> = {
  owner: ['exec', 'read_skill', 'recall', 'web_fetch'],
  public: ['web_fetch'],
  system: [],
}

export function tierAllowsTool(tier: Tier, toolName: string) {
  return TIER_TOOLS[tier]?.includes(toolName) === true
}

/**
 * The single owner check. Only the channel and the transport-level source id
 * matter; message text never reaches this function. A web event cannot become
 * owner even when its visitor id happens to equal the owner chat id.
 */
export function resolveTier(channel: InboundChannel, sourceId: string, ownerChatId: string): InboundTier {
  return channel === 'telegram-private' && !!ownerChatId && sourceId === ownerChatId ? 'owner' : 'public'
}
