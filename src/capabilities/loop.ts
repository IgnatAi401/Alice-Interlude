import type { ToolContext, ToolDefinition, ToolRegistry, ToolResult } from './registry'

/** Content blocks the tool loop reads from or adds to a Messages exchange. */
export interface ToolUseBlock { type: 'tool_use'; id: string; name: string; input: unknown }
export interface ToolResultBlock { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
export interface LoopMessage { role: 'user' | 'assistant'; content: unknown[] }
export interface LoopResponse { content?: Array<{ type: string; [key: string]: unknown }>; stop_reason?: string }
export type ToolChoice = { type: 'auto' } | { type: 'none' }

/** What one narrative turn may call; the narrator stays unaware of tiers and the registry. */
export interface TurnTools {
  definitions: ToolDefinition[]
  /** Extra tier-specific guidance for the system prompt, such as the skills index. */
  promptNotes: string
  /** Rounds of tool execution before the loop forces a final answer. */
  maxSteps: number
  execute(name: string, input: unknown): Promise<ToolResult>
}

export interface ToolCallRecord { name: string; summary: string; durationMs: number; resultChars: number; isError: boolean }

/**
 * Tools for one turn. The tier is fixed at construction from the turn's event,
 * never from model output. Identical calls are answered from a memo, so a
 * recovery rewrite of the same turn does not repeat side effects.
 */
export class TurnToolSession implements TurnTools {
  readonly calls: ToolCallRecord[] = []
  readonly definitions: ToolDefinition[]
  promptNotes: string
  readonly maxSteps: number
  readonly turnId?: string
  private memo = new Map<string, Promise<ToolResult>>()
  private log?: (message: string, ...args: unknown[]) => void

  constructor(private registry: ToolRegistry, private ctx: ToolContext, options: {
    promptNotes?: string; maxSteps: number; log?: (message: string, ...args: unknown[]) => void
  }) {
    this.definitions = registry.definitionsFor(ctx.tier)
    this.promptNotes = options.promptNotes ?? ''
    this.maxSteps = options.maxSteps
    this.turnId = ctx.turnId
    this.log = options.log
  }

  execute(name: string, input: unknown): Promise<ToolResult> {
    const key = `${name}\u0000${stableJson(input)}`
    let result = this.memo.get(key)
    if (!result) {
      result = this.run(name, input)
      this.memo.set(key, result)
    }
    return result
  }

  private async run(name: string, input: unknown) {
    const startedAt = Date.now()
    const result = await this.registry.execute(name, input, this.ctx)
    const record = {
      name, summary: this.registry.describe(name, input), durationMs: Date.now() - startedAt,
      resultChars: result.content.length, isError: result.is_error,
    }
    this.calls.push(record)
    // Never log tool output itself: it can hold page text, memories or command output.
    this.log?.('工具调用 工具=%s 耗时=%dms 结果长度=%d 出错=%s', name, record.durationMs, record.resultChars, record.isError)
    return result
  }
}

const STEP_LIMIT_NOTICE = 'The tool step limit for this turn has been reached. Do not call more tools; give the final JSON answer now using what you already have.'

/**
 * Native tool use loop (roadmap §3.1): request → tool_use → host executes →
 * tool_result → request again. After maxSteps rounds of tool execution one
 * last request forbids tools, so a turn costs at most maxSteps + 1 requests.
 * Intermediate messages never leave this function.
 */
export async function runToolLoop(
  firstContent: unknown[],
  tools: TurnTools,
  request: (messages: LoopMessage[], toolChoice: ToolChoice) => Promise<LoopResponse>,
): Promise<LoopResponse> {
  const messages: LoopMessage[] = [{ role: 'user', content: firstContent }]
  for (let step = 1; ; step++) {
    const response = await request(messages, { type: 'auto' })
    const uses = (response.content ?? []).filter((block): block is ToolUseBlock & { [key: string]: unknown } =>
      block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string')
    if (response.stop_reason !== 'tool_use' || !uses.length) return response
    messages.push({ role: 'assistant', content: response.content ?? [] })
    const results: unknown[] = []
    // Sequential on purpose: tools may have side effects and the order should match the model's.
    for (const use of uses) {
      const result = await tools.execute(use.name, use.input)
      results.push({ type: 'tool_result', tool_use_id: use.id, content: result.content, ...(result.is_error ? { is_error: true } : {}) } satisfies ToolResultBlock)
    }
    if (step >= tools.maxSteps) {
      messages.push({ role: 'user', content: [...results, { type: 'text', text: STEP_LIMIT_NOTICE }] })
      return request(messages, { type: 'none' })
    }
    messages.push({ role: 'user', content: results })
  }
}

/** Key order-independent JSON, so {a,b} and {b,a} hit the same memo entry. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}
