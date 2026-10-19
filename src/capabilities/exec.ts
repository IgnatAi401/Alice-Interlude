import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import type { ToolsConfig } from '../config'
import { clip, isRecord } from '../util'
import type { Tool } from './registry'
import { expandHome } from './skills'

export type ExecConfig = ToolsConfig['exec']
export type ApprovalStatus = 'proposed' | 'pending' | 'running' | 'done' | 'denied' | 'expired' | 'cancelled' | 'interrupted'

/** One requested command and its audit trail (table interlude_approval). */
export interface ExecApproval {
  id: number
  storyId: string
  participantId: string
  turnId: string
  command: string
  reason: string
  status: ApprovalStatus
  createdAt: Date
  requestedAt?: Date
  expiresAt?: Date
  decidedAt?: Date
  finishedAt?: Date
  chatId?: string
  messageId?: string
  exitCode?: number | null
  signal?: string | null
  timedOut?: boolean
  /** Merged stdout+stderr, truncated to maxOutputChars. Kept only here, never in long-term memory (roadmap §3.6). */
  output?: string
}

export interface ApprovalBackend {
  get(query: Record<string, unknown>, options?: Record<string, unknown>): Promise<ExecApproval[]>
  create(row: Omit<ExecApproval, 'id'>): Promise<ExecApproval>
  /** Conditional update: returns how many rows matched the query. Writes must be serialized by the caller. */
  set(query: Record<string, unknown>, patch: Partial<ExecApproval>): Promise<number>
}

const MAX_COMMAND_CHARS = 2_000
export const hasSudo = (command: string) => /(?:^|[\s;&|(`$])sudo(?:\s|$)/.test(command)

/**
 * Approval lifecycle (roadmap §3.5): proposed (inside a turn) → pending (turn
 * delivered, buttons sent) → running → done, or denied / expired / cancelled.
 * Every transition is a status-conditioned update, so a second tap, a late
 * tap or a tap on an expired request changes nothing (S7).
 */
export class ApprovalStore {
  constructor(private db: ApprovalBackend, private config: () => ExecConfig) {}

  async propose(input: { storyId: string; participantId: string; turnId: string; command: string; reason: string }, now: Date) {
    const open = await this.db.get({ status: { $in: ['proposed', 'pending', 'running'] } })
    if (open.length >= this.config().maxPending) throw new Error(`已有 ${open.length} 条命令在等待审批或执行，请等主人处理后再请求。`)
    return this.db.create({ ...input, status: 'proposed', createdAt: now })
  }

  /** The turn was delivered: start the expiry clock. */
  async activate(turnId: string, now: Date) {
    const rows = await this.db.get({ turnId, status: 'proposed' }, { sort: { id: 'asc' } })
    const expiresAt = new Date(now.getTime() + this.config().approvalTtlMinutes * 60_000)
    const activated: ExecApproval[] = []
    for (const row of rows) {
      if (await this.db.set({ id: row.id, status: 'proposed' }, { status: 'pending', requestedAt: now, expiresAt })) {
        activated.push({ ...row, status: 'pending', requestedAt: now, expiresAt })
      }
    }
    return activated
  }

  /** The turn was discarded or failed: its requests never reach the owner. */
  async cancelTurn(turnId: string, now: Date) {
    await this.db.set({ turnId, status: 'proposed' }, { status: 'cancelled', decidedAt: now })
  }

  async attachMessage(id: number, chatId: string, messageId: string) {
    await this.db.set({ id }, { chatId, messageId })
  }

  /** pending → running (approve) or pending → denied. Returns the row only when this call made the change. */
  async decide(id: number, approve: boolean, now: Date) {
    const row = (await this.db.get({ id }))[0]
    if (!row || row.status !== 'pending') return { row, changed: false as const }
    if (!row.expiresAt || row.expiresAt.getTime() <= now.getTime()) {
      await this.db.set({ id, status: 'pending' }, { status: 'expired', decidedAt: now })
      return { row: { ...row, status: 'expired' as const }, changed: false as const }
    }
    const status = approve ? 'running' : 'denied'
    if (!await this.db.set({ id, status: 'pending' }, { status, decidedAt: now })) return { row, changed: false as const }
    return { row: { ...row, status, decidedAt: now } as ExecApproval, changed: true as const }
  }

  /** running → done; undefined when the row is no longer running. */
  async finish(id: number, result: CommandResult, now: Date) {
    const patch = { status: 'done' as const, finishedAt: now, ...result }
    return await this.db.set({ id, status: 'running' }, patch) ? patch : undefined
  }

  /** pending past its deadline → expired; returns the rows this call expired. */
  async expireDue(now: Date) {
    const rows = await this.db.get({ status: 'pending', expiresAt: { $lte: now } })
    const expired: ExecApproval[] = []
    for (const row of rows) {
      if (await this.db.set({ id: row.id, status: 'pending' }, { status: 'expired', decidedAt: now })) expired.push({ ...row, status: 'expired' })
    }
    return expired
  }

  /**
   * After a restart: unsent proposals are dropped and commands cut off mid-run
   * are marked interrupted. Only rows from before bootedAt are touched, so a
   * request or tap handled by this process meanwhile is left alone.
   */
  async recoverAfterRestart(bootedAt: Date, now: Date) {
    await this.db.set({ status: 'proposed', createdAt: { $lte: bootedAt } }, { status: 'cancelled', decidedAt: now })
    const running = await this.db.get({ status: 'running', decidedAt: { $lte: bootedAt } })
    for (const row of running) await this.db.set({ id: row.id, status: 'running' }, { status: 'interrupted', finishedAt: now })
    return running.map(row => ({ ...row, status: 'interrupted' as const }))
  }

  pending() { return this.db.get({ status: 'pending' }, { sort: { id: 'asc' } }) }
  recent(limit: number) { return this.db.get({}, { sort: { id: 'desc' }, limit }) }
  get(id: number) { return this.db.get({ id }).then(rows => rows[0]) }
}

/** exec never runs anything itself: it files a request the owner must approve in Telegram. */
export function createExecTool(store: ApprovalStore, ttlMinutes: () => number): Tool {
  return {
    name: 'exec',
    description: 'Ask to run one shell command (/bin/zsh -c) on the owner\'s Mac, for example curl to read a web page. Nothing runs now: the owner must approve it in Telegram first. The result arrives in a later turn as a dueIntents item of type tool-result. Never use sudo; prefer read-only commands and say why the command is needed.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: `The exact command, at most ${MAX_COMMAND_CHARS} characters.` },
        reason: { type: 'string', description: 'One short sentence for the owner: why this command is needed.' },
      },
      required: ['command', 'reason'],
      additionalProperties: false,
    },
    describe: input => `exec 请求「${clip(isRecord(input) ? String(input.command ?? '').replace(/\s+/g, ' ') : '', 60)}」`,
    async run(input, ctx) {
      if (!isRecord(input) || typeof input.command !== 'string' || !input.command.trim()) throw new Error('缺少 command。')
      const command = input.command.trim()
      if (command.length > MAX_COMMAND_CHARS || command.includes('\u0000')) throw new Error('命令过长或含非法字符。')
      if (!ctx.storyId || !ctx.participantId || !ctx.turnId) throw new Error('本回合不能请求执行命令。')
      const reason = typeof input.reason === 'string' ? clip(input.reason.trim(), 300) : ''
      const approval = await store.propose({ storyId: ctx.storyId, participantId: ctx.participantId, turnId: ctx.turnId, command, reason }, new Date())
      return `已请求主人批准（审批 #${approval.id}，${ttlMinutes()} 分钟内有效）。命令还没有运行；主人在 Telegram 点【执行】后才会运行，结果会在之后的回合交给你。现在不要假装已经知道结果。`
    },
  }
}

export interface CommandResult { exitCode: number | null; signal: string | null; timedOut: boolean; output: string }

/** Only these variables reach the child; secrets such as LLM_API_KEY, ANTHROPIC_API_KEY and TELEGRAM_BOT_TOKEN never do (S8). */
const ENV_ALLOWLIST = ['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR', 'TZ'] as const

export function commandEnvironment(source: NodeJS.ProcessEnv = process.env) {
  const env: Record<string, string> = { SHELL: '/bin/zsh', TERM: 'dumb', PATH: '/usr/bin:/bin:/usr/sbin:/sbin' }
  for (const key of ENV_ALLOWLIST) if (source[key]) env[key] = source[key]!
  return env
}

/** Runs one approved command: own process group, timeout, merged output with head and tail kept. */
export async function runCommand(command: string, config: ExecConfig): Promise<CommandResult> {
  const cwd = expandHome(config.workdir)
  await mkdir(cwd, { recursive: true })
  const keep = config.maxOutputChars * 4
  let head = Buffer.alloc(0), tail = Buffer.alloc(0), total = 0
  const collect = (chunk: Buffer) => {
    total += chunk.length
    if (head.length < keep) {
      const room = keep - head.length
      head = Buffer.concat([head, chunk.subarray(0, room)])
      chunk = chunk.subarray(room)
    }
    if (chunk.length) tail = Buffer.concat([tail, chunk]).subarray(-keep)
  }
  return new Promise(resolve => {
    const child = spawn('/bin/zsh', ['-c', command], { cwd, env: commandEnvironment(), stdio: ['ignore', 'pipe', 'pipe'], detached: true })
    let timedOut = false, finished = false
    // A finished group id may be reused by another process; never signal after close.
    const killGroup = (signal: NodeJS.Signals) => { if (!finished && child.pid) try { process.kill(-child.pid, signal) } catch { /* already gone */ } }
    const timer = setTimeout(() => {
      timedOut = true
      killGroup('SIGTERM')
      setTimeout(() => killGroup('SIGKILL'), 2_000).unref()
    }, config.timeoutSeconds * 1000)
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    const done = (exitCode: number | null, signal: string | null, extra = '') => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      const text = (head.toString('utf8') + (tail.length ? `\n…[省略 ${total - head.length - tail.length} 字节]…\n${tail.toString('utf8')}` : '')) + extra
      resolve({ exitCode, signal, timedOut, output: truncateMiddle(text, config.maxOutputChars) })
    }
    child.on('error', error => done(null, null, `\n[无法启动命令：${error.message}]`))
    child.on('close', (code, signal) => done(code, signal))
  })
}

function truncateMiddle(text: string, max: number) {
  if (text.length <= max) return text
  const front = Math.floor(max * 0.6), back = max - front
  return `${text.slice(0, front)}\n…[省略 ${text.length - max} 字]…\n${text.slice(-back)}`
}
