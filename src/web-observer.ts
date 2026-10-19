import { BrowserConfig, resolveBrowserConfig } from './config'
import { INTERLUDE_VERSION } from './meta'
import { Runtime, Time } from './runtime'
import { BrowserIntentDraft, IntentDraft, InterludeStory, NarrativeIntent, NarrativeRequest, ScriptEntryDraft, WebObservation } from './types'
import { clip } from './util'
import { browserIntentFromPayload, createPublicHostCheck, isSafePublicWebUrl, normalizeBrowserIntentDraft, resolveBrowserTarget, webObservationEntryContent } from './web-policy'

type LogLevel = 'error' | 'warn' | 'info' | 'debug'
type Verbosity = 'summary' | 'standard' | 'diagnostic'

/** What the web observer needs from the story service: storage, script writes, permissions and logging. */
export interface WebObserverHost {
  browserConfig(): Partial<BrowserConfig> | undefined
  shareParticipantDetails(): boolean
  browser(): Runtime['puppeteer']
  canUseParticipant(participantId: string): Promise<boolean>
  dbGet(table: string, query: unknown, options?: unknown): Promise<any[]>
  dbCreate(table: string, data: unknown): Promise<any>
  dbSet(table: string, query: unknown, data: unknown): Promise<unknown>
  appendEntry(storyId: string, entry: ScriptEntryDraft, now: Date, participantId?: string): Promise<unknown>
  appendIntent(storyId: string, intent: IntentDraft, now: Date, participantId?: string): Promise<unknown>
  report(level: LogLevel, story: InterludeStory, phase: NarrativeRequest['phase'], message: string, ...args: unknown[]): void
  reportOperation(verbosity: Verbosity, level: LogLevel, story: InterludeStory, phase: NarrativeRequest['phase'], message: string, ...args: unknown[]): void
  reportStandaloneOperation(verbosity: Verbosity, level: LogLevel, message: string, ...args: unknown[]): void
}

/** Optional, read-only web browsing through local Chrome, kept out of the story service. */
export class WebObserver {
  /** The browser is bounded separately from narrative work so a burst of
   * deferred intents cannot spawn an uncontrolled number of Chromium pages. */
  private browserActive = 0
  private browserWaiters: Array<() => void> = []

  constructor(private host: WebObserverHost) {}

  get config(): BrowserConfig { return resolveBrowserConfig(this.host.browserConfig()) }

  /** Returns only observations that are safe for this narration branch. A
   * participant's browsing is not shown to another private participant unless
   * the owner has explicitly enabled shared relationship details. */
  async observations(storyId: string, participantId?: string) {
    // Browsing is optional. Avoid a database read on every live turn when the
    // feature is disabled, which is the default for most installations.
    if (!this.config.enabled) return []
    const limit = Math.max(1, Math.min(this.config.maxObservationsInPrompt, 20))
    const rows = await this.host.dbGet('interlude_web_observation', { storyId }, {
      limit: Math.max(limit * 4, 20), sort: { accessedAt: 'desc' },
    })
    return rows
      // Failed/blocked attempts already have a terse script event. Keeping
      // their error text in every later prompt wastes tokens and can crowd
      // out useful successful observations.
      .filter(observation => observation.status === 'success')
      .filter(observation => this.host.shareParticipantDetails()
        || !observation.participantId || observation.participantId === (participantId ?? ''))
      .slice(0, limit)
      .reverse()
  }

  /** Stores a narrator-proposed browser action as a future intent. The model
   * never writes page content directly; a separate Puppeteer task creates the
   * observation later. */
  async planIntent(storyId: string, draft: BrowserIntentDraft, now: Date, fallbackParticipantId = '') {
    const config = this.config
    if (!config.enabled) return
    const normalized = normalizeBrowserIntentDraft(draft, config)
    if (!normalized) return
    // A model may describe a reason involving another person, but it may not
    // silently attach a web observation to another relationship branch. The
    // active participant owns a live-turn browse; unattended life browsing is
    // world-level. This is both a privacy boundary and a simpler mental model.
    const participantId = fallbackParticipantId
    if (participantId && !await this.host.canUseParticipant(participantId)) return
    const notBefore = new Date(now.getTime() + Time.second)
    await this.host.appendIntent(storyId, {
      type: 'browser-research',
      summary: clip(normalized.purpose, 500) || 'The character planned to read a public web page.',
      notBefore: notBefore.toISOString(),
      payload: {
        mode: normalized.mode,
        query: normalized.query ?? '',
        url: normalized.url ?? '',
        purpose: normalized.purpose,
      },
    }, now, participantId)
    this.host.reportStandaloneOperation('diagnostic', 'debug', '已创建网页浏览意图：故事=%s 模式=%s', storyId, normalized.mode)
  }

  /** Executes a due browser intent once, records its bounded observation, and
   * marks the future plan complete regardless of success. A failed browser is
   * still an event (the character could not access the page), but it never
   * blocks later dialogue or background life updates. */
  async executeDeferredIntent(story: InterludeStory, intent: NarrativeIntent, now: Date) {
    const payload = browserIntentFromPayload(intent.payload)
    const observation = await this.collect(story, payload, intent.participantId, intent.id, now)
    await this.host.dbSet('interlude_intent', { id: intent.id }, { status: 'completed', updatedAt: new Date() })
    return observation
  }

  /** Read a page through local Chrome. This is intentionally read-only:
   * it rejects non-public destinations, extracts visible text only, and closes
   * the page after every observation. */
  async collect(story: InterludeStory, draft: BrowserIntentDraft | null, participantId: string, intentId: number | null, now: Date, persist = true): Promise<WebObservation> {
    const config = this.config
    const normalized = draft ? normalizeBrowserIntentDraft(draft, config) : undefined
    if (!normalized || !config.enabled) {
      return this.save(story.id, participantId, intentId, normalized?.mode ?? 'visit', normalized?.query ?? '', normalized?.url ?? '', '', '', '浏览未执行：功能未启用或请求不符合安全规则。', 'blocked', now, persist)
    }

    const target = resolveBrowserTarget(normalized, config)
    if (!target) {
      this.host.report('warn', story, 'intent-due', '网页浏览被安全策略拦截：模式=%s', normalized.mode)
      return this.save(story.id, participantId, intentId, normalized.mode, normalized.query ?? '', normalized.url ?? '', '', '', '浏览目标未通过公开网页安全校验。', 'blocked', now, persist)
    }

    const cached = await this.findCached(story.id, participantId, normalized, now)
    if (cached) {
      if (!persist) return { ...cached, id: 0, intentId, accessedAt: now, createdAt: now }
      await this.host.appendEntry(story.id, {
        kind: 'web-observation', actor: 'system',
        content: `The character revisited a recent web observation: ${cached.title || cached.url}.`,
        occurredAt: now.toISOString(), metadata: { observationId: cached.id, cached: true, status: cached.status },
      }, now, participantId)
      return cached
    }

    const puppeteer = this.host.browser()
    if (!puppeteer?.page) {
      this.host.report('warn', story, 'intent-due', '网页浏览服务不可用：请检查 browser.enabled 和 macOS Chrome。')
      return this.save(story.id, participantId, intentId, normalized.mode, normalized.query ?? '', target, '', '', '浏览器服务不可用。', 'failed', now, persist)
    }

    return this.withBrowserSlot(async () => {
      let page: any
      try {
        page = await puppeteer.page()
        await page.setUserAgent(`Mozilla/5.0 (compatible; Alice-Interlude/${INTERLUDE_VERSION})`)
        const resolvesPublicly = createPublicHostCheck()
        if (!await resolvesPublicly(target)) throw new Error('目标域名解析到了内网地址。')
        await page.setRequestInterception(true)
        page.on('request', (request: any) => void (async () => {
          const resourceType = request.resourceType?.() ?? 'document'
          const requestUrl = request.url?.() ?? ''
          const allowedResource = ['document', 'stylesheet', 'script', 'xhr', 'fetch', 'image'].includes(resourceType)
          const allowedUrl = isSafePublicWebUrl(requestUrl, config) && await resolvesPublicly(requestUrl)
          await (allowedResource && allowedUrl ? request.continue() : request.abort('blocked'))
        })().catch(() => undefined))
        page.on('popup', (popup: any) => void popup.close().catch(() => undefined))
        await page.goto(target, { waitUntil: config.waitUntil, timeout: config.navigationTimeout })
        const finalUrl = String(page.url?.() ?? target)
        if (!isSafePublicWebUrl(finalUrl, config)) throw new Error('页面重定向到了不允许的地址。')
        const result = await page.evaluate(() => ({
          title: String(document.title || '').trim(),
          text: String(document.body?.innerText || '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim(),
        }))
        const text = clip(String(result?.text ?? ''), config.maxTextCharacters)
        const title = clip(String(result?.title ?? ''), 500)
        const excerpt = clip(text, config.maxExcerptCharacters)
        const summary = clip(`${title ? `${title}。` : ''}${excerpt}`, config.maxExcerptCharacters)
        const observation = await this.save(story.id, participantId, intentId, normalized.mode, normalized.query ?? '', finalUrl, title, excerpt, summary || '页面没有可提取的正文。', 'success', new Date(), persist)
        this.host.reportOperation('standard', 'info', story, 'intent-due', '网页读取完成 标题=%s 正文=%d字', title || '未命名页面', text.length)
        if (config.logObservationPreview) this.host.report('debug', story, 'intent-due', '网页观察节选：%s', excerpt)
        return observation
      } catch (error) {
        this.host.report('warn', story, 'intent-due', '网页读取失败：%s', error)
        return this.save(story.id, participantId, intentId, normalized.mode, normalized.query ?? '', target, '', '', `网页读取失败：${clip(String(error instanceof Error ? error.message : error), 500)}`, 'failed', new Date(), persist)
      } finally {
        if (page) await page.close().catch(() => undefined)
      }
    })
  }

  private async save(storyId: string, participantId: string, intentId: number | null, mode: 'search' | 'visit', query: string, url: string, title: string, excerpt: string, summary: string, status: WebObservation['status'], now: Date, persist = true): Promise<WebObservation> {
    const candidate: WebObservation = {
      id: 0, storyId, participantId, intentId, mode, query: clip(query, 500), url: clip(url, 2_000), title: clip(title, 500),
      excerpt: clip(excerpt, this.config.maxExcerptCharacters), summary: clip(summary, this.config.maxExcerptCharacters),
      status, accessedAt: now, createdAt: now,
    }
    if (!persist) return candidate
    const observation = await this.host.dbCreate('interlude_web_observation', candidate) as WebObservation
    await this.host.appendEntry(storyId, {
      kind: 'web-observation', actor: 'system',
      content: webObservationEntryContent(observation), occurredAt: now.toISOString(),
      metadata: { observationId: observation.id, status, mode, url: observation.url },
    }, now, participantId)
    return observation
  }

  /** Immediate browser reads are intentionally held in memory until the
   * final narrator result survives the stale-request check. This prevents an
   * obsolete two-second message burst from leaving a durable web event behind. */
  async persist(observation: WebObservation) {
    return this.save(
      observation.storyId, observation.participantId, observation.intentId, observation.mode,
      observation.query, observation.url, observation.title, observation.excerpt, observation.summary,
      observation.status, observation.accessedAt,
    )
  }

  private async findCached(storyId: string, participantId: string, draft: BrowserIntentDraft, now: Date) {
    const minutes = this.config.cacheMinutes
    if (minutes <= 0) return undefined
    const cutoff = new Date(now.getTime() - minutes * Time.minute)
    const rows = await this.host.dbGet('interlude_web_observation', { storyId, participantId, status: 'success' }, {
      limit: 20, sort: { accessedAt: 'desc' },
    })
    return rows.find(observation => observation.accessedAt >= cutoff
      && observation.mode === draft.mode
      && (draft.mode === 'search' ? observation.query === (draft.query ?? '') : observation.url === (draft.url ?? '')))
  }

  /** Runs a task while holding one of the bounded Chrome page slots. */
  async withBrowserSlot<T>(task: () => Promise<T>) {
    const max = Math.max(1, this.config.maxConcurrentPages)
    if (this.browserActive >= max) await new Promise<void>(resolve => this.browserWaiters.push(resolve))
    this.browserActive++
    try {
      return await task()
    } finally {
      this.browserActive--
      this.browserWaiters.shift()?.()
    }
  }
}
