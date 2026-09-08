/** Host update coordination keeps accepted RPC writes ahead of durable writer closure. */
import { EventEmitter, once } from 'node:events'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Include from '@deepseek-ai/cordis-plugin-include'
import Group from '@deepseek-ai/cordis-plugin-group'
import AgentPresets, { COMPOSITION_FILE } from '@deepseek-ai/dsh-agent-presets'
import { Context } from '@deepseek-ai/cordis'
import { WorkerThreadCodeRuntime } from '@deepseek-ai/dsh-code-runtime-worker-thread'
import DynamicRunner from '@deepseek-ai/dsh-cordis-host-runner'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Llm from '@deepseek-ai/dsh-llm'
import * as Telemetry from '@deepseek-ai/dsh-session-telemetry-otel'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import Agents from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Persistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import Registry from '@deepseek-ai/dsh-typert-registry'
import Gateway from '@deepseek-ai/dsh-api-gateway'
import { z } from 'zod'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { expect, it, vi } from 'vitest'
import * as ManturApp from '../src/index.ts'
import { createHostUpdateShutdown, installHostUpdateListener } from '../src/update-shutdown.ts'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'mantur-update-'))
  const ctx = new Context()
  ctx.baseUrl = new URL('../', import.meta.url).href
  await ctx.plugin(Loader)
  await ctx.plugin(Llm)
  await ctx.plugin(Sessions)
  await ctx.plugin(Projections)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(Tools)
  await ctx.plugin(Agents)
  await ctx.plugin(Persistence, { root, compression: 'none' })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(Registry)
  await ctx.plugin(Gateway)
  const handle = await ctx.agents.create({ sessionId: SessionId('held-write') })
  return {
    ctx, root, handle, agent: handle.agent,
    async close() { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) },
  }
}

it('joins the original RPC body before sealing its session and returns physical final offsets', async () => {
  const test = await fixture()
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  let request: Promise<unknown> | undefined
  let preparation: Promise<unknown> | undefined
  const { ctx, agent } = test
  class UpdateRpc extends TypertRemoteService {
    constructor(ctx: Context) { super(ctx, 'updateTestRpc', { namespace: 'update' }) }
    @Remote('write')
    async write() {
      entered.resolve(undefined)
      await release.promise
      agent.session.append('turn/start', { turn: 1 })
      agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      return true
    }
  }
  await ctx.plugin(UpdateRpc)
  ctx.effect(() => ctx.typert.register({
    package: '@fixture/update', face: 'host', schemas: [], model: { services: [], events: [], objects: [] },
    invocations: [{ id: '@fixture/update#write', service: 'updateTestRpc', namespace: 'update', method: 'write',
      invocation: { kind: 'direct' }, parameters: [], result: { mode: 'strict', typeSymbol: '@fixture/update#boolean', schema: z.boolean() } }],
  }))
  try {
    request = ctx.typertGateway.invoke({ namespace: 'update', method: 'write', args: {} }).catch((error: unknown) => { entered.reject(error); return error })
    await entered.promise
    const shutdown = createHostUpdateShutdown(ctx)
    let completed = false
    preparation = shutdown.prepare().then((result) => { completed = true; return result })
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(completed).toBe(false)
    expect(ctx.agents.get(agent.id)).toBe(agent)
    await expect(ctx.agents.create({ sessionId: SessionId('late') })).rejects.toThrow()
    release.resolve(undefined)
    await request
    expect(await preparation).toEqual([{ sessionId: agent.session.id, nextSeq: 2 }])
    const reader = await ctx.sessionPersistence.open(agent.session.id, 'read')
    try { expect((await reader.read()).map(event => event.type)).toEqual(['turn/start', 'turn/end']) } finally { await reader.close() }
    expect(await shutdown.prepare()).toEqual([{ sessionId: agent.session.id, nextSeq: 2 }])
  } finally { release.resolve(undefined); await Promise.allSettled([request, preparation]); await test.close() }
})

it('retains a producer failure and still drains other owners before denying every receipt', async () => {
  const test = await fixture()
  const released = Promise.withResolvers<undefined>()
  const stopped = vi.fn(async () => { await released.promise })
  test.ctx.provide('terminals', { stopForShutdown: stopped })
  test.ctx.provide('jobs', { stopForShutdown: async () => { throw new Error('job close failed') } })
  const shutdown = createHostUpdateShutdown(test.ctx)
  let completed = false
  const preparation = shutdown.prepare().catch((error: unknown) => { completed = true; return error })
  try {
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(stopped).toHaveBeenCalledOnce()
    expect(completed).toBe(false)
    released.resolve(undefined)
    expect(await preparation).toBeInstanceOf(AggregateError)
    await expect(shutdown.prepare()).rejects.toThrow('Host update shutdown failed')
  } finally { released.resolve(undefined); await preparation; await test.close() }
})

it('rejects unmanaged code execution before freezing agent admission', async () => {
  const test = await fixture()
  test.ctx.provide('codeRuntime', {})
  try {
    await expect(createHostUpdateShutdown(test.ctx).prepare()).rejects.toThrow('unmanaged operating-system descendants')
    const handle = await test.ctx.agents.create({ sessionId: SessionId('still-accepting') })
    await handle.dispose()
  } finally { await test.close() }
})

it('detects writes attempted after a successful receipt during a fresh verification', async () => {
  const test = await fixture()
  try {
    const shutdown = createHostUpdateShutdown(test.ctx)
    await shutdown.prepare()
    expect(() => test.agent.session.append('turn/start', { turn: 1 })).toThrow()
    await expect(shutdown.prepare()).rejects.toThrow('agent factory shutdown failed')
  } finally { await test.close() }
})

it('joins each isolated owner while excluding services from another Host', async () => {
  const test = await fixture()
  const foreign = await fixture()
  const first = vi.fn(async () => {})
  const second = vi.fn(async () => {})
  const other = vi.fn(async () => {})
  test.ctx.isolate('terminals').provide('terminals', { stopForShutdown: first })
  test.ctx.isolate('terminals').provide('terminals', { stopForShutdown: second })
  foreign.ctx.provide('terminals', { stopForShutdown: other })
  try {
    await createHostUpdateShutdown(test.ctx).prepare()
    expect(first).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledOnce()
    expect(other).not.toHaveBeenCalled()
  } finally { await Promise.all([test.close(), foreign.close()]) }
})

it('retains a removed owner so a failed earlier cleanup cannot disappear during reload', async () => {
  const test = await fixture()
  const stopped = vi.fn(async () => { throw new Error('retired owner failed') })
  const owner = test.ctx.plugin({ name: 'fixture-producer', apply(ctx: Context) { ctx.provide('terminals', { stopForShutdown: stopped }) } })
  await owner
  const shutdown = createHostUpdateShutdown(test.ctx)
  await owner.dispose()
  try {
    await expect(shutdown.prepare()).rejects.toThrow('Host update shutdown failed')
    expect(stopped).toHaveBeenCalledOnce()
  } finally { await test.close() }
})

it('rejects unknown installed modules before freezing, even after their entries are removed', async () => {
  const test = await fixture()
  test.ctx.loader.builtins.unmanaged = () => {}
  const shutdown = createHostUpdateShutdown(test.ctx)
  const entryId = await test.ctx.loader.create({ name: 'cordis:unmanaged' })
  try {
    await expect(shutdown.prepare()).rejects.toThrow('cordis:unmanaged')
    await test.ctx.loader.remove(entryId)
    await expect(shutdown.prepare()).rejects.toThrow('cordis:unmanaged')
    const handle = await test.ctx.agents.create({ sessionId: SessionId('not-frozen') })
    await handle.dispose()
  } finally { await test.close() }
})


function parentChannel() {
  const sent: unknown[] = []
  const prepared = Promise.withResolvers<unknown>()
  const exited = Promise.withResolvers<undefined>()
  const channel = Object.assign(new EventEmitter(), {
    connected: true, exitCode: undefined as string | number | undefined,
    send(value: unknown, callback?: (error: Error | null) => void) {
      sent.push(value)
      if ((value as { type: string }).type === 'mantur:update:prepared') prepared.resolve(value)
      callback?.(null)
      return true
    },
    disconnect() { channel.connected = false; exited.resolve(undefined) },
  })
  // The fake owns only this listener's Process subset; EventEmitter returns itself from on/off.
  const parent = channel as unknown as Parameters<typeof installHostUpdateListener>[1]
  return { channel, parent, sent, prepared: prepared.promise, exited: exited.promise }
}

it('requires an inherited IPC channel and returns the listener disposer', async () => {
  const test = await fixture()
  try {
    expect(() => installHostUpdateListener(test.ctx, {} as Parameters<typeof installHostUpdateListener>[1])).toThrow('parent IPC')
    const fake = parentChannel()
    fake.channel.connected = false
    expect(() => installHostUpdateListener(test.ctx, fake.parent)).toThrow('parent IPC')
    fake.channel.connected = true
    const dispose = installHostUpdateListener(test.ctx, fake.parent)
    expect(fake.sent).toEqual([{ type: 'mantur:update:ready' }])
    fake.channel.emit('message', { type: 'other' })
    fake.channel.emit('message', { type: 'mantur:update:exit' })
    expect(fake.channel.connected).toBe(true)
    dispose()
    expect(fake.channel.listenerCount('message')).toBe(0)
  } finally { await test.close() }
})

it.each([false, true])('verifies again after application disposal (late write: %s)', async (lateWrite) => {
  const test = await fixture()
  const fake = parentChannel()
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  test.ctx.effect(() => installHostUpdateListener(test.ctx, fake.parent))
  if (lateWrite) test.ctx.effect(() => () => {
    expect(() => test.agent.session.append('turn/start', { turn: 1 })).toThrow()
  })
  try {
    const id = 'f5691974-98bc-4d3c-bcf8-d5cf78efddbb'
    fake.channel.emit('message', { type: 'mantur:update:prepare', id })
    expect(await fake.prepared).toMatchObject({ id, ok: true })
    fake.channel.emit('message', { type: 'mantur:update:exit' })
    fake.channel.emit('message', { type: 'mantur:update:exit' })
    await fake.exited
    expect(fake.channel.exitCode).toBe(lateWrite ? 1 : 0)
    expect(fake.channel.listenerCount('message')).toBe(0)
  } finally { log.mockRestore(); await test.close() }
})

it('reports the retained primary failure through the request-bound IPC reply', async () => {
  const test = await fixture()
  const fake = parentChannel()
  test.ctx.provide('jobs', { stopForShutdown() { throw new Error('original owner failure') } })
  const dispose = installHostUpdateListener(test.ctx, fake.parent)
  try {
    fake.channel.emit('message', { type: 'mantur:update:prepare', id: 'f5691974-98bc-4d3c-bcf8-d5cf78efddbb' })
    expect(await fake.prepared).toMatchObject({ ok: false, error: expect.stringContaining('original owner failure') as unknown })
    fake.channel.emit('message', { type: 'mantur:update:exit' })
    expect(fake.channel.connected).toBe(true)
  } finally { dispose(); await test.close() }
})

it.each(['native', 'browse', 'future'])('handles the %s picker capability before writer closure', async (kind) => {
  const test = await fixture()
  const pickerStop = vi.fn(async () => {})
  const accountStop = vi.fn(async () => {})
  test.ctx.provide('directoryPicker', { capability: () => ({ kind, stopForShutdown: pickerStop }) })
  test.ctx.provide('manturAccount', { stopNativeForShutdown: accountStop })
  try {
    const stopping = createHostUpdateShutdown(test.ctx).prepare()
    if (kind === 'future') {
      await expect(stopping).rejects.toThrow('directoryPicker: future')
      expect(accountStop).not.toHaveBeenCalled()
    } else {
      await stopping
      expect(accountStop).toHaveBeenCalledOnce()
      expect(pickerStop).toHaveBeenCalledTimes(kind === 'native' ? 1 : 0)
    }
  } finally { await test.close() }
})

it.each([{ root: [] }, { root: ['.'] }])('accepts watch-only HMR but refuses module roots %j', async ({ root }) => {
  const test = await fixture()
  test.ctx.provide('hmr', { config: { root } })
  try {
    const stopping = createHostUpdateShutdown(test.ctx).prepare()
    if (root.length) await expect(stopping).rejects.toThrow('module HMR')
    else await stopping
  } finally { await test.close() }
})

it('requires the agent owners even when no session has been published', async () => {
  const ctx = new Context()
  await ctx.plugin(Loader)
  try {
    await expect(createHostUpdateShutdown(ctx).prepare()).rejects.toThrow('AgentLoop and AgentRegistry')
  } finally { await ctx.fiber.dispose() }
})

it('drains owners created by an already-accepted producer before sealing writers', async () => {
  const test = await fixture()
  const stopped = vi.fn(async () => {})
  test.ctx.provide('jobs', { async stopForShutdown() {
    test.ctx.provide('terminals', { stopForShutdown: stopped })
  } })
  try {
    await createHostUpdateShutdown(test.ctx).prepare()
    expect(stopped).toHaveBeenCalledOnce()
  } finally { await test.close() }
})

it('denies a newly observed unmanaged owner without forgetting earlier admitted cleanup', async () => {
  const test = await fixture()
  test.ctx.provide('agentPresets', { async stopForShutdown() { test.ctx.provide('codeRuntime', {}) } })
  try {
    await expect(createHostUpdateShutdown(test.ctx).prepare()).rejects.toThrow('Host update shutdown failed')
    expect(test.ctx.agents.list()).toHaveLength(0)
  } finally { await test.close() }
})

it('retains synchronous driver failure and final seal failure', async () => {
  const test = await fixture()
  const stop = vi.spyOn(test.ctx.agentLoop, 'quiesceForShutdown').mockImplementation(() => { throw new Error('driver failed') })
  test.ctx.provide('storageDomain', { async stopForShutdown() {
    expect(() => test.agent.session.append('turn/start', { turn: 1 })).toThrow()
  } })
  try { await expect(createHostUpdateShutdown(test.ctx).prepare()).rejects.toThrow('Host update shutdown failed') }
  finally { stop.mockRestore(); await test.close() }
})

it('does not send a late receipt across a disconnected parent channel', async () => {
  const test = await fixture()
  const fake = parentChannel()
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  test.ctx.provide('jobs', { async stopForShutdown() { entered.resolve(undefined); await release.promise } })
  const dispose = installHostUpdateListener(test.ctx, fake.parent)
  try {
    fake.channel.emit('message', { type: 'mantur:update:prepare', id: 'f5691974-98bc-4d3c-bcf8-d5cf78efddbb' })
    await entered.promise
    fake.channel.connected = false
    release.resolve(undefined)
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(fake.sent).toEqual([{ type: 'mantur:update:ready' }])
  } finally { release.resolve(undefined); dispose(); await test.close() }
})


it('includes retained preset trees and skips disabled and group entries', async () => {
  const test = await fixture()
  const { ctx, root } = test
  ctx.baseUrl = new URL('../', import.meta.url).href
  ctx.loader.builtins.include = Include
  ctx.loader.builtins.group = Group
  const presetRoot = join(root, 'presets')
  await mkdir(join(presetRoot, 'managed'), { recursive: true })
  await writeFile(join(presetRoot, 'managed', COMPOSITION_FILE), '[]\n')
  await ctx.plugin(AgentPresets, { default: 'managed', roots: [{ path: presetRoot, trust: 'user' }],
    includeShippedRoot: false, includeUserRoot: false })
  const handle = await ctx.agents.create({ sessionId: SessionId('preset-update'), setup: async (agentCtx) => {
    await ctx.agentPresets.mount(agentCtx, 'managed')
  } })
  try {
    const importing = vi.spyOn(ctx.loader, 'import').mockResolvedValue(ManturApp)
    try { await ctx.loader.create({ name: '@deepseek-ai/dsh-mantur-app', config: { persona: 'Fixture identity.' } }) }
    finally { importing.mockRestore() }
    await ctx.loader.create({ name: 'uninstalled-module', disabled: true })
    await ctx.loader.create({ name: 'cordis:group', group: true, config: [] })
    await createHostUpdateShutdown(ctx).prepare()
    expect(ctx.agents.get(handle.agent.id)).toBeUndefined()
  } finally { await test.close() }
})

it('reports an asynchronous driver rejection instead of authorizing writer completion', async () => {
  const test = await fixture()
  test.agent.session.append('turn/start', { turn: 1 })
  try { await expect(createHostUpdateShutdown(test.ctx).prepare()).rejects.toThrow('Host update shutdown failed') }
  finally { await test.close() }
})

it('returns the latest offset once when a session has multiple closed writer lifetimes', async () => {
  const test = await fixture()
  try {
    test.agent.session.append('turn/start', { turn: 1 })
    test.agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await test.handle.dispose()
    const second = await test.ctx.agentLoop.resume(test.ctx, { resumeSessionId: test.agent.session.id })
    await second.dispose()
    await test.ctx.agentLoop.resume(test.ctx, { resumeSessionId: test.agent.session.id })
    expect(await createHostUpdateShutdown(test.ctx).prepare()).toEqual([{ sessionId: test.agent.session.id, nextSeq: 3 }])
  } finally { await test.close() }
})

it.each(['jobs', 'storageDomain'])('rejects a new unmanaged owner observed during %s cleanup', async (owner) => {
  const test = await fixture()
  test.ctx.provide(owner, { async stopForShutdown() { test.ctx.provide('codeRuntime', {}) } })
  try { await expect(createHostUpdateShutdown(test.ctx).prepare()).rejects.toThrow('Host update shutdown failed') }
  finally { await test.close() }
})

it('saves authoritative events before a failing telemetry upload and retains ordinary disposal', async () => {
  const test = await fixture()
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = test.root
  let uploads = 0
  const server = createServer((request, response) => {
    request.resume()
    request.on('end', () => { uploads++; response.writeHead(503).end() })
  })
  const importModule = vi.spyOn(test.ctx.loader, 'import').mockResolvedValue(Telemetry)
  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('collector did not bind')
    await test.ctx.loader.create({ name: '@deepseek-ai/dsh-session-telemetry-otel', config: {
      mode: 'FULL', shutdownTimeoutMillis: 1000,
      exporter: { url: `http://127.0.0.1:${address.port}/v1/logs`, timeoutMillis: 50 },
      processor: { scheduledDelayMillis: 60_000, maxQueueSize: 128, maxExportBatchSize: 128, exportTimeoutMillis: 500 },
    } })
    importModule.mockRestore()
    test.agent.session.append('turn/start', { turn: 1 })
    test.agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const shutdown = createHostUpdateShutdown(test.ctx)
    expect(await shutdown.prepare()).toEqual([{ sessionId: 'held-write', nextSeq: 2 }])
    expect(uploads).toBe(0)
    await test.ctx.fiber.dispose()
    expect(uploads).toBeGreaterThan(0)
    expect(await shutdown.prepare()).toEqual([{ sessionId: 'held-write', nextSeq: 2 }])
    const disk = new Context()
    await disk.plugin(Persistence, { root: test.root, compression: 'none' })
    try {
      const reader = await disk.sessionPersistence.open(SessionId('held-write'), 'read')
      try { expect((await reader.read()).map(event => event.type)).toEqual(['turn/start', 'turn/end']) }
      finally { await reader.close() }
    } finally { await disk.fiber.dispose() }
  } finally {
    importModule.mockRestore()
    await test.close()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    const closed = new Promise<void>((resolve, reject) => { server.close((error) => { if (error) reject(error); else resolve() }) })
    server.closeAllConnections()
    await closed
  }
})

it.each(['dynamicCordisRunner'])('freezes a never-started %s and rechecks its history after every receipt', async (name) => {
  const test = await fixture()
  const owner = { hasStartedPrograms: false, stopForShutdown: vi.fn(async () => {}) }
  test.ctx.provide(name, owner)
  try {
    const shutdown = createHostUpdateShutdown(test.ctx)
    await shutdown.prepare()
    expect(owner.stopForShutdown).toHaveBeenCalledOnce()
    owner.hasStartedPrograms = true
    await expect(shutdown.prepare()).rejects.toThrow('unmanaged operating-system descendants')
    await test.ctx.fiber.dispose()
    await expect(shutdown.prepare()).rejects.toThrow('unmanaged operating-system descendants')
  } finally { await test.close() }
})

it.each(['dynamicCordisRunner'])('rejects %s execution admitted during shutdown before issuing a receipt', async (name) => {
  const test = await fixture()
  const owner = { hasStartedPrograms: false, async stopForShutdown() { this.hasStartedPrograms = true } }
  test.ctx.provide(name, owner)
  try { await expect(createHostUpdateShutdown(test.ctx).prepare()).rejects.toThrow('Host update shutdown failed') }
  finally { await test.close() }
})

it('keeps the unused worker provider blocked without freezing normal agent admission', async () => {
  const test = await fixture()
  await test.ctx.plugin(WorkerThreadCodeRuntime, {})
  try {
    expect((test.ctx.codeRuntime as WorkerThreadCodeRuntime).hasStartedPrograms).toBe(false)
    await expect(createHostUpdateShutdown(test.ctx).prepare()).rejects.toThrow('codeRuntime')
    const handle = await test.ctx.agents.create({ sessionId: SessionId('unused-does-not-freeze') })
    await handle.dispose()
  } finally { await test.close() }
})

it.each(['worker', 'dynamic'])('rejects %s history even if its provider was removed before coordinator creation', async (kind) => {
  const test = await fixture()
  try {
    if (kind === 'worker') {
      const fiber = test.ctx.plugin(WorkerThreadCodeRuntime, {})
      await fiber
      await test.ctx.codeRuntime.run({ program: 'return 1', bindings: [] })
      await fiber.dispose()
    } else {
      const fiber = test.ctx.plugin(DynamicRunner, {})
      await fiber
      const runner = test.ctx.dynamicCordisRunner
      const definition = runner.define({ sessionId: test.agent.id, plugin: { kind: 'new', idPrefix: 'old' }, name: 'old', purpose: 'history', code: { host: 'return { apply() {} }' } })
      expect(await runner.run(test.agent, definition.pluginId, definition.packageId, 'run')).toMatchObject({ ok: true })
      await runner.undefine(test.agent, definition.pluginId)
      await fiber.dispose()
    }
    await expect(createHostUpdateShutdown(test.ctx).prepare()).rejects.toThrow('previously executed programs')
    const handle = await test.ctx.agents.create({ sessionId: SessionId('history-does-not-freeze') })
    await handle.dispose()
  } finally { await test.close() }
})

it('keeps the shipped dynamic runner module blocked even when no activation occurred', async () => {
  const test = await fixture()
  const internal = test.ctx.loader.internal as { import(name: string, parent: string, attributes: object): Promise<unknown> } | undefined
  if (!internal) throw new Error('loader internals are unavailable')
  const importModule = vi.spyOn(internal, 'import').mockResolvedValue(DynamicRunner)
  try {
    await test.ctx.loader.create({ name: '@deepseek-ai/dsh-cordis-host-runner' })
    expect(test.ctx.dynamicCordisRunner.hasStartedPrograms).toBe(false)
    await expect(createHostUpdateShutdown(test.ctx).prepare()).rejects.toThrow('@deepseek-ai/dsh-cordis-host-runner')
  } finally {
    importModule.mockRestore()
    await test.close()
  }
})

it('freezes an unused real dynamic runner in an explicitly managed test composition', async () => {
  const test = await fixture()
  await test.ctx.plugin(DynamicRunner, {})
  const runner = test.ctx.dynamicCordisRunner
  try {
    await createHostUpdateShutdown(test.ctx).prepare()
    expect(() => runner.define({ sessionId: test.agent.id, plugin: { kind: 'new', idPrefix: 'new' }, name: 'late', purpose: 'late', code: { host: 'return { apply() {} }' } })).toThrow('stopping for shutdown')
  } finally { await test.close() }
})

it('keeps callbacks, agent admission and writers alive until the editing drain completes', async () => {
  const test = await fixture()
  const { ctx, agent } = test
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const order: string[] = []
  const server = createServer((_request, response) => { response.end('callback accepted') })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('fixture needs a TCP listener')
  const closeServer = async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => { if (error) reject(error); else resolve() })
    })
  }
  const network = vi.fn(async () => { order.push('network'); await closeServer() })
  ctx.provide('webServer', { stopForShutdown: network })
  const quiesce = vi.spyOn(ctx.agentLoop, 'quiesceForShutdown')
  const gateway = vi.spyOn(ctx.typertGateway, 'stopForShutdown')
  const producers = vi.fn(async () => { order.push('producer') })
  for (const name of ['terminals', 'workflowEngine', 'subprocess']) ctx.provide(name, { stopForShutdown: producers })
  class EditingCallback extends TypertRemoteService {
    constructor(ctx: Context) { super(ctx, 'editingCallback', { namespace: 'editingCallback' }) }
    @Remote('save')
    async save() {
      agent.session.append('turn/start', { turn: 1 })
      agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      return true
    }
  }
  await ctx.plugin(EditingCallback)
  ctx.effect(() => ctx.typert.register({
    package: '@fixture/editing', face: 'host', schemas: [], model: { services: [], events: [], objects: [] },
    invocations: [{ id: '@fixture/editing#save', service: 'editingCallback', namespace: 'editingCallback', method: 'save',
      invocation: { kind: 'direct' }, parameters: [], result: { mode: 'strict', typeSymbol: '@fixture/editing#boolean', schema: z.boolean() } }],
  }))
  const editing = vi.fn(async () => {
    entered.resolve(undefined)
    await release.promise
    expect(await (await fetch(`http://127.0.0.1:${address.port}`)).text()).toBe('callback accepted')
    expect(await ctx.typertGateway.invoke({ namespace: 'editingCallback', method: 'save', args: {} })).toBe(true)
    order.push('editing')
  })
  ctx.provide('manturEditing', { stopForShutdown: editing })
  const shutdown = createHostUpdateShutdown(ctx)
  const preparing = shutdown.prepare()
  try {
    await entered.promise
    expect(quiesce).not.toHaveBeenCalled()
    expect(gateway).not.toHaveBeenCalled()
    expect(network).not.toHaveBeenCalled()
    expect(producers).not.toHaveBeenCalled()
    expect(ctx.agents.acceptingWork).toBe(true)
    expect(ctx.agents.get(agent.id)).toBe(agent)
    release.resolve(undefined)
    expect(await preparing).toEqual([{ sessionId: agent.id, nextSeq: 2 }])
    expect(order[0]).toBe('editing')
    expect(quiesce).toHaveBeenCalledOnce()
    expect(network).toHaveBeenCalledOnce()
    expect(producers).toHaveBeenCalledTimes(3)
    await shutdown.prepare()
    expect(editing).toHaveBeenCalledOnce()
    const reader = await ctx.sessionPersistence.open(agent.id, 'read')
    try { expect((await reader.read()).map(event => event.type)).toEqual(['turn/start', 'turn/end']) } finally { await reader.close() }
  } finally {
    release.resolve(undefined)
    await Promise.allSettled([preparing])
    quiesce.mockRestore()
    gateway.mockRestore()
    if (server.listening) await closeServer()
    await test.close()
  }
})

it.each(['write failed', 'execution cancelled', 'remote completion unknown'])('preserves Host services and writers when editing reports %s', async (reason) => {
  const test = await fixture()
  const quiesce = vi.spyOn(test.ctx.agentLoop, 'quiesceForShutdown')
  const gateway = vi.spyOn(test.ctx.typertGateway, 'stopForShutdown')
  const editing = vi.fn(async () => { throw new Error(reason) })
  test.ctx.provide('manturEditing', { stopForShutdown: editing })
  const shutdown = createHostUpdateShutdown(test.ctx)
  try {
    await expect(shutdown.prepare()).rejects.toMatchObject({ errors: [expect.objectContaining({ message: reason })] })
    await expect(shutdown.prepare()).rejects.toThrow('Host editing shutdown failed')
    expect(editing).toHaveBeenCalledOnce()
    expect(quiesce).not.toHaveBeenCalled()
    expect(gateway).not.toHaveBeenCalled()
    test.agent.session.append('turn/start', { turn: 1 })
    test.agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(test.ctx.agents.acceptingWork).toBe(true)
  } finally { quiesce.mockRestore(); gateway.mockRestore(); await test.close() }
})

it('drains an editing owner added while an earlier retained owner is completing', async () => {
  const test = await fixture()
  const next = vi.fn(async () => {})
  const first = vi.fn(async () => { test.ctx.isolate('manturEditing').provide('manturEditing', { stopForShutdown: next }) })
  const fiber = test.ctx.plugin({ name: 'retired-editing', apply(ctx: Context) { ctx.provide('manturEditing', { stopForShutdown: first }) } })
  await fiber
  const shutdown = createHostUpdateShutdown(test.ctx)
  await fiber.dispose()
  try {
    await shutdown.prepare()
    expect(first).toHaveBeenCalledOnce()
    expect(next).toHaveBeenCalledOnce()
  } finally { await test.close() }
})

it.each(['jobs', 'settings'])('refuses an editing owner appearing during %s stop before sealing writers', async (name) => {
  const test = await fixture()
  test.ctx.provide(name, { async stopForShutdown() { test.ctx.provide('manturEditing', { async stopForShutdown() {} }) } })
  try {
    await expect(createHostUpdateShutdown(test.ctx).prepare()).rejects.toThrow('editing owner appeared')
    test.agent.session.append('turn/start', { turn: 1 })
  } finally { await test.close() }
})
