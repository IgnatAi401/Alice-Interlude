import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { BrowserConfig } from './config'
import { BrowserIntentDraft, WebObservation } from './types'
import { clip, isRecord } from './util'

/** Model browsing requests: validation and the public-web safety policy. */

export function normalizeBrowserIntentDraftLoose(value: unknown): BrowserIntentDraft | undefined {
  if (!isRecord(value) || (value.mode !== 'search' && value.mode !== 'visit') || typeof value.purpose !== 'string') return undefined
  const query = typeof value.query === 'string' ? clip(value.query, 500) : ''
  const url = typeof value.url === 'string' ? clip(value.url, 2_000) : ''
  if (value.mode === 'search' && !query) return undefined
  if (value.mode === 'visit' && !url) return undefined
  return {
    mode: value.mode,
    ...(query ? { query } : {}), ...(url ? { url } : {}),
    purpose: clip(value.purpose, 500),
    timing: value.timing === 'immediate' ? 'immediate' : 'deferred',
    ...(typeof value.participantId === 'string' ? { participantId: value.participantId.trim() } : {}),
  }
}

export function normalizeBrowserIntentDraft(draft: BrowserIntentDraft, config: BrowserConfig): BrowserIntentDraft | undefined {
  const normalized = normalizeBrowserIntentDraftLoose(draft)
  if (!normalized) return undefined
  if (normalized.mode === 'search' && !config.allowSearch) return undefined
  if (normalized.mode === 'visit' && !config.allowVisit) return undefined
  return normalized
}

export function browserIntentFromPayload(payload: Record<string, unknown>): BrowserIntentDraft | null {
  return normalizeBrowserIntentDraftLoose({
    mode: payload?.mode,
    query: payload?.query,
    url: payload?.url,
    purpose: payload?.purpose || 'The character planned to read a public web page.',
    timing: 'deferred',
  }) ?? null
}

export function resolveBrowserTarget(draft: BrowserIntentDraft, config: BrowserConfig) {
  if (draft.mode === 'search') {
    const template = config.searchUrlTemplate?.trim()
    if (!template || !template.includes('{query}')) return undefined
    const target = template.replaceAll('{query}', encodeURIComponent(draft.query ?? ''))
    return isSafePublicWebUrl(target, config) ? target : undefined
  }
  return draft.url && isSafePublicWebUrl(draft.url, config) ? draft.url : undefined
}

export function isSafePublicWebUrl(value: string, config: BrowserConfig) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
    if (url.username || url.password) return false
    const host = url.hostname.toLowerCase().replace(/\.$/, '')
    if (!host || isPrivateHost(host)) return false
    const blocked = normalizeDomains(config.blockedDomains)
    const allowed = normalizeDomains(config.allowedDomains)
    if (blocked.some(domain => domainMatches(host, domain))) return false
    return !allowed.length || allowed.some(domain => domainMatches(host, domain))
  } catch {
    return false
  }
}

export function normalizeDomains(values: string[] | undefined) {
  return (values ?? []).map(value => String(value ?? '').trim().toLowerCase().replace(/^\.+|\.+$/g, '')).filter(Boolean)
}

export function domainMatches(host: string, domain: string) { return host === domain || host.endsWith(`.${domain}`) }

/** Name suffixes that only resolve inside a home or company network. */
const LOCAL_NAME_SUFFIXES = ['localhost', 'local', 'lan', 'home', 'internal', 'intranet', 'localdomain', 'home.arpa']

export function isPrivateHost(host: string) {
  if (isIP(host) === 4) return isPrivateIPv4(host)
  // Literal IPv6 addresses are not needed for public-web narration and are
  // safest treated as local/private destinations.
  if (host.includes(':')) return true
  // Single-label names such as http://router/ resolve on the local network.
  if (!host.includes('.')) return true
  return LOCAL_NAME_SUFFIXES.some(suffix => domainMatches(host, suffix))
}

function isPrivateIPv4(address: string) {
  const [a, b, c] = address.split('.').map(Number)
  return a === 0 || a === 10 || a === 127 || a >= 224
    || a === 100 && b >= 64 && b <= 127 // carrier-grade NAT, also used by Tailscale
    || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31
    || a === 192 && b === 168 || a === 192 && b === 0 && c === 0
    || a === 198 && (b === 18 || b === 19)
}

/** Classifies an address returned by DNS, which may be IPv4 or IPv6. */
export function isPrivateAddress(address: string) {
  const value = address.toLowerCase()
  if (isIP(value) === 4) return isPrivateIPv4(value)
  if (isIP(value) !== 6) return true
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(value)
  if (mapped) return isPrivateIPv4(mapped[1])
  return value === '::' || value === '::1' || /^(?:f[cd]|fe[89ab]|ff)/.test(value) || value.startsWith('::ffff:')
}

/**
 * A public-looking name can still point at a private address. Each page gets
 * one checker so repeated sub-resources reuse the lookup. Chrome resolves
 * names separately, so this narrows but cannot fully close DNS rebinding.
 */
export function createPublicHostCheck(lookup: (host: string) => Promise<string[]> = lookupAddresses) {
  const cache = new Map<string, Promise<boolean>>()
  return (url: string) => {
    let host: string
    try { host = new URL(url).hostname.toLowerCase().replace(/\.$/, '') } catch { return Promise.resolve(false) }
    if (isIP(host)) return Promise.resolve(!isPrivateHost(host))
    let result = cache.get(host)
    if (!result) {
      result = lookup(host).then(addresses => addresses.length > 0 && !addresses.some(isPrivateAddress), () => false)
      cache.set(host, result)
    }
    return result
  }
}

async function lookupAddresses(host: string) {
  return (await dnsLookup(host, { all: true, verbatim: true })).map(item => item.address)
}

export function webObservationEntryContent(observation: WebObservation) {
  if (observation.status === 'success') {
    const source = observation.title || observation.url || 'a public web page'
    // The full bounded excerpt is supplied through webContext. Keeping it out
    // of the ordinary script stream avoids duplicating tokens and prevents
    // page text from being mistaken for a first-party narrative instruction.
    return `The character read a public web page: ${source}.`
  }
  return `The character's attempted web lookup did not complete: ${clip(observation.summary, 800)}`
}
