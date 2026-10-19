import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { resolveConfig } from './config'
import { modelApiKey } from './narrator'
import { InterludeService } from './service'
import { Runtime } from './runtime'
import { Storage } from './database'
import { commandMenu, registerCommands } from './commands'
import { assertMacOS, readTelegramEnvironment, TelegramBot, telegramPrivateEvent } from './adapters/telegram-private'
import { routeInbound } from './router/router'
import { runMigrations } from './memory/migrate'

export async function loadConfig(path = resolve('config.json')) {
  let input: unknown
  try { input = JSON.parse(await readFile(path, 'utf8')) } catch {
    throw new Error('无法读取 config.json；请复制 config.example.json 并填写角色设定。')
  }
  const config = resolveConfig(input, process.env)
  if (!config.storyDefaults.characterProfile.trim()) throw new Error('请填写 storyDefaults.characterProfile。')
  return config
}

export async function start() {
  assertMacOS()
  const env = readTelegramEnvironment()
  if (!modelApiKey()) throw new Error('请填写环境变量 LLM_API_KEY。')
  const config = await loadConfig()
  await mkdir(resolve('data'), { recursive: true })
  const storage = new Storage(resolve('data/interlude.sqlite'))
  await runMigrations(storage)
  const runtime = new Runtime(storage, config.logging.level === 'debug')
  const bot = new TelegramBot(env, storage, config.model.vision?.enabled === true)
  runtime.bots.push(bot)
  const service = new InterludeService(runtime, config, env)
  if (!config.blindMode?.enabled) registerCommands(runtime, service)
  let stopPromise: Promise<void> | undefined
  const stop = () => stopPromise ??= (async () => {
    bot.stop()
    try { await runtime.stop() } finally {
      try { await service.shutdown() } finally { storage.close() }
    }
  })()
  const signalHandler = () => { void stop().catch(() => { process.exitCode = 1 }) }
  process.once('SIGINT', signalHandler)
  process.once('SIGTERM', signalHandler)
  try {
    if (config.browser?.enabled) {
      const puppeteer = await import('puppeteer-core')
      const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
      if (runtime.stopped) { await browser.close(); return }
      runtime.puppeteer = { page: () => browser.newPage(), close: () => browser.close() }
    }
    if (runtime.stopped) return
    console.info('正在连接 Telegram；按 Ctrl+C 停止。')
    await bot.setOwnerCommands(config.runtime.ignoreCommandMessages ? commandMenu(runtime) : []).catch(() => console.warn('Telegram 命令菜单设置失败，命令仍可手动输入。'))
    await bot.run(async session => {
      if (!service.canHandleSession(session) && !service.canHandleGroupSession(session)) return
      // Short menu names (/status) only count as commands for the owner; elsewhere they stay ordinary messages as before.
      const isCommand = /^[!/.]?interlude(?:[.\s]|$)/i.test(session.content.trim())
        || service.canManageSession(session) && runtime.hasCommand(session.content)
      if (isCommand && config.blindMode?.enabled) return
      if (isCommand && config.runtime.ignoreCommandMessages) {
        // Management commands are owner-only; other chats get no reply so the command set is not revealed.
        if (!service.canManageSession(session)) return
        // Confirmation prompts must leave polling free to receive the answer.
        void runtime.dispatchCommand(session)?.catch(() => console.warn('管理命令执行失败。'))
        return
      }
      if (session.isDirect) { if (config.runtime.captureDirectMessages) await service.receive(routeInbound(telegramPrivateEvent(session), { ownerChatId: env.ownerChatId })) }
      else await service.receiveGroup(session)
    }, config.tools?.enabled ? callback => service.handleCallback(callback) : undefined)
  } finally {
    await stop()
    process.removeListener('SIGINT', signalHandler)
    process.removeListener('SIGTERM', signalHandler)
  }
}

if (require.main === module) {
  void start().catch(error => {
    console.error(error instanceof Error ? error.message : '启动失败。')
    process.exitCode = 1
  })
}
