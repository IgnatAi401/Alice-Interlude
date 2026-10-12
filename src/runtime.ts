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
  prompt(timeout: number): Promise<string | undefined>
}

export interface BotTransport {
  platform: 'telegram'
  selfId: string
  sendMessage(chatId: string, content: string): Promise<unknown>
  sendPrivateMessage(chatId: string, content: string): Promise<unknown>
}

export class Logger {
  constructor(private name: string, private debugEnabled = false) {}
  info(message: string, ...args: unknown[]) { console.info(`[${this.name}] ${format(message, ...args)}`) }
  warn(message: string, ...args: unknown[]) { console.warn(`[${this.name}] ${format(message, ...args)}`) }
  error(message: string, ...args: unknown[]) { console.error(`[${this.name}] ${format(message, ...args)}`) }
  debug(message: string, ...args: unknown[]) { if (this.debugEnabled) this.info(message, ...args) }
}

type CommandAction = (event: { session: MessageSession }, ...args: any[]) => Promise<unknown>
interface RegisteredCommand { name: string; spec: string; action?: CommandAction }

/** Lifecycle utilities for the standalone bot. */
export class Runtime {
  bots: BotTransport[] = []
  puppeteer?: { page(): Promise<any>; close(): Promise<void> }
  private timers = new Set<NodeJS.Timeout>()
  private commands = new Map<string, RegisteredCommand>()
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

  command(spec: string, _description: string) {
    const name = spec.split(' ')[0]
    const command: RegisteredCommand = { name, spec }
    this.commands.set(name, command)
    return { action: (action: CommandAction) => { command.action = action } }
  }

  dispatchCommand(session: MessageSession) {
    const content = session.content.trim().replace(/^\//, '')
    const match = /^([^\s@]+)(?:@[^\s]+)?(?:\s+([\s\S]*))?$/.exec(content)
    const command = match && this.commands.get(match[1])
    if (!command) return undefined
    const remaining = match?.[2]?.trim() ?? ''
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
      if (typeof result === 'string' && result.trim() && !this.stopped) await session.send(result)
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
