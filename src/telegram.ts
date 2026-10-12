import type { MessageSession as Session } from './runtime'
import { setTimeout as delay } from 'node:timers/promises'
import type { BotTransport } from './runtime'
import type { Storage } from './database'

export interface TelegramEnvironment {
  token: string
  botId: string
  chatIds: ReadonlySet<string>
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
  return { token, botId: token.split(':')[0], chatIds: new Set(ids) }
}

// Forum topics have their own channelId; authorization always uses the parent chat id.
export function telegramChatId(session: Pick<Session, 'isDirect' | 'channelId' | 'guildId'>) {
  return String(session.isDirect ? session.channelId : session.guildId || session.channelId).trim()
}

export function isAllowedTelegramSession(env: TelegramEnvironment, session: Pick<Session, 'platform' | 'selfId' | 'userId' | 'isDirect' | 'channelId' | 'guildId'>) {
  return session.platform === 'telegram'
    && session.selfId === env.botId
    && session.userId !== env.botId
    && env.chatIds.has(telegramChatId(session))
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
interface Update { update_id: number; message?: TelegramMessage }

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
    const value = await response.json() as { ok: boolean; result?: T; error_code?: number; parameters?: { retry_after?: number } }
    if (!response.ok || !value.ok) throw new Error(`Telegram ${method} 失败（${value.error_code ?? response.status}）。`)
    return value.result as T
  }

  async sendMessage(chatId: string, content: string) {
    if (!this.env.chatIds.has(chatId)) throw new Error('投递目标不在 TELEGRAM_CHAT_IDS 白名单内。')
    const ids: string[] = []
    let remaining = content
    while (remaining.length) {
      let end = Math.min(4096, remaining.length)
      if (end < remaining.length && /[\uD800-\uDBFF]/.test(remaining[end - 1])) end--
      const text = remaining.slice(0, end)
      const result = await this.api<{ message_id: number }>('sendMessage', { chat_id: chatId, text })
      ids.push(String(result.message_id))
      remaining = remaining.slice(end)
    }
    return ids
  }

  sendPrivateMessage(chatId: string, content: string) { return this.sendMessage(chatId, content) }

  private prompt(chatId: string, userId: string, timeout: number) {
    const key = `${chatId}:${userId}`
    const previous = this.prompts.get(key)
    if (previous) { clearTimeout(previous.timer); previous.resolve(undefined) }
    return new Promise<string | undefined>(resolve => {
      const timer = setTimeout(() => { this.prompts.delete(key); resolve(undefined) }, timeout)
      this.prompts.set(key, { resolve, timer })
    })
  }

  async handleUpdate(update: Update, handle: (session: Session) => Promise<void>) {
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
      send: text => this.sendMessage(chatId, text), prompt: timeout => this.prompt(chatId, userId, timeout),
    }
    await handle(session)
  }

  async run(handle: (session: Session) => Promise<void>) {
    const me = await this.api<{ id: number; username: string }>('getMe', {})
    if (String(me.id) !== this.selfId) throw new Error('Telegram bot 身份不匹配。')
    this.username = me.username
    await this.api('deleteWebhook', { drop_pending_updates: false })
    const key = `telegram_offset:${this.selfId}`
    let offset = Number(this.storage.getMeta(key) ?? 0)
    if (!Number.isSafeInteger(offset) || offset < 0) offset = 0
    while (!this.controller.signal.aborted) {
      try {
        const updates = await this.api<Update[]>('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] })
        for (const update of updates) {
          if (this.controller.signal.aborted) break
          await this.handleUpdate(update, handle)
          offset = update.update_id + 1
          this.storage.setMeta(key, String(offset))
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
