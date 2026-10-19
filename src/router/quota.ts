import type { Storage } from '../database'
import { calendarDayKey } from '../time'

export const DEFAULT_DAILY_TURNS = 200
/** Fixed in-character answer once the quota is used up; no model call is made for it. */
export const QUOTA_REPLY = '今天聊得有点多，我先休息啦，明天再来找我吧。'

const LIMIT_KEY = 'quota.daily.limit'
const DAY_KEY = 'quota.daily.day'
const USED_KEY = 'quota.daily.used'

/**
 * One shared daily cap on non-owner turns (web visitors, other private chats,
 * group replies). Counting turns instead of tokens keeps it predictable without
 * a usage ledger. Stored in runtime_meta so a restart cannot reset the count;
 * the owner changes the limit with /quota.
 */
export class DailyQuota {
  private notified = new Set<string>()

  constructor(private storage: Storage, private timezone: () => string) {}

  get limit() {
    const raw = this.storage.getMeta(LIMIT_KEY)
    const value = Number(raw)
    return raw !== undefined && Number.isInteger(value) && value >= 0 ? value : DEFAULT_DAILY_TURNS
  }

  setLimit(limit: number) { this.storage.setMeta(LIMIT_KEY, String(limit)) }

  status(now = new Date()) {
    const day = calendarDayKey(now, this.timezone())
    const used = this.storage.getMeta(DAY_KEY) === day ? Number(this.storage.getMeta(USED_KEY)) || 0 : 0
    return { day, used, limit: this.limit }
  }

  /** Takes one turn; false once today's limit is used up. */
  take(now = new Date()) {
    const { day, used, limit } = this.status(now)
    if (used >= limit) return false
    this.storage.setMeta(DAY_KEY, day)
    this.storage.setMeta(USED_KEY, String(used + 1))
    return true
  }

  /** Returns a turn the core then refused, so a rejected message does not cost quota. */
  refund(now = new Date()) {
    const { day, used } = this.status(now)
    if (used <= 0) return
    this.storage.setMeta(DAY_KEY, day)
    this.storage.setMeta(USED_KEY, String(used - 1))
  }

  /** Seconds until the local day rolls over, for Retry-After. */
  secondsUntilReset(now = new Date()) {
    const today = calendarDayKey(now, this.timezone())
    // Step forward in 10-minute increments; avoids timezone arithmetic and is precise enough for a retry hint.
    let seconds = 600
    while (seconds < 26 * 3600 && calendarDayKey(new Date(now.getTime() + seconds * 1000), this.timezone()) === today) seconds += 600
    return seconds
  }

  /** True the first time a source is turned away today, so it gets one notice instead of one per message. */
  firstRefusal(sourceKey: string, now = new Date()) {
    const key = `${this.status(now).day}:${sourceKey}`
    if (this.notified.has(key)) return false
    if (this.notified.size > 5000) this.notified.clear()
    this.notified.add(key)
    return true
  }
}
