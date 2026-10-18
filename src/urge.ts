import { UrgeConfig } from './config'
import { Time } from './runtime'

/**
 * Urge: elastic automatic-advance interval (roadmap 8, 穿插第三档).
 * interval = base / (conversation density factor × life rhythm factor).
 * Scheduling metadata only — never shown to the model, never a memory.
 */

export const LIFE_RHYTHMS = ['phone-focused', 'available', 'occupied', 'resting', 'asleep'] as const
export type LifeRhythm = typeof LIFE_RHYTHMS[number]

const RHYTHM_MULTIPLIERS: Record<LifeRhythm, number> = {
  'phone-focused': 1.4, available: 1, occupied: 0.7, resting: 0.5, asleep: 0.15,
}
const BUCKET = 2 * Time.minute
const DENSITY_WINDOW = 15 * Time.minute
const BUCKET_RETENTION = 4 * Time.hour
const RHYTHM_STALE = 2 * Time.hour

export interface UrgeState {
  /** Starts of 2-minute buckets that saw a private user message; merges typing bursts. */
  buckets: number[]
  rhythm?: LifeRhythm
  rhythmAt?: string
}

export function isLifeRhythm(value: unknown): value is LifeRhythm {
  return typeof value === 'string' && (LIFE_RHYTHMS as readonly string[]).includes(value)
}

export function normalizeUrgeState(value: unknown): UrgeState | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const buckets = Array.isArray(record.buckets)
    ? record.buckets.filter((item): item is number => typeof item === 'number' && Number.isFinite(item) && item > 0).slice(-120)
    : []
  return {
    buckets,
    ...(isLifeRhythm(record.rhythm) && typeof record.rhythmAt === 'string' ? { rhythm: record.rhythm, rhythmAt: record.rhythmAt } : {}),
  }
}

/** A private user message: count it, and wake her from a lying-down rhythm. */
export function urgeUserMessage(state: UrgeState | undefined, now: Date): UrgeState {
  const at = now.getTime()
  const bucket = Math.floor(at / BUCKET) * BUCKET
  const buckets = Array.from(new Set([...(state?.buckets ?? []), bucket]))
    .filter(item => at - item < BUCKET_RETENTION).sort((left, right) => left - right).slice(-120)
  const wakes = state?.rhythm === 'asleep' || state?.rhythm === 'resting'
  return {
    ...state, buckets,
    ...(wakes ? { rhythm: 'phone-focused' as const, rhythmAt: now.toISOString() } : {}),
  }
}

export function urgeRhythm(state: UrgeState | undefined, rhythm: LifeRhythm, now: Date): UrgeState {
  return { buckets: state?.buckets ?? [], rhythm, rhythmAt: now.toISOString() }
}

export function conversationDensity(state: UrgeState | undefined, now: Date, halfLifeMinutes: number) {
  const buckets = state?.buckets ?? []
  const last = buckets.at(-1)
  if (last === undefined) return 0
  const recent = buckets.filter(item => item >= last - DENSITY_WINDOW).length
  const decay = Math.pow(0.5, Math.max(0, now.getTime() - last) / (Math.max(5, halfLifeMinutes) * Time.minute))
  return Math.min(1, recent / 6) * decay
}

/** Interval in minutes for the regular cadence; follow-up passes keep their own timing. */
export function urgeIntervalMinutes(baseMinutes: number, state: UrgeState | undefined, now: Date, inRestWindow: boolean, config: Required<UrgeConfig>) {
  const density = conversationDensity(state, now, config.halfLifeMinutes)
  const densityFactor = 1 + density * (Math.max(1, config.activeMultiplier) - 1)
  const rhythmAt = state?.rhythmAt ? new Date(state.rhythmAt).getTime() : NaN
  const fresh = state?.rhythm && now.getTime() - rhythmAt < RHYTHM_STALE
  // Stale rhythm: the rest window is only a hint, multiplied rather than replacing the interval.
  const rhythmFactor = fresh ? RHYTHM_MULTIPLIERS[state.rhythm!] : inRestWindow ? Math.min(1, Math.max(0.05, config.restMultiplier)) : 1
  return {
    minutes: Math.max(1, Math.round(baseMinutes / (densityFactor * rhythmFactor))),
    density, rhythm: fresh ? state!.rhythm! : inRestWindow ? 'rest-window' : 'none',
  }
}
