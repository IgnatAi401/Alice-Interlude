/** Small value helpers shared by the narrative modules. */

export function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) }

export function toDate(value: unknown) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

export function sameTimestamp(left: unknown, right: unknown) {
  const a = toDate(left)
  const b = toDate(right)
  return !!a && !!b && Math.abs(a.getTime() - b.getTime()) < 2_000
}

export function clip(value: unknown, length: number) { return typeof value === 'string' ? value.trim().slice(0, length) : '' }

export function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback
  return Math.max(min, Math.min(max, value))
}

export function normalizeFact(value: string) { return value.trim().toLocaleLowerCase().replace(/\s+/g, ' ') }

export function randomInteger(min: number, max: number) {
  const lower = Math.floor(Math.min(min, max))
  const upper = Math.floor(Math.max(min, max))
  return lower + Math.floor(Math.random() * (upper - lower + 1))
}
