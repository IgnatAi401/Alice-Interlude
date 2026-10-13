import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { clip, isRecord } from '../util'
import type { Tool } from './registry'

export interface SkillInfo { name: string; description: string; file: string }

const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/i

export function expandHome(path: string) {
  return path === '~' || path.startsWith('~/') ? join(homedir(), path.slice(1)) : resolve(path)
}

/**
 * Index of <dir>/<skill>/SKILL.md (roadmap §3.4). Rebuilt only when the
 * directory or any SKILL.md changes, checked before each owner turn.
 */
export class SkillIndex {
  private cache?: { key: string; dir: string; skills: SkillInfo[] }

  constructor(private dir: () => string) {}

  async list(): Promise<SkillInfo[]> {
    const dir = expandHome(this.dir())
    let names: string[]
    try {
      names = (await readdir(dir, { withFileTypes: true })).filter(item => item.isDirectory() && NAME.test(item.name)).map(item => item.name).sort()
    } catch { return [] }
    const files = names.map(name => join(dir, name, 'SKILL.md'))
    const stamps = await Promise.all(files.map(file => stat(file).then(info => info.isFile() ? info.mtimeMs : -1, () => -1)))
    const key = names.map((name, index) => `${name}:${stamps[index]}`).join('|')
    if (this.cache?.dir === dir && this.cache.key === key) return this.cache.skills
    const skills: SkillInfo[] = []
    for (const [index, file] of files.entries()) {
      if (stamps[index] < 0) continue
      const meta = frontmatter(await readFile(file, 'utf8').catch(() => ''))
      // The index key is the directory name unless frontmatter names it; either way it must be a plain name.
      const name = NAME.test(meta.name ?? '') ? meta.name! : names[index]
      if (skills.some(skill => skill.name === name)) continue
      skills.push({ name, description: clip((meta.description ?? '').replace(/\s+/g, ' ').trim(), 200), file })
    }
    this.cache = { key, dir, skills }
    return skills
  }

  /** The skills index for the owner system prompt, after the tool guidance. */
  async promptNotes() {
    const skills = await this.list()
    if (!skills.length) return 'SKILLS: none are installed; read_skill has nothing to read.'
    return ['SKILLS: step-by-step guides the owner installed. Call read_skill with the exact name before following one.',
      ...skills.map(skill => `- ${skill.name}: ${skill.description || '(no description)'}`)].join('\n')
  }
}

/** Only names from the index are accepted, never paths, so `../` cannot reach other files. */
export function createReadSkillTool(index: SkillIndex, maxChars: () => number): Tool {
  return {
    name: 'read_skill',
    description: 'Read the full SKILL.md of one installed skill listed in the SKILLS index of the system prompt.',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Exact skill name from the SKILLS index.' } },
      required: ['name'],
      additionalProperties: false,
    },
    describe: input => `read_skill ${clip(isRecord(input) ? String(input.name ?? '') : '', 64)}`,
    async run(input) {
      const name = isRecord(input) && typeof input.name === 'string' ? input.name.trim() : ''
      const skill = (await index.list()).find(item => item.name === name)
      if (!skill) throw new Error('没有这个 skill；只能使用索引中列出的名字。')
      const text = await readFile(skill.file, 'utf8')
      const limit = maxChars()
      return text.length > limit ? `${text.slice(0, limit)}\n[内容已截断]` : text
    },
  }
}

/** Minimal `key: value` frontmatter; nested YAML is not needed for name and description. */
function frontmatter(text: string): { name?: string; description?: string } {
  const match = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!match) return {}
  const result: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^(name|description)\s*:\s*(.*)$/.exec(line)
    if (pair) result[pair[1]] = pair[2].trim().replace(/^(['"])(.*)\1$/, '$2')
  }
  return result
}
