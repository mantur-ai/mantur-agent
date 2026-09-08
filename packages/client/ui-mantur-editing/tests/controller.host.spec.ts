import { Context } from '@deepseek-ai/cordis'
import { createScope, scopeOf } from '@deepseek-ai/dsh-scope'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ConnectionHandle } from '@deepseek-ai/dsh-mcp-client'
import type { startEditor } from '../src/runtime.ts'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { afterEach, expect, it, vi } from 'vitest'
import ManturEditing, { Config } from '../src/index.ts'

const harness = vi.hoisted(() => ({
  start: vi.fn<typeof startEditor>(), connect: vi.fn<() => void | Promise<void>>(), drain: vi.fn<() => void | Promise<void>>(),
  disconnect: vi.fn<() => void | Promise<void>>(),
  scopes: [] as unknown[],
  stopped: [] as ReturnType<typeof vi.fn>[], connections: [] as ConnectionHandle[],
}))
vi.mock('../src/runtime.ts', () => ({ startEditor: harness.start }))
vi.mock('@deepseek-ai/dsh-client-ui-mantur-editing/packaged-resources', () => ({ resolvePackagedResources: vi.fn() }))
vi.mock('@deepseek-ai/dsh-mcp-client', () => ({
  connectMcpServer(ctx: Context, _config: unknown, beforeClose: () => Promise<void>) {
    harness.scopes.push(scopeOf(ctx))
    let draining: Promise<void> | undefined
    let disposal: Promise<void> | undefined
    const handle: ConnectionHandle = {
      ready: Promise.resolve().then(() => harness.connect()).then(() => ({})),
      stopAccepting: () => draining ??= Promise.resolve().then(() => harness.drain()),
      dispose: () => disposal ??= (async () => { await handle.stopAccepting(); await harness.disconnect(); await beforeClose() })(),
    }
    ctx.effect(() => () => handle.dispose(), 'fixture MCP shutdown')
    harness.connections.push(handle)
    return handle
  },
}))
const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  harness.start.mockReset(); harness.connect.mockReset(); harness.drain.mockReset(); harness.disconnect.mockReset()
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
  ctx.provide('tools', {} as never)
  ctx.provide('webServer', { port: 5298 } as never)
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
  harness.start.mockImplementation(async (_config, cwd, id, _parentOrigin, acquired) => {
    const dispose = vi.fn(async () => {})
    harness.stopped.push(dispose)
    const runtime = { workspace: { editorUrl: 'http://127.0.0.1:5300/', directory: `${cwd}/${id}` }, token: 'host-secret', dispose, drainForShutdown: async () => {}, assertRunning() {} }
    acquired?.(runtime)
    return runtime
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
  await expect(ctx.manturEditing.open(agent, 'http://localhost')).rejects.toThrow('local Mantur origin')
  await expect(ctx.manturEditing.open(agent, 'http://localhost:5298/')).rejects.toThrow('local Mantur origin')
  expect(harness.start).not.toHaveBeenCalled()
})

it('accepts every loopback spelling and stops a runtime that exits before reuse', async () => {
  const { ctx, makeAgent } = await setup()
  const localhost = makeAgent('localhost')
  await expect(ctx.manturEditing.open(localhost.agent, 'http://localhost:5298')).resolves.toBeDefined()
  const ipv6 = makeAgent('ipv6')
  await expect(ctx.manturEditing.open(ipv6.agent, 'http://[::1]:5298')).resolves.toBeDefined()
  const failed = makeAgent('failed')
  const start = harness.start.getMockImplementation()!
  harness.start.mockImplementationOnce(async (...args) => {
    const runtime = await start(...args)
    runtime.assertRunning = () => { throw new Error('editor exited') }
    return runtime
  })
  await expect(ctx.manturEditing.open(failed.agent, 'http://127.0.0.1:5298')).rejects.toThrow('editor exited')
  expect(harness.stopped.at(-1)).toHaveBeenCalledOnce()
})

it('validates packaged configuration during construction', () => {
  const ctx = new Context()
  contexts.push(ctx)
  ctx.provide('typert', {} as never)
  expect(() => new ManturEditing(ctx, { ...config, runtimeMode: 'packaged' })).not.toThrow()
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
    resume.resolve()
    await refused
    await stopping
    expect(harness.drain).toHaveBeenCalledOnce()
    expect(harness.stopped[0]).toHaveBeenCalledOnce()
  } finally { resume.resolve(); await refused; await stopping }
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

it('does not stop the editor process when MCP disconnection is unconfirmed', async () => {
  const { ctx, makeAgent } = await setup()
  const { agent } = makeAgent('disconnect-failed')
  await ctx.manturEditing.open(agent, 'http://127.0.0.1:5298')
  harness.disconnect.mockRejectedValueOnce(new Error('MCP close is unconfirmed'))
  await expect(ctx.manturEditing.stopForShutdown()).rejects.toThrow('installation is blocked')
  expect(harness.stopped[0]).not.toHaveBeenCalled()
})
