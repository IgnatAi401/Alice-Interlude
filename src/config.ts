import type { Config, GroupChatRule, TelegramAccountRule } from './service'
import { DEFAULT_MEMORY_CONFIG } from './service'
import { DEFAULT_ALTER_SYSTEM_CONFIG } from './alter'

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
    maxCrossConversationActions: 1, participantContextLimit: 6, managerAccounts: [] },
  runtime: {
    splitReplyMessages: true, messageSeparator: '<sep/>', typingBaseDelaySeconds: 1, typingCharactersPerSecond: 8,
    typingMaxDelaySeconds: 12, userMessageDebounceSeconds: 2, narrativeRetryDelaySeconds: 60, narrativeRetryMaxAttempts: 6,
    captureDirectMessages: true, autoCreate: false, ignoreCommandMessages: true, allowProactiveMessages: false,
    proactiveWillingnessThreshold: 0.65, sweepIntervalMinutes: 5, minimumAdvanceMinutes: 30, maxStoriesPerSweep: 20,
    contextEntryLimit: 30, memoryLimit: 20, maxScriptCharacters: 8000, maxMessageCharacters: 2000,
    minimumDelayedReplySeconds: 10, maximumDelayedReplyMinutes: 1440, cancelDelayedRepliesOnUserMessage: true,
    autoAdvanceEnabled: true, autoAdvanceIntervalMinutes: 40, autoAdvanceJitterMinutes: 5,
    conversationFollowUpMinutes: [10, 20], conversationFollowUpJitterMinutes: 1,
    restWindows: [{ enabled: true, label: 'night sleep', start: '23:00', end: '07:00', minIntervalMinutes: 120, maxIntervalMinutes: 240 }],
  },
  agency: { enabled: true, maxWindowMinutes: 240, minimumProactiveIntervalMinutes: 30, maxCandidateHours: 48 },
  alterSystem: { ...DEFAULT_ALTER_SYSTEM_CONFIG, enabled: true },
  browser: { enabled: false, mode: 'deferred-only', allowSearch: true, allowVisit: true,
    searchUrlTemplate: 'https://www.google.com/search?q={query}', allowedDomains: [], blockedDomains: [],
    maxConcurrentPages: 1, maxResearchPerSweep: 1, navigationTimeout: 20_000, waitUntil: 'domcontentloaded',
    maxTextCharacters: 20_000, maxExcerptCharacters: 4000, maxObservationsInPrompt: 3, cacheMinutes: 60,
    allowGroupTriggeredResearch: false, logObservationPreview: false },
  logging: { level: 'info', verbosity: 'standard', format: 'layered', colors: true, colorTheme: 'dark', kaomoji: true,
    logScriptPreview: false, logMessageContent: false, previewLength: 500 },
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

export function resolveConfig(input: unknown): Config {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('config 必须是对象。')
  const { memory, ...rest } = input as Record<string, unknown>
  const config: Config = mergeDefaults(DEFAULT_CONFIG, rest)
  if (memory !== undefined) {
    config.memory = mergeDefaults({ ...DEFAULT_MEMORY_CONFIG,
      maxStoriesPerCompactionRun: config.runtime.maxStoriesPerSweep,
      recentEntryLimit: config.runtime.contextEntryLimit, factLimit: config.runtime.memoryLimit }, memory, 'memory')
  }
  try { new Intl.DateTimeFormat('en-US', { timeZone: config.storyDefaults.timezone }) } catch { throw new Error('storyDefaults.timezone 无效。') }
  for (const model of [config.model.model, config.model.compaction?.model, config.alterSystem?.model]) {
    if (model?.trim() && !/^claude-[a-z0-9.-]+$/i.test(model)) throw new Error('所有任务仅支持 Claude 模型代码。')
  }
  for (const value of [config.model.mainMaxTokens, config.model.mainTimeout, config.runtime.sweepIntervalMinutes,
    config.model.compaction?.maxTokens, config.model.compaction?.timeout, config.alterSystem?.maxTokens, config.alterSystem?.timeout]) {
    if (!Number.isInteger(value) || value! < 1) throw new Error('token 上限、超时和扫描间隔必须是正整数。')
  }
  if (!config.model.model.trim()) throw new Error('请填写 Claude 模型名。')
  for (const value of [config.model.mainTemperature, config.model.compaction?.temperature, config.alterSystem?.temperature]) {
    if (value! < 0 || value! > 1) throw new Error('temperature 必须在 0 到 1 之间。')
  }
  if (!['silent', 'error', 'warn', 'info', 'debug'].includes(config.logging.level)
    || !['summary', 'standard', 'diagnostic'].includes(config.logging.verbosity ?? 'standard')
    || !['compact', 'detailed', 'layered'].includes(config.logging.format)
    || !['dark', 'light'].includes(config.logging.colorTheme ?? 'dark')) throw new Error('logging 配置无效。')
  if (config.browser && (!['deferred-only', 'allow-immediate'].includes(config.browser.mode)
    || !['domcontentloaded', 'networkidle2'].includes(config.browser.waitUntil))) throw new Error('browser 配置无效。')
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
