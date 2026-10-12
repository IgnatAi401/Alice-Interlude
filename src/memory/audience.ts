import type { Tier } from '../router/tiers'

/**
 * Who may see a memory record (dev/ROADMAP.md §4.2). This file is the only
 * implementation of audience rules; check roadmap §10 before changing it.
 */
export type Audience = 'private' | 'public' | `visitor:${string}`
/** The only labels a model may assign; visitor audiences come from the host. */
export type ClassifiedAudience = 'private' | 'public'

export interface Viewer {
  tier: Tier
  /** Required for a visitor to see its own records, e.g. 'tg:123' or 'web:v_x'. */
  participantKey?: string
}

const VISITOR = /^visitor:[a-z][a-z-]*:[A-Za-z0-9_-]{1,128}$/

/** Stored or untrusted values: anything missing or malformed becomes private (S6). */
export function normalizeAudience(value: unknown): Audience {
  if (value === 'public' || value === 'private') return value
  return typeof value === 'string' && VISITOR.test(value) ? value as Audience : 'private'
}

/** Model output: only the exact string 'public' widens visibility. */
export function normalizeClassifiedAudience(value: unknown): ClassifiedAudience {
  return value === 'public' ? 'public' : 'private'
}

export function visitorAudience(participantKey: string): Audience {
  return normalizeAudience(`visitor:${participantKey}`)
}

export function visibleTo(audience: unknown, viewer: Viewer): boolean {
  if (viewer.tier === 'owner') return true
  const normalized = normalizeAudience(audience)
  if (normalized === 'public') return true
  return !!viewer.participantKey && normalized === `visitor:${viewer.participantKey}`
}

/**
 * SQL-side form of visibleTo for Storage.get: undefined means no restriction.
 * Rows without a valid label never match, which keeps the filter fail-closed.
 */
export function audienceFilter(viewer: Viewer): { $in: Audience[] } | undefined {
  if (viewer.tier === 'owner') return undefined
  const allowed: Audience[] = ['public']
  if (viewer.participantKey) allowed.push(visitorAudience(viewer.participantKey))
  return { $in: allowed.filter(audience => audience !== 'private') }
}

/**
 * Audience of a record derived from other records (facts, memories, patches).
 * Visitor content stays with that visitor and is never relabelled by a model;
 * mixing two visitors, or a visitor with private material, falls back to
 * private. Only records built purely from owner/public material use the
 * model's private/public classification.
 */
export function derivedAudience(sources: readonly unknown[], classified: unknown): Audience {
  const restricted = new Set(sources.map(normalizeAudience).filter(audience => audience !== 'public'))
  const visitors = [...restricted].filter(audience => audience.startsWith('visitor:'))
  if (visitors.length) return visitors.length === 1 && restricted.size === 1 ? visitors[0] : 'private'
  return normalizeClassifiedAudience(classified)
}
