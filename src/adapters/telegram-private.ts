import type { MessageSession as Session } from '../runtime'
import { setTimeout as delay } from 'node:timers/promises'
import type { BotTransport, InlineButton } from '../runtime'
import type { Storage } from '../database'
import type { AdapterInboundEvent } from '../router/events'

export interface TelegramEnvironment {
  token: string
  botId: string
  chatIds: ReadonlySet<string>
  /** ALICE_OWNER_CHAT_ID: the only private chat with the owner tier. */
  ownerChatId: string
}

export function assertMacOS(platform: string = process.platform) {
  if (platform !== 'darwin') throw new Error('本项目仅支持 macOS。')
}

export function readTelegramEnvironment(env: NodeJS.ProcessEnv = process.env): TelegramEnvironment {
  const token = env.TELEGRAM_BOT_TOKEN?.trim() ?? ''
  if (!/^[1-9]\d*:[a-z0-9_-]+$/i.test(token)) throw new Error('请在环境变量 TELEGRAM_BOT_TOKEN 中填写有效的 Bot token。')
  const ids = (env.TELEGRAM_CHAT_IDS ?? '').trim().split(/[\s,]+/).filter(Boolean)
  if (!ids.length) throw new Error('环境变量 TELEGRAM_CHAT_IDS 不能为空；空白名单拒绝所有聊天。')
  if (ids.some(id => !/^-?[1-9]\d*$/.test(id) || BigInt(id) > BigInt(Number.MAX_SAFE_INTEGER) || BigInt(id) < -BigInt(Number.MAX_SAFE_INTEGER))) {
    throw new Error('TELEGRAM_CHAT_IDS 必须是逗号或空白分隔的整数 chat id。')
  }
  const ownerChatId = env.ALICE_OWNER_CHAT_ID?.trim() ?? ''
  // The owner is a private chat (positive id); a group can never be the owner.
  if (!/^[1-9]\d*$/.test(ownerChatId)) throw new Error('请在环境变量 ALICE_OWNER_CHAT_ID 中填写主人私聊的 chat id（正整数）。')
  if (!ids.includes(ownerChatId)) throw new Error('ALICE_OWNER_CHAT_ID 必须同时出现在 TELEGRAM_CHAT_IDS 中。')
  return { token, botId: token.split(':')[0], chatIds: new Set(ids), ownerChatId }
}

// Forum topics have their own channelId; authorization always uses the parent chat id.
export function telegramChatId(session: Pick<Session, 'isDirect' | 'channelId' | 'guildId'>) {
  return String(session.isDirect ? session.channelId : session.guildId || session.channelId).trim()
}

export function isAllowedTelegramSession(env: TelegramEnvironment, session: Pick<Session, 'selfId' | 'userId' | 'isDirect' | 'channelId' | 'guildId'> & { platform: string }) {
  return session.platform === 'telegram'
    && session.selfId === env.botId
    && session.userId !== env.botId
    && env.chatIds.has(telegramChatId(session))
}

/** Converts an authorized private-chat Session into a channel-independent event (tier is left to the router). */
export function telegramPrivateEvent(session: Session, receivedAt = new Date()): AdapterInboundEvent {
  if (!session.isDirect) throw new Error('只有 Telegram 私聊可以转换为 telegram-private 事件。')
  return {
    channel: 'telegram-private', sourceId: telegramChatId(session), participantKey: `tg:${session.userId}`,
    senderId: session.userId, senderName: session.username, messageId: session.messageId,
    text: session.content, imageSources: session.imageSources, voiceCount: session.voiceCount,
    receivedAt, reply: { send: text => session.send(text) },
  }
}

interface TelegramMessage {
  message_id: number
  chat: { id: number; type: string }
  from?: { id: number; first_name?: string; last_name?: string; username?: string; is_bot?: boolean }
  text?: string
  caption?: string
  entities?: Array<{ type: string; offset: number; length: number; user?: { id: number } }>
  photo?: Array<{ file_id: string; file_size?: number }>
  document?: { file_id: string; file_size?: number; mime_type?: string }
  voice?: unknown
  audio?: unknown
  reply_to_message?: { from?: { id: number } }
}
interface TelegramCallbackQuery {
  id: string
  from: { id: number; is_bot?: boolean }
  message?: { message_id: number; chat: { id: number; type: string } }
  data?: string
}
interface Update { update_id: number; message?: TelegramMessage; callback_query?: TelegramCallbackQuery }

/**
 * An inline-button tap from a whitelisted chat. The adapter only checks the
 * whitelist; what a tap may do (and who may do it) is decided by the handler.
 */
export interface TelegramCallback {
  chatId: string
  chatType: string
  fromId: string
  messageId: string
  data: string
  /** answerCallbackQuery: clears the button's loading state, optionally with a short toast. */
  answer(text?: string): Promise<void>
}
export type CallbackHandler = (callback: TelegramCallback) => Promise<void>

/** Telegram API failure; retryAfter is set when Telegram asks the client to slow down (HTTP 429). */
export class TelegramApiError extends Error {
  constructor(method: string, readonly code?: number, readonly retryAfter?: number) {
    super(`Telegram ${method} 失败（${code ?? '网络错误'}）。`)
  }
}

/** A poison update is skipped after this many consecutive handling failures. */
const MAX_UPDATE_ATTEMPTS = 3
/** Each outgoing chunk is attempted at most this many times. */
const MAX_SEND_ATTEMPTS = 4
const MAX_RETRY_AFTER_SECONDS = 60

export class TelegramBot implements BotTransport {
  readonly platform = 'telegram' as const
  readonly selfId: string
  private controller = new AbortController()
  private username = ''
  private prompts = new Map<string, { resolve(value: string | undefined): void; timer: NodeJS.Timeout }>()

  constructor(private env: TelegramEnvironment, private storage: Storage, private visionEnabled = false,
    private request: typeof fetch = fetch) { this.selfId = env.botId }

  private async api<T>(method: string, body: Record<string, unknown>, timeout = 35_000): Promise<T> {
    const response = await this.request(`https://api.telegram.org/bot${this.env.token}/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(timeout)]),
    })
    const value = await response.json().catch(() => undefined) as { ok: boolean; result?: T; error_code?: number; parameters?: { retry_after?: number } } | undefined
    if (!response.ok || !value?.ok) throw new TelegramApiError(method, value?.error_code ?? response.status, value?.parameters?.retry_after)
    return value.result as T
  }

  /**
   * Retries only failures where Telegram did not accept the message: rate
   * limits, server errors and connection failures. A timeout is not retried
   * because the message may already have been delivered.
   */
  private async sendChunk(chatId: string, text: string, extra: Record<string, unknown> = {}) {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.api<{ message_id: number }>('sendMessage', { chat_id: chatId, text, ...extra })
      } catch (error) {
        const wait = sendRetryDelay(error, attempt)
        if (wait == null || this.controller.signal.aborted) throw error
        await delay(wait, undefined, { signal: this.controller.signal })
      }
    }
  }

  async sendMessage(chatId: string, content: string) {
    if (!this.env.chatIds.has(chatId)) throw new Error('投递目标不在 TELEGRAM_CHAT_IDS 白名单内。')
    const ids: string[] = []
    let remaining = content
    while (remaining.length) {
      let end = Math.min(4096, remaining.length)
      if (end < remaining.length && /[\uD800-\uDBFF]/.test(remaining[end - 1])) end--
      const text = remaining.slice(0, end)
      const result = await this.sendChunk(chatId, text)
      ids.push(String(result.message_id))
      remaining = remaining.slice(end)
    }
    return ids
  }

  sendPrivateMessage(chatId: string, content: string) { return this.sendMessage(chatId, content) }

  /** HTML can't be split safely mid-tag, so callers keep each message under the limit. */
  async sendHtml(chatId: string, html: string) {
    if (!this.env.chatIds.has(chatId)) throw new Error('投递目标不在 TELEGRAM_CHAT_IDS 白名单内。')
    if (html.length > 4096) throw new Error('HTML 消息超过 Telegram 的 4096 字符上限。')
    const result = await this.sendChunk(chatId, html, { parse_mode: 'HTML', link_preview_options: { is_disabled: true } })
    return [String(result.message_id)]
  }

  /**
   * The command menu is scoped to the owner chat only, so other chats never
   * see the management command list.
   */
  async setOwnerCommands(commands: Array<{ command: string; description: string }>) {
    const scope = { type: 'chat', chat_id: Number(this.env.ownerChatId) }
    if (!commands.length) await this.api('deleteMyCommands', { scope })
    else await this.api('setMyCommands', { scope, commands: commands.slice(0, 100) })
  }

  async sendInlinePrompt(chatId: string, content: string, buttons: InlineButton[]) {
    if (!this.env.chatIds.has(chatId)) throw new Error('投递目标不在 TELEGRAM_CHAT_IDS 白名单内。')
    const result = await this.api<{ message_id: number }>('sendMessage', {
      chat_id: chatId, text: content.slice(0, 4096),
      reply_markup: { inline_keyboard: [buttons.map(button => ({ text: button.text, callback_data: button.data }))] },
    })
    return String(result.message_id)
  }

  /** editMessageText without reply_markup also removes the inline keyboard. */
  async closeInlinePrompt(chatId: string, messageId: string, content: string) {
    if (!this.env.chatIds.has(chatId)) throw new Error('投递目标不在 TELEGRAM_CHAT_IDS 白名单内。')
    await this.api('editMessageText', { chat_id: chatId, message_id: Number(messageId), text: content.slice(0, 4096) })
  }

  private async handleCallback(query: TelegramCallbackQuery, handle?: CallbackHandler) {
    const answer = async (text?: string) => {
      await this.api('answerCallbackQuery', { callback_query_id: query.id, ...(text ? { text: text.slice(0, 200) } : {}) }).catch(() => undefined)
    }
    const message = query.message
    // Taps from chats outside the whitelist get no handler and no information.
    if (!handle || !message || query.from.is_bot || !this.env.chatIds.has(String(message.chat.id)) || typeof query.data !== 'string') {
      await answer()
      return
    }
    await handle({
      chatId: String(message.chat.id), chatType: message.chat.type, fromId: String(query.from.id),
      messageId: String(message.message_id), data: query.data, answer,
    })
  }

  private prompt(chatId: string, userId: string, timeout: number) {
    const key = `${chatId}:${userId}`
    const previous = this.prompts.get(key)
    if (previous) { clearTimeout(previous.timer); previous.resolve(undefined) }
    return new Promise<string | undefined>(resolve => {
      const timer = setTimeout(() => { this.prompts.delete(key); resolve(undefined) }, timeout)
      this.prompts.set(key, { resolve, timer })
    })
  }

  async handleUpdate(update: Update, handle: (session: Session) => Promise<void>, onCallback?: CallbackHandler) {
    if (update.callback_query) return this.handleCallback(update.callback_query, onCallback)
    const message = update.message
    // Reject before downloading files, creating a session, or exposing data to a model.
    if (!message?.from || message.from.is_bot || !this.env.chatIds.has(String(message.chat.id))) return
    const chatId = String(message.chat.id), userId = String(message.from.id)
    const pending = this.prompts.get(`${chatId}:${userId}`)
    if (pending) {
      clearTimeout(pending.timer); this.prompts.delete(`${chatId}:${userId}`)
      pending.resolve(message.text ?? message.caption)
      return
    }
    const imageSources: string[] = []
    if (this.visionEnabled && message.chat.type === 'private') {
      const photo = message.photo?.at(-1)
      const file = photo ?? (message.document?.mime_type?.startsWith('image/') ? message.document : undefined)
      if (file && (file.file_size ?? 0) <= 4 * 1024 * 1024) {
        try {
          const data = await this.api<{ file_path: string }>('getFile', { file_id: file.file_id })
          const response = await this.request(`https://api.telegram.org/file/bot${this.env.token}/${data.file_path}`, {
            signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(10_000)]), redirect: 'error',
          })
          if (response.ok) {
            const bytes = Buffer.from(await response.arrayBuffer())
            const mime = message.document?.mime_type || response.headers.get('content-type')?.split(';')[0] || 'image/jpeg'
            if (bytes.length && bytes.length <= 4 * 1024 * 1024 && /^image\/(jpeg|png|gif|webp)$/.test(mime)) {
              imageSources.push(`data:${mime};base64,${bytes.toString('base64')}`)
            }
          }
        } catch { if (!this.controller.signal.aborted) console.warn('Telegram 图片读取失败，继续处理文字。') }
      }
    }
    let content = message.text ?? message.caption ?? ''
    const addressed = /^\/[^\s]+@([^\s]+)/.exec(content)
    if (addressed && addressed[1].toLowerCase() !== this.username.toLowerCase()) return
    content = content.replace(/^(\/[^\s@]+)@[^\s]+/, '$1')
    const mentionedBot = (message.entities ?? []).some(entity =>
      entity.type === 'text_mention' && String(entity.user?.id) === this.selfId
      || entity.type === 'mention' && content.slice(entity.offset, entity.offset + entity.length).toLowerCase() === `@${this.username.toLowerCase()}`)
    const session: Session = {
      platform: 'telegram', selfId: this.selfId, userId, channelId: chatId,
      guildId: message.chat.type === 'private' ? undefined : chatId, isDirect: message.chat.type === 'private',
      username: [message.from.first_name, message.from.last_name].filter(Boolean).join(' ') || message.from.username || userId,
      content, messageId: String(message.message_id), imageSources,
      voiceCount: message.voice || message.audio ? 1 : 0, mentionedBot,
      quote: message.reply_to_message?.from ? { user: { id: String(message.reply_to_message.from.id) } } : undefined,
      send: text => this.sendMessage(chatId, text), sendHtml: html => this.sendHtml(chatId, html), prompt: timeout => this.prompt(chatId, userId, timeout),
    }
    await handle(session)
  }

  async run(handle: (session: Session) => Promise<void>, onCallback?: CallbackHandler) {
    const me = await this.api<{ id: number; username: string }>('getMe', {})
    if (String(me.id) !== this.selfId) throw new Error('Telegram bot 身份不匹配。')
    this.username = me.username
    await this.api('deleteWebhook', { drop_pending_updates: false })
    const key = `telegram_offset:${this.selfId}`
    let offset = Number(this.storage.getMeta(key) ?? 0)
    if (!Number.isSafeInteger(offset) || offset < 0) offset = 0
    const failures = { updateId: -1, count: 0 }
    const advance = (update: Update) => {
      offset = update.update_id + 1
      this.storage.setMeta(key, String(offset))
    }
    while (!this.controller.signal.aborted) {
      try {
        const updates = await this.api<Update[]>('getUpdates', {
          offset, timeout: 25, allowed_updates: onCallback ? ['message', 'callback_query'] : ['message'],
        })
        for (const update of updates) {
          if (this.controller.signal.aborted) break
          try {
            await this.handleUpdate(update, handle, onCallback)
          } catch (error) {
            if (this.controller.signal.aborted) throw error
            failures.count = failures.updateId === update.update_id ? failures.count + 1 : 1
            failures.updateId = update.update_id
            if (failures.count < MAX_UPDATE_ATTEMPTS) throw error
            // Without skipping, one message that always fails would block every later message.
            console.warn(`Telegram 消息连续处理失败 ${failures.count} 次，已跳过该条消息。`)
          }
          advance(update)
        }
      } catch {
        if (this.controller.signal.aborted) break
        console.warn('Telegram 接收或处理消息失败，2 秒后重试。')
        await delay(2000, undefined, { signal: this.controller.signal }).catch(() => undefined)
      }
    }
  }

  stop() {
    this.controller.abort()
    for (const pending of this.prompts.values()) { clearTimeout(pending.timer); pending.resolve(undefined) }
    this.prompts.clear()
  }
}

/** Milliseconds to wait before another send attempt, or undefined when the failure must not be retried. */
export function sendRetryDelay(error: unknown, attempt: number) {
  if (attempt >= MAX_SEND_ATTEMPTS) return undefined
  if (error instanceof TelegramApiError) {
    if (error.code === 429) return Math.min(Math.max(error.retryAfter ?? 1, 1), MAX_RETRY_AFTER_SECONDS) * 1000
    return error.code != null && error.code >= 500 ? 1000 * 2 ** (attempt - 1) : undefined
  }
  // fetch rejects with TypeError when the connection fails before a response arrives.
  return error instanceof TypeError ? 1000 * 2 ** (attempt - 1) : undefined
}

/**
 * What a failed send means for compensation (roadmap 8, 穿插第二档):
 * retryable — Telegram never accepted it (connection, 429, 5xx), safe to resend;
 * failed — Telegram refused it for good (other 4xx);
 * unknown — the request may have landed (timeout), resending risks a duplicate.
 */
export type SendFailure = 'retryable' | 'failed' | 'unknown'

export function classifySendFailure(error: unknown): SendFailure {
  if (error instanceof TelegramApiError) {
    if (error.code == null) return 'unknown'
    return error.code === 429 || error.code >= 500 ? 'retryable' : 'failed'
  }
  if (error instanceof TypeError) return 'retryable'
  // Shutdown aborts the pending wait between attempts, or a request whose fate is unknown.
  if (error instanceof Error && error.name === 'TimeoutError') return 'unknown'
  if (error instanceof Error && error.name === 'AbortError') return 'retryable'
  return 'unknown'
}
