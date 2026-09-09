import { Context } from '@deepseek-ai/cordis'
import { createScope, scopeOf } from '@deepseek-ai/dsh-scope'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ConnectionHandle } from '@deepseek-ai/dsh-mcp-client'
import type { startEditor } from '../src/runtime.ts'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { afterEach, expect, it, vi } from 'vitest'
import ManturEditing, { Config } from '../src/index.ts'

const harness = vi.hoisted(() => ({
  start: vi.fn<typeof startEditor>(), connect: vi.fn<() => void | Promise<void>>(), drain: vi.fn<() => void | Promise<void>>(),
  scopes: [] as unknown[],
  stopped: [] as ReturnType<typeof vi.fn>[], connections: [] as ConnectionHandle[],
}))
vi.mock('../src/runtime.ts', () => ({ startEditor: harness.start }))
vi.mock('@deepseek-ai/dsh-mcp-client', () => ({
  connectMcpServer(ctx: Context, _config: unknown, beforeClose: () => Promise<void>) {
    harness.scopes.push(scopeOf(ctx))
    let draining: Promise<void> | undefined
    let disposal: Promise<void> | undefined
    const handle: ConnectionHandle = {
      ready: Promise.resolve().then(() => harness.connect()).then(() => ({})),
      stopAccepting: () => draining ??= Promise.resolve().then(() => harness.drain()),
      dispose: () => disposal ??= (async () => { await handle.stopAccepting(); await beforeClose() })(),
    }
    ctx.effect(() => () => handle.dispose(), 'fixture MCP shutdown')
    harness.connections.push(handle)
    return handle
  },
}))
const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  harness.start.mockReset(); harness.connect.mockReset(); harness.drain.mockReset()
  harness.scopes.length = 0; harness.stopped.length = 0; harness.connections.length = 0
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
  ctx.provide('webServer', { port: 5298 } as never)
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
  await ctx.plugin(ToolRuntime)
  harness.start.mockImplementation(async (_config, cwd, id) => {
    const dispose = vi.fn(async () => {})
    harness.stopped.push(dispose)
    return { workspace: { editorUrl: 'http://127.0.0.1:5300/', directory: `${cwd}/${id}` }, token: 'host-secret', dispose, drainForShutdown: async () => {}, assertRunning() {} }
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

it('freezes new opens and waits for every accepted connection before closing its editors', async () => {
  const { ctx, makeAgent } = await setup()
  const first = makeAgent('first'); const second = makeAgent('second')
  await ctx.manturEditing.open(first.agent, 'http://127.0.0.1:5298')
  await ctx.manturEditing.open(second.agent, 'http://127.0.0.1:5298')
  const done: PromiseWithResolvers<void> = Promise.withResolvers()
  harness.drain.mockReturnValueOnce(done.promise).mockResolvedValueOnce(undefined)
  const stopping = ctx.manturEditing.stopForShutdown()
  expect(ctx.manturEditing.stopForShutdown()).toBe(stopping)
  try {
    await expect(ctx.manturEditing.open(first.agent, 'http://127.0.0.1:5298')).rejects.toThrow('shutting down')
    await expect.poll(() => harness.drain.mock.calls.length).toBe(2)
    expect(harness.stopped.every(stop => stop.mock.calls.length === 0)).toBe(true)
    done.resolve()
    await stopping
    expect(harness.stopped.every(stop => stop.mock.calls.length === 1)).toBe(true)
  } finally { done.resolve(); await stopping }
})

it('includes an opening editor in shutdown and stops its newly mounted MCP connection', async () => {
  const { ctx, makeAgent } = await setup()
  const started: PromiseWithResolvers<void> = Promise.withResolvers()
  const resume: PromiseWithResolvers<void> = Promise.withResolvers()
  const start = harness.start.getMockImplementation()!
  harness.start.mockImplementation(async (...args) => {
    started.resolve()
    await resume.promise
    return start(...args)
  })
  const { agent } = makeAgent('opening')
  const open = ctx.manturEditing.open(agent, 'http://127.0.0.1:5298')
  const refused = expect(open).rejects.toThrow('shutting down')
  await started.promise
  const stopping = ctx.manturEditing.stopForShutdown()
  try {
    expect(harness.stopped).toHaveLength(0)
    resume.resolve(undefined)
    await refused
    await stopping
    expect(harness.drain).toHaveBeenCalledOnce()
    expect(harness.stopped[0]).toHaveBeenCalledOnce()
  } finally { resume.resolve(undefined); await refused; await stopping }
})

it('retains an editor cleanup failure and refuses future opens after repeated shutdown', async () => {
  const { ctx, makeAgent } = await setup()
  const { agent } = makeAgent('cleanup-failed')
  await ctx.manturEditing.open(agent, 'http://127.0.0.1:5298')
  harness.stopped[0]!.mockRejectedValue(new Error('child close is unconfirmed'))
  const stopping = ctx.manturEditing.stopForShutdown()
  await expect(stopping).rejects.toThrow('installation is blocked')
  expect(ctx.manturEditing.stopForShutdown()).toBe(stopping)
  await expect(ctx.manturEditing.open(agent, 'http://127.0.0.1:5298')).rejects.toThrow('shutting down')
  expect(harness.stopped[0]).toHaveBeenCalledOnce()
})

it('discovers the editing entry before opening and reuses its Agent owner through tools and Remote', async () => {
  const { ctx, makeAgent } = await setup()
  const a = makeAgent('tool-a'); const b = makeAgent('tool-b')
  expect(ctx.tools.schemas(a.agent).some(tool => tool.name === 'open_editing_workbench')).toBe(true)
  expect(harness.start).not.toHaveBeenCalled()
  const execute = (agent: Agent, id: string) => ctx.tools.execute({
    name: 'open_editing_workbench', arguments: {}, agent,
    callId: ToolCallId(id), signal: new AbortController().signal,
  })
  const first = await execute(a.agent, 'first')
  expect(first.isError).toBe(false)
  if (first.isError) throw new Error('Opening failed')
  expect(first.value).toEqual({
    sessionId: 'tool-a', editorUrl: 'http://127.0.0.1:5300/', directory: '/project-tool-a/tool-a',
  })
  expect(first.meta).toEqual({ kind: 'mantur-editing-workspace', ...first.value as object })
  expect(JSON.stringify(first)).not.toContain('host-secret')
  expect(first.content).toEqual([{ type: 'text', text: JSON.stringify(first.value) }])
  const reopened = await ctx.manturEditing.open(a.agent, 'http://127.0.0.1:5298')
  expect(reopened.directory).toBe('/project-tool-a/tool-a')
  expect((await execute(a.agent, 'repeat')).isError).toBe(false)
  expect(harness.start).toHaveBeenCalledOnce()
  expect((await execute(b.agent, 'other')).isError).toBe(false)
  expect(harness.start).toHaveBeenCalledTimes(2)
  expect(harness.scopes).toEqual([scopeOf(a.scope.ctx), scopeOf(b.scope.ctx)])
})

it('exposes startup errors through the tool result without reporting an opened workbench', async () => {
  const { ctx, makeAgent } = await setup()
  const { agent } = makeAgent('failure')
  harness.connect.mockRejectedValueOnce(new Error('native editor MCP unavailable'))
  const result = await ctx.tools.execute({
    name: 'open_editing_workbench', arguments: {}, agent,
    callId: ToolCallId('failed-open'), signal: new AbortController().signal,
  })
  expect(result.isError).toBe(true)
  expect(JSON.stringify(result.content)).toContain('native editor MCP unavailable')
  expect(result.meta).toBeUndefined()
  expect(await editingSections(ctx, agent)).toEqual([])
})

it('rejects an ownerless or already cancelled editing tool before starting a process', async () => {
  const { ctx, makeAgent } = await setup()
  const { agent } = makeAgent('cancelled')
  const ownerless = await ctx.tools.execute({
    name: 'open_editing_workbench', arguments: {},
    callId: ToolCallId('ownerless'), signal: new AbortController().signal,
  })
  expect(ownerless.isError).toBe(true)
  expect(JSON.stringify(ownerless.content)).toContain('owning Agent Session')
  const cancelled = await ctx.tools.execute({
    name: 'open_editing_workbench', arguments: {}, agent,
    callId: ToolCallId('cancelled'), signal: AbortSignal.abort(),
  })
  expect(cancelled.isError).toBe(true)
  expect(harness.start).not.toHaveBeenCalled()
})

it('retains the Session editor when the opening tool is cancelled during startup', async () => {
  const { ctx, makeAgent } = await setup()
  const { agent } = makeAgent('cancel-during-open')
  const started = Promise.withResolvers<undefined>(); const resume = Promise.withResolvers<undefined>()
  const start = harness.start.getMockImplementation()!
  harness.start.mockImplementation(async (...args) => {
    started.resolve(undefined); await resume.promise; return start(...args)
  })
  const abort = new AbortController()
  const pending = ctx.tools.execute({
    name: 'open_editing_workbench', arguments: {}, agent,
    callId: ToolCallId('cancel-startup'), signal: abort.signal,
  })
  try {
    await started.promise
    abort.abort(); resume.resolve(undefined)
    expect((await pending).isError).toBe(true)
    expect(harness.stopped[0]).not.toHaveBeenCalled()
    await ctx.manturEditing.open(agent, 'http://127.0.0.1:5298')
    expect(harness.start).toHaveBeenCalledOnce()
  } finally { resume.resolve(undefined); await pending }
})
