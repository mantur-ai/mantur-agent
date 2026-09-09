import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { afterEach, beforeEach, expect, it } from 'vitest'
import ManturScript from '../src/index.ts'

let ctx: Context
let root: string
let agent: Agent
const content = '# 第一集\n\n😀林夏：你终于来了。\n\n林夏：你终于来了。\n'
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-script-'))
  await writeFile(join(root, '01.md'), content)
  ctx = new Context()
  ctx.provide('typert', {} as never)
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(LocalFileSystem, { cwd: root })
  await ctx.plugin(ManturScript, { maxBytes: 4096, maxEntries: 20 })
  agent = { ctx, session: { header: { cwd: root } } } as Agent
})
afterEach(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })

it('saves the observed file and refuses a stale generation without overwriting the external edit', async () => {
  const original = await ctx.manturScript.read(agent, '01.md')
  const written = await ctx.manturScript.save(agent, { ...original, content: '# 改写\n' })
  expect(written.version).not.toBe(original.version)
  expect(await readFile(join(root, '01.md'), 'utf8')).toBe('# 改写\n')
  await writeFile(join(root, '01.md'), '外部修改')
  await expect(ctx.manturScript.save(agent, { ...written, content: '不能覆盖' })).rejects.toMatchObject({ code: 'FS_STALE_VERSION' })
  expect(await readFile(join(root, '01.md'), 'utf8')).toBe('外部修改')
})

it('replaces only the second repeated passage using UTF-16 offsets and publishes the tool result', async () => {
  const observed = await ctx.manturScript.read(agent, '01.md')
  const selected = '林夏：你终于来了。'
  const start = observed.content.lastIndexOf(selected)
  const args = { path: observed.path, version: observed.version, start, end: start + selected.length, selected, replacement: '林夏：我等了你很久。' }
  const result = await ctx.tools.execute({ name: 'replace_script_selection', arguments: args, agent, callId: ToolCallId('rewrite-second'), signal: new AbortController().signal })
  expect(result.isError).toBe(false)
  expect(await readFile(join(root, '01.md'), 'utf8')).toBe(content.slice(0, start) + args.replacement + content.slice(args.end))
  expect(result.content).toHaveLength(1)
  const block = result.content[0]
  expect(block?.type).toBe('text')
  if (block?.type === 'text') expect(block.text).toContain('林夏：我等了你很久。')
  const stale = await ctx.tools.execute({ name: 'replace_script_selection', arguments: args, agent, callId: ToolCallId('stale'), signal: new AbortController().signal })
  expect(stale.isError).toBe(true)
})

it('refuses a wrong selection and an aborted tool without modifying the document', async () => {
  const observed = await ctx.manturScript.read(agent, '01.md')
  const args = { path: observed.path, version: observed.version, start: 0, end: 3, selected: '不存在', replacement: '错误' }
  for (const signal of [new AbortController().signal, AbortSignal.abort()]) {
    const result = await ctx.tools.execute({ name: 'replace_script_selection', arguments: args, agent, callId: ToolCallId('wrong'), signal })
    expect(result.isError).toBe(true)
  }
  expect(await readFile(join(root, '01.md'), 'utf8')).toBe(content)
})

it('rejects cross-project paths and symlinks and never substitutes a process directory', async () => {
  const other = join(root, 'other')
  await mkdir(other)
  await writeFile(join(other, '02.md'), '# 第二集')
  const otherAgent = { ctx, session: { header: { cwd: other } } } as Agent
  await expect(ctx.manturScript.read(otherAgent, '../01.md')).rejects.toMatchObject({ code: 'FS_PERMISSION_DENIED' })
  await symlink(join(root, '01.md'), join(other, 'outside.md'))
  await expect(ctx.manturScript.read(otherAgent, 'outside.md')).rejects.toMatchObject({ code: 'FS_PERMISSION_DENIED' })
  await expect(ctx.manturScript.list({ ctx, session: { header: {} } } as Agent, '')).rejects.toThrow('project directory')
})

it('lists direct script files and folders without treating arbitrary project files as episodes', async () => {
  await writeFile(join(root, 'ignore.json'), '{}')
  await writeFile(join(root, '.hidden.md'), 'private')
  await mkdir(join(root, 'scripts'))
  expect((await ctx.manturScript.list(agent, '')).map(x => [x.name, x.directory])).toEqual([['scripts', true], ['01.md', false]])
  await expect(ctx.manturScript.read(agent, 'ignore.json')).rejects.toThrow('Markdown')
})

it('normalizes CRLF before selection and rejects oversized or invalid UTF-8 documents', async () => {
  await writeFile(join(root, '01.md'), '# 标题\r\n正文\r\n')
  expect((await ctx.manturScript.read(agent, '01.md')).content).toBe('# 标题\n正文\n')
  const current = await ctx.manturScript.read(agent, '01.md')
  await expect(ctx.manturScript.save(agent, { ...current, content: '文'.repeat(2000) })).rejects.toMatchObject({ code: 'FS_TOO_LARGE' })
  await writeFile(join(root, '01.md'), Buffer.from([0xff, 0xfe, 0xff]))
  await expect(ctx.manturScript.read(agent, '01.md')).rejects.toThrow()
})
