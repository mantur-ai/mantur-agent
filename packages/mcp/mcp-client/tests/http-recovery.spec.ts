/** Native HTTP recovery never replays a failed tool request. */
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { afterEach, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import * as McpClient from '../src/index.ts'
import { startConnection, resolveReconnectPolicy } from '../src/connection.ts'
import { startExpiryFixture } from './http-expiry-fixture.ts'

const contexts: Context[] = []
const fixtures: Awaited<ReturnType<typeof startExpiryFixture>>[] = []
afterEach(async () => {
  try { await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())) }
  finally {
    await Promise.all(fixtures.splice(0).map(fixture => fixture.close()))
    vi.restoreAllMocks()
    vi.useRealTimers()
  }
})
async function setup(
  reconnect: McpClient.Config['reconnect'] = { initialDelayMs: 5, maxDelayMs: 20, maxAttempts: 2 },
) {
  const fixture = await startExpiryFixture()
  fixtures.push(fixture)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const fiber = ctx.plugin(McpClient, {
    transport: 'streamable-http', serverName: 'mantur_cut', url: fixture.url,
    headers: {}, toolCallTimeoutMs: 1000, failOnStartupError: true, reconnect,
  })
  await fiber.await()
  return { fixture, ctx, fiber }
}
function call(ctx: Context, id: string) {
  return ctx.tools.execute({ name: 'mcp__mantur_cut__mutate', arguments: {}, callId: ToolCallId(id), signal: new AbortController().signal })
}

it('reinitializes an expired HTTP session and requires an explicit new tool call', async () => {
  const { fixture, ctx } = await setup()
  const first = fixture.initialized[0]!.id
  fixture.failures.set(first, 404)
  const failed = await call(ctx, 'expired')
  expect(failed.isError).toBe(true)
  await expect.poll(() => fixture.initialized.length).toBe(2)
  await expect.poll(() => ctx.tools.get('mcp__mantur_cut__mutate')).toBeDefined()
  expect(fixture.initialized.map(entry => entry.requestId)).toEqual([undefined, undefined])
  expect(fixture.calls).toEqual([first])
  const next = await call(ctx, 'explicit-after-reconnect')
  expect(next.isError).toBe(false)
  expect(fixture.calls).toEqual([first, fixture.initialized[1]!.id])
})

it.each([401, 403, 'rpc', 'tool'] as const)('does not replace the connection for %s errors', async (failure) => {
  const { fixture, ctx } = await setup()
  const first = fixture.initialized[0]!.id
  fixture.failures.set(first, failure)
  expect((await call(ctx, 'ordinary-error')).isError).toBe(true)
  fixture.failures.delete(first)
  expect((await call(ctx, 'same-connection')).isError).toBe(false)
  expect(fixture.initializeRequests).toEqual([undefined])
  expect(fixture.calls).toEqual([first, first])
})

it('reports an initial endpoint 404 as startup failure without an established session', async () => {
  const fixture = await startExpiryFixture()
  fixtures.push(fixture)
  fixture.failInitialize(404)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const handle = startConnection(ctx, {
    transport: 'streamable-http', serverName: 'mantur_cut', url: fixture.url,
    headers: {}, toolCallTimeoutMs: 1000, failOnStartupError: true,
  }, resolveReconnectPolicy({ enabled: false }, 'reconnect'))
  try {
    expect((await handle.ready).error).toMatchObject({ code: 404 })
    expect(fixture.initializeRequests).toEqual([undefined])
    expect(fixture.initialized).toEqual([])
  } finally { await handle.dispose() }
})

it('withdraws expired HTTP tools when reconnect is disabled', async () => {
  const { fixture, ctx } = await setup({ enabled: false })
  fixture.failures.set(fixture.initialized[0]!.id, 404)
  expect((await call(ctx, 'no-reconnect')).isError).toBe(true)
  await expect.poll(() => ctx.tools.get('mcp__mantur_cut__mutate')).toBeUndefined()
  expect(fixture.initializeRequests).toEqual([undefined])
})

it('coalesces simultaneous session failures without replaying either request', async () => {
  const { fixture, ctx } = await setup()
  const release: PromiseWithResolvers<void> = Promise.withResolvers()
  fixture.holdCalls(release.promise)
  const first = fixture.initialized[0]!.id
  fixture.failures.set(first, 404)
  const calls = [call(ctx, 'concurrent-1'), call(ctx, 'concurrent-2')]
  try {
    await expect.poll(() => fixture.calls.length).toBe(2)
  } finally { release.resolve() }
  expect((await Promise.all(calls)).every(result => result.isError)).toBe(true)
  await expect.poll(() => fixture.initialized.length).toBe(2)
  expect(fixture.calls).toEqual([first, first])
})

it.each([false, true])('waits for local close completion and rejects held executors and late generation signals (close rejects: %s)', async (rejectClose) => {
  const clients: Client[] = []
  // eslint-disable-next-line @typescript-eslint/unbound-method -- The spy invokes the original with its actual Client receiver.
  const connect = Client.prototype.connect
  vi.spyOn(Client.prototype, 'connect').mockImplementation(function (this: Client, ...args) {
    clients.push(this)
    return connect.apply(this, args)
  })
  const { fixture, ctx } = await setup()
  const old = ctx.tools.get('mcp__mantur_cut__mutate')!
  ctx.tools.register({ ...old, name: 'held-executor' })
  const closed: PromiseWithResolvers<void> = Promise.withResolvers()
  const close = clients[0]!.close.bind(clients[0])
  vi.spyOn(clients[0]!, 'close').mockImplementation(async () => {
    await close()
    await closed.promise
    if (rejectClose) throw new Error('Transport already closed')
  })
  fixture.failures.set(fixture.initialized[0]!.id, 404)
  try {
    expect((await call(ctx, 'close-barrier')).isError).toBe(true)
    await expect.poll(() => ctx.tools.get('mcp__mantur_cut__mutate')).toBeUndefined()
    expect(fixture.initialized).toHaveLength(1)
    const stale = await ctx.tools.execute({ name: 'held-executor', arguments: {}, callId: ToolCallId('held'), signal: new AbortController().signal })
    expect(stale.isError).toBe(true)
    expect(fixture.calls).toHaveLength(1)
  } finally { closed.resolve() }
  await expect.poll(() => fixture.initialized.length).toBe(2)
  await expect.poll(() => ctx.tools.get('mcp__mantur_cut__mutate')).toBeDefined()
  clients[0]!.onerror?.(new StreamableHTTPError(404, 'late old failure'))
  clients[0]!.onclose?.()
  expect((await call(ctx, 'fresh-after-late-signals')).isError).toBe(false)
  expect(ctx.tools.get('mcp__mantur_cut__mutate')).toBeDefined()
  expect(fixture.initialized).toHaveLength(2)
})

it('disposal during backoff cancels further initialization', async () => {
  const { fixture, ctx, fiber } = await setup({ initialDelayMs: 10000, maxDelayMs: 10000, maxAttempts: 2 })
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  fixture.failures.set(fixture.initialized[0]!.id, 404)
  expect((await call(ctx, 'dispose-backoff')).isError).toBe(true)
  await fiber.dispose()
  await vi.advanceTimersByTimeAsync(20000)
  expect(fixture.initializeRequests).toEqual([undefined])
  expect(ctx.tools.get('mcp__mantur_cut__mutate')).toBeUndefined()
})

it('stops at the existing reconnect attempt budget after session expiry', async () => {
  const { fixture, ctx } = await setup()
  fixture.failures.set(fixture.initialized[0]!.id, 404)
  fixture.failInitialize(503)
  expect((await call(ctx, 'outage-budget')).isError).toBe(true)
  await expect.poll(() => fixture.initializeRequests.length).toBe(3)
  expect(fixture.initialized).toHaveLength(1)
  expect(fixture.calls).toHaveLength(1)
  expect(ctx.tools.get('mcp__mantur_cut__mutate')).toBeUndefined()
})

it('keeps another Agent and another server name connected when only A expires', async () => {
  const fixture = await startExpiryFixture()
  fixtures.push(fixture)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  const a = await ctx.agentLoop.create(SessionId('http-agent-a'), { provider: 'unused', model: 'unused' })
  const b = await ctx.agentLoop.create(SessionId('http-agent-b'), { provider: 'unused', model: 'unused' })
  const config: McpClient.Config = {
    transport: 'streamable-http', serverName: 'mantur_cut', url: fixture.url,
    headers: {}, toolCallTimeoutMs: 1000, failOnStartupError: true,
    reconnect: { initialDelayMs: 5, maxDelayMs: 20, maxAttempts: 2 },
  }
  await a.ctx.plugin(McpClient, config).await()
  await b.ctx.plugin(McpClient, config).await()
  await a.ctx.plugin(McpClient, { ...config, serverName: 'other_cut' }).await()
  const bTool = ctx.tools.get('mcp__mantur_cut__mutate', b)
  const otherTool = ctx.tools.get('mcp__other_cut__mutate', a)
  const aSession = fixture.initialized[0]!.id
  fixture.failures.set(aSession, 404)
  const invoke = (agent: typeof a, serverName: string, id: string) => ctx.tools.execute({
    agent, name: `mcp__${serverName}__mutate`, arguments: {}, callId: ToolCallId(id), signal: new AbortController().signal,
  })
  expect((await invoke(a, 'mantur_cut', 'a-failed')).isError).toBe(true)
  expect((await invoke(b, 'mantur_cut', 'b-unchanged')).isError).toBe(false)
  expect((await invoke(a, 'other_cut', 'other-unchanged')).isError).toBe(false)
  await expect.poll(() => fixture.initialized.length).toBe(4)
  expect(ctx.tools.get('mcp__mantur_cut__mutate', b)).toBe(bTool)
  expect(ctx.tools.get('mcp__other_cut__mutate', a)).toBe(otherTool)
  expect(ctx.tools.get('mcp__mantur_cut__mutate')).toBeUndefined()
  expect(fixture.calls).toEqual([aSession, fixture.initialized[1]!.id, fixture.initialized[2]!.id])
})

it('does not replace an expired generation whose local close never finishes', async () => {
  const { fixture, ctx } = await setup()
  // eslint-disable-next-line @typescript-eslint/unbound-method -- The spy invokes the original with its actual Client receiver.
  const close = Client.prototype.close
  vi.spyOn(Client.prototype, 'close').mockImplementation(async function (this: Client) {
    await close.call(this)
    await new Promise(() => {})
  })
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  fixture.failures.set(fixture.initialized[0]!.id, 404)
  expect((await call(ctx, 'close-never-finishes')).isError).toBe(true)
  await vi.advanceTimersByTimeAsync(20000)
  expect(fixture.initializeRequests).toEqual([undefined])
  expect(ctx.tools.get('mcp__mantur_cut__mutate')).toBeUndefined()
})

it('disposal during expired-generation close never starts a replacement', async () => {
  const { fixture, ctx, fiber } = await setup()
  const gate: PromiseWithResolvers<void> = Promise.withResolvers()
  // eslint-disable-next-line @typescript-eslint/unbound-method -- The spy invokes the original with its actual Client receiver.
  const close = Client.prototype.close
  vi.spyOn(Client.prototype, 'close').mockImplementation(async function (this: Client) {
    await close.call(this)
    await gate.promise
  })
  fixture.failures.set(fixture.initialized[0]!.id, 404)
  try {
    expect((await call(ctx, 'dispose-closing')).isError).toBe(true)
    const disposing = fiber.dispose()
    gate.resolve()
    await disposing
    expect(fixture.initializeRequests).toEqual([undefined])
  } finally { gate.resolve() }
})
