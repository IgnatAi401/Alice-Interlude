import { tierAllowsTool, type Tier } from '../router/tiers'

/** Per-call context. tier comes from the turn's InboundEvent (or 'system'), never from model output. */
export interface ToolContext {
  tier: Tier
  participantKey?: string
  signal?: AbortSignal
}

/** Anthropic Messages tool definition, as sent in the request's `tools` array. */
export interface ToolDefinition {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export interface Tool extends ToolDefinition {
  run(input: unknown, ctx: ToolContext): Promise<string>
}

/** Shape of an Anthropic `tool_result` content block, minus tool_use_id which the loop adds. */
export interface ToolResult {
  content: string
  is_error: boolean
}

type WarnLogger = (message: string, ...args: unknown[]) => void

/**
 * Tool registry with two independent checks (roadmap §2.3):
 * exposure — definitionsFor(tier) only lists tools the tier may use;
 * execution — execute() re-checks the tier, so a tool name invented by the
 * model or a tool omitted from the request still cannot run.
 */
export class ToolRegistry {
  private tools = new Map<string, Tool>()

  constructor(private warn: WarnLogger = (message, ...args) => console.warn(message, ...args)) {}

  register(tool: Tool) {
    if (this.tools.has(tool.name)) throw new Error(`工具重复注册：${tool.name}`)
    this.tools.set(tool.name, tool)
  }

  /** Sorted by name so each tier's tools prefix stays byte-stable for prompt caching. */
  definitionsFor(tier: Tier): ToolDefinition[] {
    return [...this.tools.values()]
      .filter(tool => tierAllowsTool(tier, tool.name))
      .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
      .map(({ name, description, input_schema }) => ({ name, description, input_schema }))
  }

  async execute(name: string, input: unknown, ctx: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(name)
    if (!tool || !tierAllowsTool(ctx.tier, name)) {
      // Log only the name and tier; the input may carry untrusted text.
      this.warn('工具调用被拒绝 工具=%s 等级=%s 原因=%s', name, ctx.tier, tool ? '等级不允许' : '未注册')
      return { content: '该工具在此渠道不可用。', is_error: true }
    }
    try {
      return { content: await tool.run(input, ctx), is_error: false }
    } catch (error) {
      if (ctx.signal?.aborted) throw error
      this.warn('工具执行失败 工具=%s', name)
      return { content: `工具执行失败：${error instanceof Error ? error.message : '未知错误'}`, is_error: true }
    }
  }
}
