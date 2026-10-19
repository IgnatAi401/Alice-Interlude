import { DEFAULT_ALTER_SYSTEM_CONFIG } from './alter'
import { GroupWillingnessConfig } from './group-willingness'
import { MODEL_NAME_PATTERN, ModelConfig } from './narrator'
import { AgencyConfig, AlterSystemConfig } from './types'

export interface Config {
  /** Immersive operation that suppresses logs and management commands. */
  blindMode?: BlindModeConfig
  model: ModelConfig
  runtime: RuntimeConfig
  storyDefaults: StoryDefaults
  logging: LoggingConfig
  memory?: Partial<MemoryConfig>
  sharedStory?: SharedStoryConfig
  /** Optional, read-only browser observations using local macOS Chrome. */
  browser?: BrowserConfig
  /** Non-secret profiles; authorization comes only from environment chat ids. */
  telegram?: TelegramConfig
  alterSystem?: AlterSystemConfig
  agency?: AgencyConfig
  /** Native tool use (roadmap §3); off by default. */
  tools?: ToolsConfig
  /** Public HTTP API for the website (roadmap §5); off by default. */
  web?: WebConfig
}

/** On/off is not here: the owner flips it with /web (switches.ts). */
export interface WebConfig {
  /** Always bound to 127.0.0.1; only the Cloudflare Tunnel reaches it. */
  port: number
  /** First path segment owned by Alice on the shared api host, e.g. '/alice'. */
  basePath: string
  /** Also answer '/' with the host overview page until another service owns it. */
  serveRootPage: boolean
  /** Chat page linked from the info page; empty hides the link. */
  siteUrl: string
  perVisitorPerMinute: number
  perVisitorPerHour: number
  perIpPerMinute: number
  perIpPerHour: number
  /** Simultaneous SSE connections per visitor; the oldest is closed beyond this. */
  maxStreamsPerVisitor: number
  /** A guest code (no key) stops working after this many idle minutes. */
  guestIdleMinutes: number
  /** Successful name changes allowed per calendar month (story timezone); 0 locks the name. */
  renamesPerMonth: number
}

/** On/off is not here: the owner flips it with /tools (switches.ts). */
export interface ToolsConfig {
  /** Model requests per turn before the loop forces a final answer. */
  maxSteps: number
  recall: { maxResults: number }
  skills: { dir: string; maxChars: number }
  /** Every command waits for the owner's tap (roadmap §3.5). */
  exec: { workdir: string; timeoutSeconds: number; maxOutputChars: number; approvalTtlMinutes: number; maxPending: number }
}

export interface BlindModeConfig {
  enabled: boolean
  /** Periodic, intentionally minimal health signal while all other HDSI logs stay hidden. */
  healthReportMinutes: number
}

export interface TelegramAccountRule {
  chatId: string
  label: string
  enabled: boolean
  /** Optional identity fields for a whitelisted private-message user. */
  personId?: string
  profile?: string
  relationship?: string
}

export interface TelegramConfig {
  userAccounts: TelegramAccountRule[]
  /** Group options never grant access without the environment whitelist. */
  groupChats?: GroupChatRule[]
}

export interface GroupChatRule {
  groupId: string
  label: string
  enabled: boolean
  purpose: string
  characterRole: string
  responseMode: 'mention-only' | 'always'
  contextLimit: number
  debounceSeconds: number
  cooldownSeconds: number
  willingness?: Partial<GroupWillingnessConfig>
}

export interface MemoryConfig {
  enabled: boolean
  backgroundIntervalMinutes: number
  maxStoriesPerCompactionRun: number
  sceneEntryThreshold: number
  sceneCharacterThreshold: number
  compactionEntryLimit: number
  compactionCharacterLimit: number
  sceneHookCharacters: number
  sceneSummaryCharacters: number
  arcSummaryCharacters: number
  recentEntryLimit: number
  factLimit: number
  factContentCharacters: number
  factImportanceWeight: number
  factConfidenceWeight: number
  factRecencyWeight: number
  unresolvedWeight: number
  statePatchConfidenceThreshold: number
  majorStatePatchConfidenceThreshold: number
  statePatchMinEvidence: number
  /** Minimum independent narrative turns for a minor overlay change. */
  statePatchMinTurns?: number
  /** Minimum distinct calendar days represented by minor-patch evidence. */
  statePatchMinDays?: number
  /** Cooldown between stable overlay changes on the same target/path. */
  statePatchCooldownHours?: number
  autoApplyStatePatches: boolean
  allowMajorStateChanges: boolean
  maxFactsPerStory: number
  /** Keep short-lived dramatic aftereffects as context for later writing. */
  activeConsequencesEnabled: boolean
  /** Maximum active consequences carried into one main-narrative prompt. */
  activeConsequencePromptLimit: number
  /** Longest permitted lifetime of one consequence; protects canon from drift. */
  activeConsequenceMaxDays: number
  /** Used when the narrator omits a precise strength for a valid consequence. */
  activeConsequenceDefaultStrength: number
  overlayCompressionEnabled?: boolean
  overlayRecentDays?: number
  overlayMonthlyAfterDays?: number
  overlayWeeklyWindowDays?: number
  overlayMonthlyWindowDays?: number
  overlayWeeklySummaryCharacters?: number
  overlayMonthlySummaryCharacters?: number
  /** What public turns (other chats, groups, later the website) may know about the owner; empty by default. */
  publicOwnerProfile?: string
  /** Generate the public scene/arc/continuity with separate public-only model calls (roadmap §4.6). */
  publicDigestEnabled?: boolean
  /** New public script entries needed before the public layer is refreshed. */
  publicDigestEntryThreshold?: number
  /** Nightly consolidation (roadmap §4.8): near-duplicate merge, contradiction check, visitor expiry. */
  consolidateEnabled?: boolean
  /** Story-local HH:MM after which the nightly consolidation runs once per day. */
  consolidateAt?: string
  /** Visitor records older than this are deleted by consolidation; 0 keeps them. */
  visitorTtlDays?: number
}

export interface RuntimeConfig {
  captureDirectMessages: boolean
  autoCreate: boolean
  ignoreCommandMessages: boolean
  allowProactiveMessages: boolean
  /** Minimum narrator-declared willingness for a background-initiated contact. */
  proactiveWillingnessThreshold?: number
  sweepIntervalMinutes: number
  minimumAdvanceMinutes: number
  maxStoriesPerSweep: number
  contextEntryLimit: number
  memoryLimit: number
  maxScriptCharacters: number
  maxMessageCharacters: number
  minimumDelayedReplySeconds: number
  maximumDelayedReplyMinutes: number
  cancelDelayedRepliesOnUserMessage: boolean
  /** Retry a user turn after a transient narrative-provider failure. */
  narrativeRetryDelaySeconds?: number
  /** Maximum automatic retries per failed user turn; 0 disables retry. */
  narrativeRetryMaxAttempts?: number
  /** Split model reply.content into multiple Telegram messages. */
  splitReplyMessages?: boolean
  messageSeparator?: string
  typingBaseDelaySeconds?: number
  typingCharactersPerSecond?: number
  typingMaxDelaySeconds?: number
  /** Random spread around each typing delay (0.3 = ±30%); 0 keeps it fixed. */
  typingJitterRatio?: number
  /** Wait after the newest user message before starting a writing request. */
  userMessageDebounceSeconds?: number
  /** Automatic life-writing schedule. */
  autoAdvanceEnabled?: boolean
  autoAdvanceIntervalMinutes?: number
  autoAdvanceJitterMinutes?: number
  /** Short life-writing passes after a conversation, in minutes. */
  conversationFollowUpMinutes?: number[]
  /** Small random offset applied to each short conversation follow-up. */
  conversationFollowUpJitterMinutes?: number
  restWindows?: RestWindow[]
  /** Elastic regular cadence from conversation density and life rhythm (src/urge.ts). */
  urge?: UrgeConfig
}

export interface UrgeConfig {
  enabled?: boolean
  /** Speed-up at full conversation density (1.4 = 40% shorter interval). */
  activeMultiplier?: number
  /** Applied inside a rest window when no fresh life rhythm is known. */
  restMultiplier?: number
  halfLifeMinutes?: number
}

export interface BrowserConfig {
  enabled: boolean
  /** Immediate browsing is opt-in because it intentionally adds one more model/browser round trip. */
  mode: 'deferred-only' | 'allow-immediate'
  allowSearch: boolean
  allowVisit: boolean
  searchUrlTemplate: string
  allowedDomains: string[]
  blockedDomains: string[]
  maxConcurrentPages: number
  /** Bound work per background sweep so a backlog cannot hold the story queue for minutes. */
  maxResearchPerSweep: number
  navigationTimeout: number
  waitUntil: 'domcontentloaded' | 'networkidle2'
  maxTextCharacters: number
  maxExcerptCharacters: number
  maxObservationsInPrompt: number
  cacheMinutes: number
  allowGroupTriggeredResearch: boolean
  logObservationPreview: boolean
}

export interface SharedStoryConfig {
  /** Enroll an allowed account into an existing main story on its first DM. */
  autoEnrollParticipants: boolean
  /** Allow one incoming message to cause an explicitly justified message to another account. */
  allowCrossConversationMessages: boolean
  /** Send other participants' relationship/profile details to the model provider. */
  shareParticipantDetails: boolean
  /** Hard cap for cross-account messages produced by one narrative turn. */
  maxCrossConversationActions: number
  /** Number of other relationship summaries sent to the main narrator. */
  participantContextLimit: number
}

export interface RestWindow {
  enabled: boolean
  label: string
  start: string
  end: string
  minIntervalMinutes: number
  maxIntervalMinutes: number
}

export interface StoryDefaults {
  characterName: string
  characterProfile: string
  perspective: string
  userProfile: string
  relationship: string
  world: string
  supportingCast: string
  location: string
  style: string
  timezone: string
}

export interface LoggingConfig {
  level: 'silent' | 'error' | 'warn' | 'info' | 'debug'
  /** Controls how much normal operational activity is written at info level. */
  verbosity?: 'summary' | 'standard' | 'diagnostic'
  format: 'compact' | 'detailed' | 'layered'
  /** Apply semantic ANSI colors in the terminal. */
  colors?: boolean
  /** Select an ANSI palette for dark or light terminal themes. */
  colorTheme?: 'dark' | 'light'
  /** Show fixed action kaomoji; false uses compact symbols instead. */
  kaomoji?: boolean
  logScriptPreview: boolean
  /** Emit user-visible incoming/outgoing message bodies to the terminal log. */
  logMessageContent?: boolean
  /** With verbosity=diagnostic, write every full model request to data/debug/requests/ for canary checks. */
  dumpRequests?: boolean
  previewLength: number
}

export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  enabled: true, backgroundIntervalMinutes: 10, maxStoriesPerCompactionRun: 20,
  sceneEntryThreshold: 16, sceneCharacterThreshold: 10_000, compactionEntryLimit: 80,
  compactionCharacterLimit: 32_000, sceneHookCharacters: 2_000, sceneSummaryCharacters: 8_000,
  arcSummaryCharacters: 12_000, recentEntryLimit: 30, factLimit: 20, factContentCharacters: 4_000,
  factImportanceWeight: 0.5, factConfidenceWeight: 0.35, factRecencyWeight: 0.15, unresolvedWeight: 0.2,
  statePatchConfidenceThreshold: 0.82, majorStatePatchConfidenceThreshold: 0.95,
  statePatchMinEvidence: 3, statePatchMinTurns: 3, statePatchMinDays: 2, statePatchCooldownHours: 72,
  autoApplyStatePatches: true, allowMajorStateChanges: true, maxFactsPerStory: 200,
  activeConsequencesEnabled: true, activeConsequencePromptLimit: 6, activeConsequenceMaxDays: 7,
  activeConsequenceDefaultStrength: 0.55, overlayCompressionEnabled: true, overlayRecentDays: 2,
  overlayMonthlyAfterDays: 10, overlayWeeklyWindowDays: 5, overlayMonthlyWindowDays: 10,
  overlayWeeklySummaryCharacters: 1_600, overlayMonthlySummaryCharacters: 2_400,
  publicOwnerProfile: '', publicDigestEnabled: false, publicDigestEntryThreshold: 20,
  consolidateEnabled: false, consolidateAt: '04:00', visitorTtlDays: 30,
}

/** Programmatic callers may omit numeric fields. Normalise them so one
 * malformed browser option cannot disable all due research or break the page semaphore. */
export function resolveBrowserConfig(value?: Partial<BrowserConfig>): BrowserConfig {
  const merged: BrowserConfig = { ...DEFAULT_CONFIG.browser!, ...value }
  return {
    ...merged,
    maxConcurrentPages: Math.max(1, Math.min(4, Number(merged.maxConcurrentPages) || 1)),
    maxResearchPerSweep: Math.max(1, Math.min(20, Number(merged.maxResearchPerSweep) || 1)),
    navigationTimeout: Math.max(1_000, Number(merged.navigationTimeout) || 15_000),
    maxTextCharacters: Math.max(500, Number(merged.maxTextCharacters) || 12_000),
    maxExcerptCharacters: Math.max(200, Number(merged.maxExcerptCharacters) || 3_000),
    maxObservationsInPrompt: Math.max(1, Math.min(20, Number(merged.maxObservationsInPrompt) || 4)),
    cacheMinutes: Math.max(0, Number(merged.cacheMinutes) || 0),
  }
}

export function resolveBlindModeConfig(value?: Partial<BlindModeConfig>): BlindModeConfig {
  return {
    enabled: value?.enabled === true,
    healthReportMinutes: Math.max(1, Math.min(1_440, Math.floor(value?.healthReportMinutes ?? 10))),
  }
}

export const DEFAULT_CONFIG: Config = {
  blindMode: { enabled: false, healthReportMinutes: 10 },
  storyDefaults: {
    characterName: 'Unnamed character', characterProfile: '', perspective: '', userProfile: '', relationship: '',
    world: '', supportingCast: '', location: '', style: '现实主义日常叙事，情绪克制，关系变化缓慢而具体。', timezone: 'Asia/Shanghai',
  },
  model: {
    model: 'claude-sonnet-4-6', mainTemperature: 0.8, mainMaxTokens: 4096, mainTimeout: 60_000,
    vision: { enabled: false },
    mainPrompt: 'Continue the character-centered life script with grounded actions, motives, relationships, and ordinary time passing.',
    formatPrompt: '', fixedPrompt: '', stylePrompt: 'Use restrained, realistic prose with concrete daily details, natural pauses, and no forced drama.',
    compaction: { enabled: true, model: '', temperature: 0.3, maxTokens: 2048, timeout: 60_000,
      mainPrompt: 'Compress completed scenes into concise continuity notes while preserving causality, promises, unresolved matters, and gradual character change.',
      fixedPrompt: '', stylePrompt: 'Concise, factual, chronological, and concrete.' },
  },
  telegram: { userAccounts: [], groupChats: [] },
  sharedStory: { autoEnrollParticipants: true, allowCrossConversationMessages: true, shareParticipantDetails: false,
    maxCrossConversationActions: 1, participantContextLimit: 6 },
  runtime: {
    splitReplyMessages: true, messageSeparator: '<sep/>', typingBaseDelaySeconds: 1, typingCharactersPerSecond: 8,
    typingMaxDelaySeconds: 12, typingJitterRatio: 0.3, userMessageDebounceSeconds: 2, narrativeRetryDelaySeconds: 60, narrativeRetryMaxAttempts: 6,
    captureDirectMessages: true, autoCreate: false, ignoreCommandMessages: true, allowProactiveMessages: false,
    proactiveWillingnessThreshold: 0.65, sweepIntervalMinutes: 5, minimumAdvanceMinutes: 30, maxStoriesPerSweep: 20,
    contextEntryLimit: 30, memoryLimit: 20, maxScriptCharacters: 8000, maxMessageCharacters: 2000,
    minimumDelayedReplySeconds: 10, maximumDelayedReplyMinutes: 1440, cancelDelayedRepliesOnUserMessage: true,
    autoAdvanceEnabled: true, autoAdvanceIntervalMinutes: 40, autoAdvanceJitterMinutes: 5,
    conversationFollowUpMinutes: [10, 20], conversationFollowUpJitterMinutes: 1,
    restWindows: [{ enabled: true, label: 'night sleep', start: '23:00', end: '07:00', minIntervalMinutes: 120, maxIntervalMinutes: 240 }],
    urge: { enabled: false, activeMultiplier: 1.4, restMultiplier: 0.6, halfLifeMinutes: 90 },
  },
  agency: { enabled: true, maxWindowMinutes: 240, minimumProactiveIntervalMinutes: 30, maxCandidateHours: 48 },
  alterSystem: { ...DEFAULT_ALTER_SYSTEM_CONFIG, enabled: true },
  browser: { enabled: false, mode: 'deferred-only', allowSearch: true, allowVisit: true,
    searchUrlTemplate: 'https://www.google.com/search?q={query}', allowedDomains: [], blockedDomains: [],
    maxConcurrentPages: 1, maxResearchPerSweep: 1, navigationTimeout: 20_000, waitUntil: 'domcontentloaded',
    maxTextCharacters: 20_000, maxExcerptCharacters: 4000, maxObservationsInPrompt: 3, cacheMinutes: 60,
    allowGroupTriggeredResearch: false, logObservationPreview: false },
  tools: { maxSteps: 6, recall: { maxResults: 8 },
    skills: { dir: '~/AliceWorkspace/skills', maxChars: 20_000 },
    exec: { workdir: '~/AliceWorkspace', timeoutSeconds: 60, maxOutputChars: 8_000, approvalTtlMinutes: 10, maxPending: 3 } },
  web: { port: 8787, basePath: '/alice', serveRootPage: true, siteUrl: 'https://alice.ignat.ai',
    perVisitorPerMinute: 6, perVisitorPerHour: 60, perIpPerMinute: 6, perIpPerHour: 60, maxStreamsPerVisitor: 3, guestIdleMinutes: 60, renamesPerMonth: 3 },
  logging: { level: 'info', verbosity: 'standard', format: 'layered', colors: true, colorTheme: 'dark', kaomoji: true,
    logScriptPreview: false, logMessageContent: false, dumpRequests: false, previewLength: 500 },
}

function mergeDefaults(defaults: any, input: any, path = 'config'): any {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error(`${path} 必须是对象。`)
  const result = structuredClone(defaults)
  for (const [key, value] of Object.entries(input)) {
    if (!Object.hasOwn(defaults, key)) throw new Error(`不支持的配置项：${path}.${key}`)
    const expected = defaults[key]
    if (Array.isArray(expected)) {
      if (!Array.isArray(value)) throw new Error(`${path}.${key} 必须是数组。`)
      result[key] = structuredClone(value)
    } else if (expected && typeof expected === 'object') result[key] = mergeDefaults(expected, value, `${path}.${key}`)
    else {
      if (typeof value !== typeof expected) throw new Error(`${path}.${key} 类型不正确。`)
      if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`${path}.${key} 必须是有限数值。`)
      if (typeof value === 'number' && value < 0) throw new Error(`${path}.${key} 不能为负数。`)
      result[key] = value
    }
  }
  return result
}

/**
 * Model settings may live in the environment (LLM_*) so the provider can be
 * swapped without touching config.yaml; set variables override the file.
 */
export function applyModelEnvironment(config: Config, env: NodeJS.ProcessEnv) {
  const text = (name: string) => env[name]?.trim() || undefined
  const integer = (name: string) => {
    const value = text(name)
    if (value === undefined) return undefined
    if (!/^\d+$/.test(value) || Number(value) < 1) throw new Error(`环境变量 ${name} 必须是正整数。`)
    return Number(value)
  }
  const baseUrl = text('LLM_BASE_URL')
  if (baseUrl !== undefined) config.model.baseUrl = baseUrl
  config.model.model = text('LLM_MODEL') ?? config.model.model
  const compactionModel = text('LLM_COMPACTION_MODEL')
  if (compactionModel !== undefined && config.model.compaction) config.model.compaction.model = compactionModel
  const alterModel = text('LLM_ALTER_MODEL')
  if (alterModel !== undefined && config.alterSystem) config.alterSystem.model = alterModel
  config.model.mainMaxTokens = integer('LLM_MAX_TOKENS') ?? config.model.mainMaxTokens
  const timeout = integer('LLM_TIMEOUT_SECONDS')
  if (timeout !== undefined) config.model.mainTimeout = timeout * 1000
  const vision = text('LLM_VISION')
  if (vision !== undefined) {
    if (!['true', 'false'].includes(vision)) throw new Error('环境变量 LLM_VISION 只能是 true 或 false。')
    config.model.vision = { enabled: vision === 'true' }
  }
}

export function resolveConfig(input: unknown, env: NodeJS.ProcessEnv = {}): Config {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('config 必须是对象。')
  const { memory, ...rest } = input as Record<string, unknown>
  const config: Config = mergeDefaults(DEFAULT_CONFIG, rest)
  if (memory !== undefined) {
    config.memory = mergeDefaults({ ...DEFAULT_MEMORY_CONFIG,
      maxStoriesPerCompactionRun: config.runtime.maxStoriesPerSweep,
      recentEntryLimit: config.runtime.contextEntryLimit, factLimit: config.runtime.memoryLimit }, memory, 'memory')
  }
  if (config.memory?.consolidateAt !== undefined && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(config.memory.consolidateAt)) throw new Error('memory.consolidateAt 必须是 HH:MM。')
  applyModelEnvironment(config, env)
  try { new Intl.DateTimeFormat('en-US', { timeZone: config.storyDefaults.timezone }) } catch { throw new Error('storyDefaults.timezone 无效。') }
  for (const model of [config.model.model, config.model.compaction?.model, config.alterSystem?.model]) {
    if (model?.trim() && !MODEL_NAME_PATTERN.test(model)) throw new Error(`模型名格式无效：${model}`)
  }
  if (config.model.baseUrl !== undefined) {
    let url: URL | undefined
    try { url = new URL(config.model.baseUrl) } catch {}
    // Plain http only for a local proxy; the API key must never cross the network unencrypted.
    const local = url && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if (!url || !(url.protocol === 'https:' || (url.protocol === 'http:' && local))) throw new Error('LLM_BASE_URL 必须是 https 地址。')
  }
  for (const value of [config.model.mainMaxTokens, config.model.mainTimeout, config.runtime.sweepIntervalMinutes,
    config.model.compaction?.maxTokens, config.model.compaction?.timeout, config.alterSystem?.maxTokens, config.alterSystem?.timeout]) {
    if (!Number.isInteger(value) || value! < 1) throw new Error('token 上限、超时和扫描间隔必须是正整数。')
  }
  if (!config.model.model.trim()) throw new Error('请填写模型名（环境变量 LLM_MODEL）。')
  for (const value of [config.model.mainTemperature, config.model.compaction?.temperature, config.alterSystem?.temperature]) {
    if (value! < 0 || value! > 1) throw new Error('temperature 必须在 0 到 1 之间。')
  }
  if (!['silent', 'error', 'warn', 'info', 'debug'].includes(config.logging.level)
    || !['summary', 'standard', 'diagnostic'].includes(config.logging.verbosity ?? 'standard')
    || !['compact', 'detailed', 'layered'].includes(config.logging.format)
    || !['dark', 'light'].includes(config.logging.colorTheme ?? 'dark')) throw new Error('logging 配置无效。')
  if (config.browser && (!['deferred-only', 'allow-immediate'].includes(config.browser.mode)
    || !['domcontentloaded', 'networkidle2'].includes(config.browser.waitUntil))) throw new Error('browser 配置无效。')
  const tools = config.tools!
  for (const value of [tools.maxSteps, tools.recall.maxResults, tools.skills.maxChars, tools.exec.timeoutSeconds,
    tools.exec.maxOutputChars, tools.exec.approvalTtlMinutes, tools.exec.maxPending]) {
    if (!Number.isInteger(value) || value < 1) throw new Error('tools 中的步数、条数、字数、秒数和分钟数必须是正整数。')
  }
  if (tools.maxSteps > 20 || tools.exec.timeoutSeconds > 600 || tools.exec.approvalTtlMinutes > 1440 || tools.exec.maxPending > 10) {
    throw new Error('tools.maxSteps 最大 20，exec.timeoutSeconds 最大 600，exec.approvalTtlMinutes 最大 1440，exec.maxPending 最大 10。')
  }
  const web = config.web!
  for (const value of [web.port, web.perVisitorPerMinute, web.perVisitorPerHour, web.perIpPerMinute, web.perIpPerHour, web.maxStreamsPerVisitor, web.guestIdleMinutes]) {
    if (!Number.isInteger(value) || value < 1) throw new Error('web 中的端口、限流次数和分钟数必须是正整数。')
  }
  if (!Number.isInteger(web.renamesPerMonth) || web.renamesPerMonth < 0) throw new Error('web.renamesPerMonth 必须是不小于 0 的整数。')
  if (web.port > 65535) throw new Error('web.port 最大 65535。')
  // One lowercase segment: the tunnel routes ^/<segment>(/|$) here and other services own the rest of the host.
  if (!/^\/[a-z0-9][a-z0-9-]*$/.test(web.basePath)) throw new Error('web.basePath 必须是单级路径，例如 /alice。')
  if (web.siteUrl && !/^https?:\/\/[^\s"<>]+$/.test(web.siteUrl)) throw new Error('web.siteUrl 必须是 http(s) 地址或留空。')
  if (config.runtime.conversationFollowUpMinutes?.some(value => typeof value !== 'number' || !Number.isFinite(value) || value <= 0)) throw new Error('conversationFollowUpMinutes 必须是正数数组。')
  config.runtime.restWindows = (config.runtime.restWindows ?? []).map(window => {
    const row = mergeDefaults(DEFAULT_CONFIG.runtime.restWindows![0], window, 'runtime.restWindows')
    if (![row.start, row.end].every(value => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value))
      || row.maxIntervalMinutes < row.minIntervalMinutes) throw new Error('休息窗口时间或间隔无效。')
    return row
  })
  const accounts = config.telegram?.userAccounts ?? []
  config.telegram!.userAccounts = accounts.map((account: TelegramAccountRule) => {
    const row = mergeDefaults({ chatId: '', label: '', enabled: true, personId: '', profile: '', relationship: '' }, account, 'telegram.userAccounts')
    if (!/^[1-9]\d*$/.test(row.chatId)) throw new Error('私聊资料的 chatId 必须是正整数。')
    return row
  })
  config.telegram!.groupChats = (config.telegram?.groupChats ?? []).map((group: GroupChatRule) => {
    const defaults = { groupId: '', label: '', enabled: true, purpose: '', characterRole: '', responseMode: 'mention-only', contextLimit: 20, debounceSeconds: 1, cooldownSeconds: 60,
      willingness: { enabled: false, maxScore: 1, threshold: 0.24, probabilityAmplifier: 1.3, decayHalfLifeSeconds: 180, replyCost: 0.55, baseGain: 0.12, quoteGain: 0.12, keywordGain: 0.18, keywords: [] } }
    const row = mergeDefaults(defaults, group, 'telegram.groupChats')
    if (!/^-[1-9]\d*$/.test(row.groupId) || !['mention-only', 'always'].includes(row.responseMode)) throw new Error('Telegram 群配置无效。')
    return row
  })
  return config
}
