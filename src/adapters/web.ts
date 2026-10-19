import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { WebConfig } from '../config'
import type { Storage } from '../database'
import type { AdapterInboundEvent } from '../router/events'
import { TokenBucket, checkLimits } from '../router/limits'
import { QUOTA_REPLY } from '../router/quota'
import { screenName } from './name-filter'
import { calendarDayKey } from '../time'
import type { VisitorNameReviewDecision } from '../types'

/**
 * Website adapter (dev/ROADMAP.md §5): a plain public HTTP API behind
 * api.ignat.ai/<basePath>. Everything arriving here is a public visitor; the
 * router assigns the tier and no request field can change it. Listens on
 * 127.0.0.1 only, so the Cloudflare Tunnel is the sole way in and
 * CF-Connecting-IP cannot be forged by a direct client.
 *
 * 不做人机验证和 cookie（2026-10-19 决定）：先 POST /api/visitor 申请 visitorId（身份号）
 * 和 visitorKey（密码），之后每次请求都带上这一对（密码放请求体或 X-Visitor-Key，只有 EventSource
 * 无法带头部才放查询串），不带一律 401。库里只存密码的哈希；身份号只隔离
 * 访客之间的记忆，任何访客都只有 public 权限。访客模式（guest）只发 g_ 码、不发密码，
 * 闲置 guestIdleMinutes 后作废，记录仍留在库里按 visitorTtlDays 删除。
 * 申请 v_ 码必须带姓名（g_ 码不能取名，固定叫“访客”+ 码的前 6 位），姓名与码绑定并作为发送者名字交给模型；每次设定或修改
 * 都先过本地违禁词库（name-filter.ts），没命中再经模型审查，不合格就不发码、不改名；每月成功修改次数受 renamesPerMonth 限制。
 */

/** How the core delivers a protagonist message to a visitor. */
export interface WebTransport {
  send(visitorId: string, text: string): Promise<void>
}

/** What /web needs: the transport plus opening and closing the port at runtime. */
export interface WebEndpoint extends WebTransport {
  readonly running: boolean
  start(): Promise<void>
  stop(): Promise<void>
}

export interface WebServerDeps {
  /** Routes and hands the event to the core; false when Alice cannot take it now, 'limited' when today's turn quota is used up. */
  receive(event: AdapterInboundEvent): Promise<boolean | 'limited'>
  /** Seconds until the daily quota resets, sent as Retry-After. */
  quotaResetSeconds(): number
  /** Model review of a visitor name; throws when the review cannot run. */
  reviewName(name: string): Promise<VisitorNameReviewDecision>
  /** Story timezone; rename limits reset on its calendar month. */
  timezone: string
  characterName: string
  visitorTtlDays: number
}

interface ChatMessage { id: string; role: 'visitor' | 'alice'; text: string; at: string }
interface WebMessageRow { id: number; visitorId: string; role: ChatMessage['role']; text: string; clientId?: string; createdAt: string }
interface Stream { visitorId: string; res: ServerResponse }
type VisitorRow = {
  id: string; createdAt: string; lastSeenAt: string
  /** Set by the first accepted message; identities without it are dropped once idle for a day. */
  chatted?: true
} & (
  | { guest: true }
  /** Successful renames in renameMonth (YYYY-MM). */
  | { guest?: undefined; keyHash: string; name: string; renameMonth?: string; renameCount?: number }
)

/** v codes and keys may be typed by hand to recover a chat: short, case-insensitive, no 0/O/1/I/L. */
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
const VISITOR_ID = /^v_[2-9A-HJKMNP-Z]{8}$/
const VISITOR_KEY = /^[2-9A-HJKMNP-Z]{8}$/
/** Guest codes are the only credential and never typed, so they stay long and random. */
const GUEST_ID = /^g_[A-Za-z0-9_-]{22}$/
const MAX_BODY = 8 * 1024
const MAX_TEXT = 2000
const MAX_NAME = 24
const HISTORY_LIMIT = 200
const PING_MS = 25_000
/** A turn may end without a reply (delayed or none); do not leave "typing" on forever. */
const TYPING_TIMEOUT_MS = 90_000
/** An identity that never sent a message is dropped after this long without any request. */
const UNUSED_VISITOR_MS = 24 * 3_600_000
const TABLE = 'interlude_web_message'
const VISITORS = 'interlude_web_visitor'

class HttpError extends Error {
  constructor(public status: number, message: string, public headers: Record<string, string> = {}, public body: Record<string, string> = {}) { super(message) }
}

export class WebServer implements WebEndpoint {
  private server?: Server
  private streams = new Set<Stream>()
  private typingTimers = new Map<string, NodeJS.Timeout>()
  private intervals: NodeJS.Timeout[] = []
  private perMinute: TokenBucket
  private perHour: TokenBucket
  private perIpMinute: TokenBucket
  private perIp: TokenBucket
  // Short keys rely on these: a code can be guessed at most 10 times an hour, whatever the number of IPs.
  private failedPerIp = new TokenBucket(20, 3_600_000)
  private failedPerId = new TokenBucket(10, 3_600_000)
  private readonly startedAt = new Date()
  /** One rename at a time per visitor, so concurrent requests cannot both pass the monthly check. */
  private renaming = new Set<string>()

  constructor(private config: WebConfig, private storage: Storage, private deps: WebServerDeps) {
    this.perMinute = new TokenBucket(config.perVisitorPerMinute, 60_000)
    this.perHour = new TokenBucket(config.perVisitorPerHour, 3_600_000)
    this.perIpMinute = new TokenBucket(config.perIpPerMinute, 60_000)
    this.perIp = new TokenBucket(config.perIpPerHour, 3_600_000)
  }

  get running() { return !!this.server }

  async start() {
    if (this.server) return
    const server = createServer((req, res) => void this.handle(req, res))
    server.requestTimeout = 30_000
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(this.config.port, '127.0.0.1', () => { server.off('error', reject); resolve() })
    })
    this.server = server
    this.intervals.push(setInterval(() => { for (const stream of this.streams) stream.res.write(': ping\n\n') }, PING_MS))
    this.intervals.push(setInterval(() => {
      for (const bucket of [this.perMinute, this.perHour, this.perIpMinute, this.perIp, this.failedPerIp, this.failedPerId]) bucket.prune()
      void this.pruneVisitors().catch(() => console.warn('访客身份清理失败。'))
    }, 3_600_000))
  }

  async stop() {
    for (const timer of [...this.intervals, ...this.typingTimers.values()]) clearInterval(timer)
    this.intervals = []
    this.typingTimers.clear()
    for (const stream of this.streams) stream.res.end()
    this.streams.clear()
    const server = this.server
    this.server = undefined
    if (server) await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections() })
  }

  /** WebTransport: the transcript row is written first, so an offline visitor still gets it from /api/history. */
  async send(visitorId: string, text: string) {
    const row = await this.storage.create(TABLE, { visitorId, role: 'alice', text, createdAt: new Date() }) as WebMessageRow
    this.push(visitorId, 'message', toChatMessage(row))
    this.setTyping(visitorId, false)
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const base = this.config.basePath
      if (url.pathname === base || url.pathname === `${base}/`) return this.page(req, res, alicePage(this.deps, this.config, this.startedAt))
      if (url.pathname === '/' && this.config.serveRootPage) return this.page(req, res, rootPage(base))
      if (url.pathname.startsWith(`${base}/api/`)) return await this.api(req, res, url.pathname.slice(`${base}/api`.length), url.searchParams)
      throw new HttpError(404, 'Not found')
    } catch (error) {
      if (res.headersSent) { res.end(); return }
      const status = error instanceof HttpError ? error.status : 500
      if (!(error instanceof HttpError)) console.warn('网站接口处理失败。', error instanceof Error ? error.message : '')
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...(error instanceof HttpError ? error.headers : {}) })
      res.end(JSON.stringify({ error: status === 500 ? 'Internal error' : (error as Error).message, ...(error instanceof HttpError ? error.body : {}) }))
    }
  }

  private page(req: IncomingMessage, res: ServerResponse, html: string) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed', { Allow: 'GET, HEAD' })
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      // Static page with no scripts; the host is shared with other services (roadmap §5.1).
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-cache',
    })
    res.end(req.method === 'HEAD' ? undefined : html)
  }

  private async api(req: IncomingMessage, res: ServerResponse, route: string, query: URLSearchParams) {
    res.setHeader('X-Robots-Tag', 'noindex')
    res.setHeader('Cache-Control', 'no-store')
    // No cookies or other credentials, so any site or script may call it; there is nothing to forge.
    res.setHeader('Access-Control-Allow-Origin', '*')
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type, X-Visitor-Key', 'Access-Control-Max-Age': '86400',
      })
      res.end()
      return
    }
    const routes: Record<string, [string, () => Promise<void>]> = {
      '/visitor': ['POST', () => this.postVisitor(req, res)],
      '/name': ['POST', () => this.postName(req, res)],
      '/message': ['POST', () => this.postMessage(req, res)],
      '/history': ['GET', async () => this.history(res, await this.authorize(req, query.get('visitorId'), req.headers['x-visitor-key']))],
      '/events': ['GET', async () => this.events(req, res, (await this.authorize(req, query.get('visitorId'), query.get('visitorKey'))).id)],
    }
    const match = routes[route]
    if (!match) throw new HttpError(404, 'Not found')
    if (req.method !== match[0]) throw new HttpError(405, 'Method not allowed', { Allow: match[0] })
    await match[1]()
  }

  /** Issues a new identity; the IP limit runs first, so it caps new identities too. */
  private async postVisitor(req: IncomingMessage, res: ServerResponse) {
    const body = await readJson(req)
    const ip = clientIp(req)
    const guest = body.guest === true
    const name = cleanName(body.name)
    // A full code needs a name; a guest is always named after its code and cannot choose one.
    if (guest && name) throw new HttpError(400, 'Guest codes cannot have a name', {}, { code: 'guest_no_name' })
    if (!name && !guest) throw new HttpError(400, `name is required (1-${MAX_NAME} characters)`)
    this.limit([[this.perIpMinute, ip], [this.perIp, ip]])
    if (name) await this.reviewName(name)
    const { visitorId, visitorKey } = await this.createVisitor(guest, name)
    json(res, 201, guest
      ? { visitorId, name: guestName(visitorId), renamesLeft: 0 }
      : { visitorId, visitorKey, name, renamesLeft: this.config.renamesPerMonth })
  }

  /** Changes the bound name; every successful change counts toward the month. */
  private async postName(req: IncomingMessage, res: ServerResponse) {
    const body = await readJson(req)
    const name = cleanName(body.name)
    if (!name) throw new HttpError(400, `name must be 1-${MAX_NAME} characters`)
    const ip = clientIp(req)
    const row = await this.authorize(req, body.visitorId, body.visitorKey)
    if (row.guest) throw new HttpError(403, 'Guest codes cannot have a name', {}, { code: 'guest_no_name' })
    if (this.renaming.has(row.id)) throw new HttpError(409, 'A name change is already in progress')
    this.renaming.add(row.id)
    try {
      if (row.name === name) return json(res, 200, { name, renamesLeft: this.renamesLeft(row) })
      if (this.renamesLeft(row) <= 0) throw new HttpError(429, 'Monthly name change limit reached', {}, { code: 'rename_limit', renamesLeft: '0' })
      // Every attempt costs a model call, so it shares the visitor and IP limits with messages.
      this.limit([[this.perMinute, row.id], [this.perHour, row.id], [this.perIpMinute, ip], [this.perIp, ip]])
      await this.reviewName(name)
      const month = this.month()
      const update = { name, renameMonth: month, renameCount: (row.renameMonth === month ? row.renameCount ?? 0 : 0) + 1 }
      await this.storage.set(VISITORS, { id: row.id }, update)
      json(res, 200, { name, renamesLeft: this.renamesLeft({ ...row, ...update }) })
    } finally {
      this.renaming.delete(row.id)
    }
  }

  /** Word list first, then the model. 422 with the reviewer's reason when refused; 503 when the review itself fails, so no name passes unchecked. */
  private async reviewName(name: string) {
    // Clear cases are settled locally without spending a model call.
    const screened = screenName(name, this.deps.characterName)
    if (screened?.allowed) return
    if (screened) throw new HttpError(422, 'Name rejected', {}, { code: 'name_rejected', reason: screened.reason ?? '这个名字不能使用' })
    let review: VisitorNameReviewDecision
    try {
      review = await this.deps.reviewName(name)
    } catch (error) {
      console.warn('访客姓名审查失败。', error instanceof Error ? error.message : '')
      throw new HttpError(503, 'Name review is not available right now', {}, { code: 'name_review_unavailable' })
    }
    if (!review.allowed) throw new HttpError(422, 'Name rejected', {}, { code: 'name_rejected', reason: review.reason || '这个名字不能使用' })
  }

  private month(now = new Date()) { return calendarDayKey(now, this.deps.timezone).slice(0, 7) }

  private renamesLeft(row: VisitorRow) {
    if (row.guest) return 0
    const used = row.renameMonth === this.month() ? row.renameCount ?? 0 : 0
    return Math.max(0, this.config.renamesPerMonth - used)
  }

  /** A new visitor. A full visitor's key is returned once and only its hash is stored; a guest gets no key. */
  private async createVisitor(guest: boolean, name: string) {
    const now = new Date()
    for (let attempt = 0; ; attempt++) {
      const visitorId = guest ? `g_${randomBytes(16).toString('base64url')}` : `v_${randomCode(8)}`
      const visitorKey = guest ? undefined : randomCode(8)
      try {
        await this.storage.create(VISITORS, { id: visitorId, ...(visitorKey ? { keyHash: hashKey(visitorKey), name } : { guest: true }), createdAt: now, lastSeenAt: now })
        return { visitorId, visitorKey }
      } catch (error) {
        // The id is the primary key; a short v code can collide, so draw again.
        if (attempt >= 4) throw error
      }
    }
  }

  /**
   * 401 for an unknown id, a wrong key or an expired guest code, with one
   * message for the first two so ids cannot be probed. Failures are counted
   * per IP and per code; past the limit the caller gets 429 before any check.
   */
  private async authorize(req: IncomingMessage, rawId: unknown, rawKey: unknown) {
    // No code at all is a client that skipped /api/visitor, not a guess; it is not counted as a failure.
    if (rawId === undefined || rawId === null || rawId === '') throw new HttpError(401, 'visitorId is required; get one from POST /api/visitor')
    const ip = clientIp(req)
    const visitorId = normalizeVisitorId(rawId)
    const retryAfter = Math.max(this.failedPerIp.wait(ip), visitorId ? this.failedPerId.wait(visitorId) : 0)
    if (retryAfter) throw new HttpError(429, 'Too many failed attempts', { 'Retry-After': String(retryAfter) })
    const fail = (): never => {
      this.failedPerIp.take(ip)
      if (visitorId) this.failedPerId.take(visitorId)
      throw new HttpError(401, 'visitorId or visitorKey is wrong')
    }
    if (!visitorId) return fail()
    const [row] = await this.storage.get(VISITORS, { id: visitorId }, { limit: 1 }) as VisitorRow[]
    const now = new Date()
    if (row?.guest) {
      if (now.getTime() - new Date(row.lastSeenAt).getTime() > this.config.guestIdleMinutes * 60_000) {
        // The code stops working; its chat and memories stay until visitorTtlDays.
        await this.storage.remove(VISITORS, { id: visitorId })
        throw new HttpError(401, 'Guest code expired')
      }
    } else {
      const key = typeof rawKey === 'string' ? rawKey.trim().toUpperCase() : ''
      const expected = Buffer.from(row?.keyHash ?? hashKey(''), 'hex'), actual = Buffer.from(hashKey(key), 'hex')
      if (!row || !VISITOR_KEY.test(key) || !timingSafeEqual(expected, actual)) return fail()
    }
    await this.storage.set(VISITORS, { id: visitorId }, { lastSeenAt: now })
    return row
  }

  /** Hourly: idle guest codes expire, and identities that never chatted are dropped once idle for a day. */
  private async pruneVisitors() {
    const now = Date.now()
    await this.storage.remove(VISITORS, { guest: true, lastSeenAt: { $lte: new Date(now - this.config.guestIdleMinutes * 60_000) } })
    await this.storage.remove(VISITORS, { chatted: null, lastSeenAt: { $lte: new Date(now - UNUSED_VISITOR_MS) } })
  }

  private async history(res: ServerResponse, visitor: VisitorRow) {
    const rows = await this.storage.get(TABLE, { visitorId: visitor.id }, { sort: { id: 'desc' }, limit: HISTORY_LIMIT }) as WebMessageRow[]
    json(res, 200, { visitorId: visitor.id, name: visitorName(visitor), renamesLeft: this.renamesLeft(visitor), messages: rows.reverse().map(toChatMessage) })
  }

  private async postMessage(req: IncomingMessage, res: ServerResponse) {
    const body = await readJson(req)
    const text = typeof body.text === 'string' ? body.text.trim() : ''
    if (!text || text.length > MAX_TEXT) throw new HttpError(400, `text must be 1-${MAX_TEXT} characters`)
    const ip = clientIp(req)
    const visitor = await this.authorize(req, body.visitorId, body.visitorKey)
    const visitorId = visitor.id
    const clientId = typeof body.clientId === 'string' && /^[\w-]{1,64}$/.test(body.clientId) ? body.clientId : undefined
    if (clientId) {
      // A network retry of an accepted message must not start a second turn.
      const [seen] = await this.storage.get(TABLE, { visitorId, clientId }, { limit: 1 }) as WebMessageRow[]
      if (seen) return json(res, 202, { id: String(seen.id), visitorId })
    }
    this.limit([[this.perMinute, visitorId], [this.perHour, visitorId], [this.perIpMinute, ip], [this.perIp, ip]])
    const now = new Date()
    const row = await this.storage.create(TABLE, { visitorId, role: 'visitor', text, ...(clientId ? { clientId } : {}), createdAt: now }) as WebMessageRow
    const accepted = await this.deps.receive({
      channel: 'web', sourceId: visitorId, participantKey: `web:${visitorId}`,
      senderId: visitorId, senderName: visitorName(visitor), messageId: String(row.id),
      text, receivedAt: now, reply: { send: content => this.send(visitorId, content) },
    }).catch(error => {
      console.warn('网站消息交给核心失败。', error instanceof Error ? error.message : '')
      return false
    })
    if (accepted !== true) await this.storage.remove(TABLE, { id: row.id })
    if (accepted === 'limited') {
      throw new HttpError(429, 'Daily limit reached', { 'Retry-After': String(this.deps.quotaResetSeconds()) }, { code: 'daily_limit', reply: QUOTA_REPLY })
    }
    if (!accepted) throw new HttpError(503, 'Alice is not available right now')
    if (!visitor.chatted) await this.storage.set(VISITORS, { id: visitorId }, { chatted: true })
    this.setTyping(visitorId, true)
    json(res, 202, { id: String(row.id), visitorId })
  }

  private async events(req: IncomingMessage, res: ServerResponse, visitorId: string) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      // no-transform stops Cloudflare from buffering or compressing the stream.
      'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
    })
    res.write('retry: 5000\n\n')
    const stream: Stream = { visitorId, res }
    const own = [...this.streams].filter(item => item.visitorId === visitorId)
    for (const old of own.slice(0, Math.max(0, own.length - this.config.maxStreamsPerVisitor + 1))) {
      old.res.end()
      this.streams.delete(old)
    }
    this.streams.add(stream)
    req.on('close', () => this.streams.delete(stream))
  }

  private push(visitorId: string, event: string, data: unknown) {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    for (const stream of this.streams) if (stream.visitorId === visitorId) stream.res.write(frame)
  }

  private setTyping(visitorId: string, active: boolean) {
    const timer = this.typingTimers.get(visitorId)
    if (timer) clearTimeout(timer)
    this.typingTimers.delete(visitorId)
    if (active) this.typingTimers.set(visitorId, setTimeout(() => this.setTyping(visitorId, false), TYPING_TIMEOUT_MS))
    // Only a change is worth an event; send() calls this after every bubble.
    if (active || timer) this.push(visitorId, 'typing', { active })
  }

  private limit(checks: Array<[TokenBucket, string]>) {
    const retryAfter = checkLimits(checks)
    if (retryAfter) throw new HttpError(429, 'Too many requests', { 'Retry-After': String(retryAfter) })
  }
}

/**
 * Guests cannot pick a name: they are 访客 plus the first six characters of
 * their code. Only a prefix, because the whole code is the guest's credential
 * and this name lands in prompts and stored records.
 */
function guestName(visitorId: string) { return `访客${visitorId.slice(2, 8)}` }

function visitorName(row: VisitorRow) { return row.guest ? guestName(row.id) : row.name }

function hashKey(key: string) { return createHash('sha256').update(key).digest('hex') }

/** Uniform over CODE_ALPHABET: bytes past the last full multiple of its length are redrawn. */
function randomCode(length: number) {
  const limit = 256 - 256 % CODE_ALPHABET.length
  let code = ''
  while (code.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte < limit && code.length < length) code += CODE_ALPHABET[byte % CODE_ALPHABET.length]
    }
  }
  return code
}

/** v codes are typed by hand, so case is ignored; guest codes must match exactly. Undefined when malformed. */
function normalizeVisitorId(value: unknown) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (GUEST_ID.test(trimmed)) return trimmed
  const visitor = `v_${trimmed.replace(/^v_/i, '').toUpperCase()}`
  return /^v_/i.test(trimmed) && VISITOR_ID.test(visitor) ? visitor : undefined
}

/** Only the tunnel's header is trusted: the server listens on loopback, so no client reaches it directly. */
function clientIp(req: IncomingMessage) {
  const header = req.headers['cf-connecting-ip']
  return (typeof header === 'string' && header.trim()) || 'local'
}

/** '' when missing, empty after cleaning or too long; a long name is refused rather than cut, so what was reviewed is what is kept. */
function cleanName(value: unknown) {
  if (typeof value !== 'string') return ''
  const name = value.replace(/[\p{Cc}\p{Cf}<>]/gu, '').replace(/\s+/g, ' ').trim()
  return Array.from(name).length <= MAX_NAME ? name : ''
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) throw new HttpError(415, 'Content-Type must be application/json')
  if (Number(req.headers['content-length'] ?? 0) > MAX_BODY) throw new HttpError(413, 'Body too large')
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) throw new HttpError(413, 'Body too large')
    chunks.push(chunk)
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (value && typeof value === 'object' && !Array.isArray(value)) return value
  } catch {}
  throw new HttpError(400, 'Invalid JSON')
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function toChatMessage(row: WebMessageRow): ChatMessage {
  return { id: String(row.id), role: row.role, text: row.text, at: new Date(row.createdAt).toISOString() }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
}

// 说明页只读配置和进程状态，不读任何记忆表（roadmap 5.6、S14）。
function pageShell(title: string, body: string) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${escapeHtml(title)}</title><style>
:root{color-scheme:light dark;--bg:#f7f5f2;--fg:#1f1d1a;--muted:#6b665e;--line:#ddd7cf;--accent:#8a5a3c}
@media (prefers-color-scheme:dark){:root{--bg:#161514;--fg:#ece8e2;--muted:#a39d93;--line:#34312d;--accent:#d9a37f}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.7 -apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB",sans-serif}
main{max-width:36rem;margin:0 auto;padding:4rem 1rem}h1{font-size:1.6rem;margin:0 0 .25rem}a{color:var(--accent)}
.muted{color:var(--muted)}.dot{display:inline-block;width:.55rem;height:.55rem;border-radius:50%;background:#3fae6a;margin-right:.4rem}
section{border-top:1px solid var(--line);margin-top:2rem;padding-top:1rem}ul{padding-left:1.2rem}code{font-size:.9em}
</style></head><body><main>${body}</main></body></html>`
}

function alicePage(deps: WebServerDeps, config: WebConfig, startedAt: Date) {
  const name = escapeHtml(deps.characterName)
  const site = escapeHtml(config.siteUrl)
  const retention = deps.visitorTtlDays > 0 ? `访客记录保存 ${deps.visitorTtlDays} 天后删除。` : ''
  return pageShell(`${deps.characterName} · 接口`, `<h1>${name}</h1><p class="muted">这里是 ${name} 的接口入口，不是聊天页面。</p>
<p><span class="dot"></span>在线 <span class="muted">· 自 ${escapeHtml(startedAt.toISOString().slice(0, 16).replace('T', ' '))} UTC 起运行</span></p>
${site ? `<p>想和她说话，请前往 <a href="${site}">${site.replace(/^https?:\/\//, '')}</a>。</p>` : ''}
<section><h2>告知</h2><p>对话会被保存，站长可以查看。${retention}</p></section>`)
}

function rootPage(basePath: string) {
  return pageShell('api.ignat.ai', `<h1>api.ignat.ai</h1><p class="muted">这里是接口服务入口，按路径区分服务。</p>
<section><ul><li><a href="${escapeHtml(basePath)}/"><code>${escapeHtml(basePath)}/</code></a> · Alice</li></ul></section>`)
}
