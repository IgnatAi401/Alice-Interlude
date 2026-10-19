import { format } from 'node:util'
import { Storage } from './database'

export const Time = { second: 1000, minute: 60_000, hour: 3_600_000, day: 86_400_000 }

export interface MessageSession {
  platform: 'telegram'
  selfId: string
  userId: string
  channelId: string
  guildId?: string
  isDirect: boolean
  username: string
  content: string
  messageId: string
  imageSources?: string[]
  voiceCount?: number
  mentionedBot?: boolean
  quote?: { user: { id: string } }
  send(content: string): Promise<unknown>
  /** Telegram HTML parse mode; each call must fit one 4096-char message. */
  sendHtml?(html: string): Promise<unknown>
  prompt(timeout: number): Promise<string | undefined>
}

export interface InlineButton { text: string; data: string }

export interface BotTransport {
  platform: 'telegram'
  selfId: string
  sendMessage(chatId: string, content: string): Promise<unknown>
  sendPrivateMessage(chatId: string, content: string): Promise<unknown>
  /** One message with a row of inline buttons; returns its message id. */
  sendInlinePrompt?(chatId: string, content: string, buttons: InlineButton[]): Promise<string>
  /** Replaces a prompt's text and removes its buttons. */
  closeInlinePrompt?(chatId: string, messageId: string, content: string): Promise<void>
}

export class Logger {
  constructor(private name: string, private debugEnabled = false) {}
  info(message: string, ...args: unknown[]) { console.info(`[${this.name}] ${format(message, ...args)}`) }
  warn(message: string, ...args: unknown[]) { console.warn(`[${this.name}] ${format(message, ...args)}`) }
  error(message: string, ...args: unknown[]) { console.error(`[${this.name}] ${format(message, ...args)}`) }
  debug(message: string, ...args: unknown[]) { if (this.debugEnabled) this.info(message, ...args) }
}

type CommandAction = (event: { session: MessageSession }, ...args: any[]) => Promise<unknown>
interface RegisteredCommand { name: string; spec: string; description: string; menuName?: string; action?: CommandAction }
/** A command result sent in Telegram HTML; each item is one message. */
export interface HtmlReply { html: string | string[] }

/**
 * Telegram menu names only allow [a-z0-9_]{1,32}, so interlude.memory.facts
 * becomes memory_facts. The dotted form stays valid for typing.
 */
export function menuCommandName(name: string) {
  const short = name.replace(/^interlude\.?/, '').replace(/\./g, '_')
  return /^[a-z0-9_]{1,32}$/.test(short) ? short : undefined
}

function isHtmlReply(value: unknown): value is HtmlReply {
  return !!value && typeof value === 'object' && 'html' in value
}

function htmlToPlain(html: string) {
  return html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
}

/** Lifecycle utilities for the standalone bot. */
export class Runtime {
  bots: BotTransport[] = []
  puppeteer?: { page(): Promise<any>; close(): Promise<void> }
  private timers = new Set<NodeJS.Timeout>()
  private commands = new Map<string, RegisteredCommand>()
  private menuCommands = new Map<string, RegisteredCommand>()
  private requests = new Set<AbortController>()
  stopped = false
  constructor(public database: Storage, private debugEnabled = false) {}

  logger(name: string) { return new Logger(name, this.debugEnabled) }
  setTimeout(callback: () => void, delay: number) {
    if (this.stopped) return () => {}
    const timer = setTimeout(() => { this.timers.delete(timer); if (!this.stopped) callback() }, delay)
    this.timers.add(timer)
    return () => { clearTimeout(timer); this.timers.delete(timer) }
  }
  setInterval(callback: () => void, delay: number) {
    if (this.stopped) return () => {}
    const timer = setInterval(() => { if (!this.stopped) callback() }, delay)
    this.timers.add(timer)
    return () => { clearInterval(timer); this.timers.delete(timer) }
  }

  http = {
    post: async <T>(url: string, body: unknown, options: { headers: Record<string, string>; timeout: number }): Promise<T> => {
      if (this.stopped) throw new Error('Runtime stopped.')
      const controller = new AbortController()
      this.requests.add(controller)
      const timer = setTimeout(() => controller.abort(), options.timeout)
      try {
        const response = await fetch(url, { method: 'POST', headers: options.headers, body: JSON.stringify(body), signal: controller.signal })
        if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { response: { status: response.status } })
        return await response.json() as T
      } finally { clearTimeout(timer); this.requests.delete(controller) }
    },
  }

  command(spec: string, description: string) {
    const name = spec.split(' ')[0]
    const command: RegisteredCommand = { name, spec, description, menuName: menuCommandName(name) }
    this.commands.set(name, command)
    if (command.menuName) this.menuCommands.set(command.menuName, command)
    return { action: (action: CommandAction) => { command.action = action } }
  }

  /** Commands that have an action, in registration order. */
  commandList() {
    return Array.from(this.commands.values()).filter(command => command.action)
      .map(({ name, spec, description, menuName }) => ({ name, spec, description, menuName }))
  }

  /** Dotted names may omit the slash (legacy); menu names need it, so plain words stay chat messages. */
  private matchCommand(text: string) {
    const content = text.trim()
    const match = /^(\/)?([^\s@]+)(?:@[^\s]+)?(?:\s+([\s\S]*))?$/.exec(content)
    if (!match) return undefined
    const command = this.commands.get(match[2]) ?? (match[1] ? this.menuCommands.get(match[2].toLowerCase()) : undefined)
    return command?.action ? { command, remaining: match[3]?.trim() ?? '' } : undefined
  }

  hasCommand(text: string) { return !!this.matchCommand(text) }

  dispatchCommand(session: MessageSession) {
    const matched = this.matchCommand(session.content)
    if (!matched) return undefined
    const { command, remaining } = matched
    const specs = Array.from(command.spec.matchAll(/[<\[]([^>\]]+)[>\]]/g))
    let cursor = 0
    const args = specs.map(item => {
      const type = item[1].split(':')[1]
      const rest = remaining.slice(cursor).trimStart()
      const value = type === 'text' ? rest : /^\S+/.exec(rest)?.[0]
      cursor = remaining.length - rest.length + (value?.length ?? 0)
      return value == null || value === '' ? undefined : type === 'number' ? Number(value) : value
    })
    return (async () => {
      const result = await command.action?.({ session }, ...args)
      if (this.stopped) return
      if (typeof result === 'string' && result.trim()) await session.send(result)
      else if (isHtmlReply(result)) {
        for (const html of [result.html].flat()) {
          if (session.sendHtml) await session.sendHtml(html)
          else await session.send(htmlToPlain(html))
        }
      }
    })()
  }

  async stop() {
    this.stopped = true
    for (const timer of this.timers) { clearTimeout(timer); clearInterval(timer) }
    this.timers.clear()
    for (const request of this.requests) request.abort()
    this.requests.clear()
    await this.puppeteer?.close()
  }
}
