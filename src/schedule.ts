import { RestWindow } from './config'
import { Time } from './runtime'
import { localClockMinutes } from './time'
import { InterludeStory, NarrativeIntent } from './types'
import { randomInteger } from './util'

/** Timing rules for automatic life advancement, rest windows and due intents. */

export interface AutoAdvanceConfig {
  enabled: boolean
  intervalMinutes: number
  jitterMinutes: number
  followUpMinutes: number[]
  followUpJitterMinutes: number
  restWindows: RestWindow[]
}

/** Keeps a single due-turn private to one relationship while ensuring that
 * every plan that was already due at the start of the sweep gets a chance to
 * be judged before the next sweep interval. */
export function groupDueIntents(intents: NarrativeIntent[]) {
  const batches = new Map<string, NarrativeIntent[]>()
  for (const intent of [...intents].sort((left, right) => left.notBefore.getTime() - right.notBefore.getTime() || left.id - right.id)) {
    const family = intent.type === 'proactive-check' ? 'agency' : 'normal'
    const key = `${intent.participantId || '__global__'}|${family}`
    const batch = batches.get(key) ?? []
    batch.push(intent)
    batches.set(key, batch)
  }
  return [...batches.values()]
}

export function automaticIntervalMinutes(story: InterludeStory, now: Date, config: AutoAdvanceConfig) {
  const restWindow = activeRestWindow(config.restWindows, story.setting.timezone, now)
  if (restWindow) return randomInteger(restWindow.minIntervalMinutes, restWindow.maxIntervalMinutes)
  return Math.max(1, config.intervalMinutes + randomInteger(-config.jitterMinutes, config.jitterMinutes))
}

export function normalizeFollowUpMinutes(values: number[] | undefined) {
  const defaults = [10, 20]
  const normalized = (Array.isArray(values) ? values : defaults)
    .map(value => Math.floor(Number(value)))
    .filter(value => Number.isFinite(value) && value >= 1 && value <= 240)
  return Array.from(new Set(normalized)).sort((left, right) => left - right).slice(0, 6)
}

export function scheduleConversationFollowUps(anchor: Date, config: AutoAdvanceConfig) {
  let previous = anchor.getTime()
  return config.followUpMinutes.map(minutes => {
    const jitter = config.followUpJitterMinutes
      ? randomInteger(-config.followUpJitterMinutes, config.followUpJitterMinutes)
      : 0
    // Never place a later configured pass before an earlier one, even when
    // jitter is enabled or the owner provides a close custom sequence.
    const at = Math.max(previous + 1_000, anchor.getTime() + Math.max(1, minutes + jitter) * Time.minute)
    previous = at
    return new Date(at)
  })
}

export function activeRestWindow(windows: RestWindow[], timezone: string, now: Date) {
  const localMinutes = localClockMinutes(now, timezone)
  return windows.find(window => {
    if (!window.enabled) return false
    const start = clockMinutes(window.start)
    const end = clockMinutes(window.end)
    if (start == null || end == null) return false
    return start <= end
      ? localMinutes >= start && localMinutes < end
      : localMinutes >= start || localMinutes < end
  })
}

export function clockMinutes(value: string) {
  const matched = /^(\d{1,2}):(\d{2})$/.exec(value?.trim())
  if (!matched) return undefined
  const hour = Number(matched[1])
  const minute = Number(matched[2])
  return hour >= 0 && hour < 24 && minute >= 0 && minute < 60 ? hour * 60 + minute : undefined
}
