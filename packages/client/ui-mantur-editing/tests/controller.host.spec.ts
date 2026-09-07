import { Context } from '@deepseek-ai/cordis'
import { createScope, scopeOf } from '@deepseek-ai/dsh-scope'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { afterEach, expect, it, vi } from 'vitest'
import ManturEditing, { Config } from '../src/index.ts'

const harness = vi.hoisted(() => ({ start: vi.fn(), connect: vi.fn(), scopes: [] as unknown[], stopped: [] as ReturnType<typeof vi.fn>[] }))
vi.mock('../src/runtime.ts', () => ({ startEditor: harness.start }))
vi.mock('@deepseek-ai/dsh-mcp-client', () => ({
  name: 'mcp-client', Config: undefined, inject: [],
  async apply(ctx: Context) {
    harness.scopes.push(scopeOf(ctx))
    await harness.connect()
  },
}))
const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  harness.start.mockReset(); harness.connect.mockReset(); harness.scopes.length = 0; harness.stopped.length = 0
})
const config: Config = { runtimeMode: 'development', editorRoot: '/editor', nodeExecutable: '/node', startupTimeoutMs: 1000, stopTimeoutMs: 1000, toolCallTimeoutMs: 1000 }

it('requires explicit runtime paths and positive operation budgets', () => {
  expect(() => Config({} as Config)).toThrow()
  expect(() => Config({ ...config, runtimeMode: undefined } as unknown as Config)).toThrow()
  for (const key of ['startupTimeoutMs', 'stopTimeoutMs', 'toolCallTimeoutMs'] as const) {
    expect(() => Config({ ...config, [key]: 0 })).toThrow()
  }
  expect(Config(config)).toEqual(config)
  for (const key of ['editorRoot', 'nodeExecutable'] as const) {
    const ctx = new Context()
    contexts.push(ctx)
    ctx.provide('typert', {} as never)
    expect(() => new ManturEditing(ctx, { ...config, [key]: 'relative-path' })).toThrow('absolute')
  }
})
async function setup() {
  const ctx = new Context()
  contexts.push(ctx)
  ctx.provide('typert', {} as never)
  ctx.provide('tools', {} as never)
  ctx.provide('webServer', { port: 5298 } as never)
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
  harness.start.mockImplementation(async (_config: Config, cwd: string, id: SessionId) => {
    const dispose = vi.fn(async () => {})
    harness.stopped.push(dispose)
    return { workspace: { editorUrl: 'http://127.0.0.1:5300/', directory: `${cwd}/${id}` }, token: 'host-secret', dispose, assertRunning() {} }
  })
  const fiber = ctx.plugin(ManturEditing, config)
  await fiber.await()
  const makeAgent = (id: string) => {
    const key = {}
    const scope = createScope(ctx, key)
    return { agent: { id: id as SessionId, ctx: scope.ctx, session: { header: { cwd: `/project-${id}` } } } as Agent, scope, key }
  }
  return { ctx, fiber, makeAgent }
}

it('coalesces repeated opens and binds different Sessions to different tool scopes', async () => {
  const { ctx, fiber, makeAgent } = await setup()
  const a = makeAgent('a'); const b = makeAgent('b')
  const values = await Promise.all([
    ctx.manturEditing.open(a.agent, 'http://127.0.0.1:5298'),
    ctx.manturEditing.open(a.agent, 'http://127.0.0.1:5298'),
    ctx.manturEditing.open(b.agent, 'http://127.0.0.1:5298'),
  ])
  expect(harness.start).toHaveBeenCalledTimes(2)
  expect(values[0]).toEqual(values[1])
  expect(values[0]?.directory).not.toBe(values[2]?.directory)
  expect(harness.scopes).toEqual([scopeOf(a.scope.ctx), scopeOf(b.scope.ctx)])
  expect(harness.scopes).not.toContain(undefined)
  expect(values.every(value => !('token' in value))).toBe(true)
  await a.scope.dispose()
  expect(harness.stopped[0]).toHaveBeenCalledOnce()
  expect(harness.stopped[1]).not.toHaveBeenCalled()
  await fiber.dispose()
  expect(harness.stopped[1]).toHaveBeenCalledOnce()
})

it('rejects a different browser origin before creating directories or tools', async () => {
  const { ctx, makeAgent } = await setup()
  const { agent } = makeAgent('a')
  await expect(ctx.manturEditing.open(agent, 'http://127.0.0.1:9999')).rejects.toThrow('local Mantur origin')
  await expect(ctx.manturEditing.open(agent, 'https://example.com')).rejects.toThrow('local Mantur origin')
  expect(harness.start).not.toHaveBeenCalled()
})

it('lets an explicit retry start again after failure', async () => {
  const { ctx, makeAgent } = await setup()
  const { agent, key } = makeAgent('a')
  harness.start.mockRejectedValueOnce(new Error('Disk is unavailable'))
  await expect(ctx.manturEditing.open(agent, 'http://127.0.0.1:5298')).rejects.toThrow('Disk is unavailable')
  expect(await editingSections(ctx, key)).toEqual([])
  await expect(ctx.manturEditing.open(agent, 'http://127.0.0.1:5298')).resolves.toMatchObject({ directory: '/project-a/a' })
})

it('keeps workflow guidance with the opened Agent and removes it on owner disposal', async () => {
  const { ctx, fiber, makeAgent } = await setup()
  const a = makeAgent('a'); const b = makeAgent('b')
  expect(await editingSections(ctx, a.key)).toEqual([])
  await ctx.manturEditing.open(a.agent, 'http://127.0.0.1:5298')
  await ctx.manturEditing.open(a.agent, 'http://127.0.0.1:5298')
  expect((await editingSections(ctx, a.key)).map(section => section.name))
    .toEqual(['mantur:editing-workflow'])
  expect(await editingSections(ctx, b.key)).toEqual([])
  expect(await editingSections(ctx)).toEqual([])
  await ctx.manturEditing.open(b.agent, 'http://127.0.0.1:5298')
  await a.scope.dispose()
  expect(await editingSections(ctx, a.key)).toEqual([])
  expect(await editingSections(ctx, b.key)).toHaveLength(1)
  await fiber.dispose()
  expect(await editingSections(ctx, b.key)).toEqual([])
})

async function editingSections(ctx: Context, scope?: object) {
  const assembly = await ctx.systemPrompt.assemble(scope === undefined ? {} : { scope })
  return assembly.sections.filter(section => section.name === 'mantur:editing-workflow')
}

it('does not publish guidance when native MCP startup fails', async () => {
  const { ctx, makeAgent } = await setup()
  const { agent, key } = makeAgent('a')
  harness.connect.mockRejectedValueOnce(new Error('MCP unavailable'))
  await expect(ctx.manturEditing.open(agent, 'http://127.0.0.1:5298')).rejects.toThrow('MCP unavailable')
  expect(await editingSections(ctx, key)).toEqual([])
  expect(harness.stopped[0]).toHaveBeenCalledOnce()
  await ctx.manturEditing.open(agent, 'http://127.0.0.1:5298')
  expect(await editingSections(ctx, key)).toHaveLength(1)
})
