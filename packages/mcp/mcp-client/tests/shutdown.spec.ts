/** Graceful MCP shutdown preserves accepted work and reports unconfirmed closure. */
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type LlmRuntime from '@deepseek-ai/dsh-llm'
import { afterEach, expect, it, vi } from 'vitest'
import { connectMcpServer, type Config, type ConnectionHandle } from '../src/index.ts'
import { startExpiryFixture } from './http-expiry-fixture.ts'

const contexts: Context[] = []
const fixtures: Awaited<ReturnType<typeof startExpiryFixture>>[] = []
afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(fixtures.splice(0).map(fixture => fixture.close()))
})

async function setup(beforeClose?: () => Promise<void>) {
  const fixture = await startExpiryFixture()
  fixtures.push(fixture)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  let connection!: ConnectionHandle
  const config: Config = {
    transport: 'streamable-http', serverName: 'mantur_cut', url: fixture.url,
    headers: {}, toolCallTimeoutMs: 1000, failOnStartupError: true,
    reconnect: { enabled: false },
  }
  const fiber = ctx.plugin({
    name: 'owned-mcp-shutdown',
    inject: ['tools'],
    async apply(scope: Context) {
      connection = connectMcpServer(scope, config, beforeClose)
      await connection.ready
    },
  })
  await fiber.await()
  const call = (id: string, signal = new AbortController().signal) => ctx.tools.execute({
    name: 'mcp__mantur_cut__mutate', arguments: {}, callId: ToolCallId(id), signal,
  })
  return { fixture, connection, ctx, call, fiber, config }
}

it('freezes new calls while an accepted response and the remote owner drain finish', async () => {
  const reply: PromiseWithResolvers<void> = Promise.withResolvers()
  const drain: PromiseWithResolvers<void> = Promise.withResolvers()
  const reached: PromiseWithResolvers<void> = Promise.withResolvers()
  const { fixture, connection, ctx, call } = await setup(() => { reached.resolve(); return drain.promise })
  fixture.holdCalls(reply.promise)
  const accepted = call('accepted')
  try {
    await expect.poll(() => fixture.calls.length).toBe(1)
    const stopped = connection.stopAccepting()
    expect(connection.stopAccepting()).toBe(stopped)
    expect((await call('rejected')).isError).toBe(true)
    expect(fixture.calls).toHaveLength(1)
    reply.resolve()
    expect((await accepted).isError).toBe(false)
    await stopped
    const closing = connection.dispose()
    expect(connection.dispose()).toBe(closing)
    await reached.promise
    expect(ctx.tools.get('mcp__mantur_cut__mutate')).toBeDefined()
    drain.resolve()
    await closing
    expect(ctx.tools.get('mcp__mantur_cut__mutate')).toBeUndefined()
  } finally { reply.resolve(); drain.resolve(); await accepted }
})

it.each(['tool', 'cancel'] as const)('retains an accepted %s failure across repeated shutdown requests', async (kind) => {
  const reply: PromiseWithResolvers<void> = Promise.withResolvers()
  const { fixture, connection, call } = await setup()
  fixture.holdCalls(reply.promise)
  const controller = new AbortController()
  const accepted = call('accepted-failure', controller.signal)
  try {
    await expect.poll(() => fixture.calls.length).toBe(1)
    const stopped = connection.stopAccepting()
    const rejected = expect(stopped).rejects.toThrow('accepted execution failed')
    if (kind === 'tool') fixture.failures.set(fixture.initialized[0]!.id, 'tool')
    else controller.abort(new Error('user cancelled'))
    reply.resolve()
    expect((await accepted).isError).toBe(true)
    await rejected
    await expect(connection.dispose()).rejects.toThrow('accepted execution failed')
    await expect(connection.stopAccepting()).rejects.toThrow('accepted execution failed')
    expect(fixture.calls).toHaveLength(1)
  } finally { reply.resolve(); await accepted }
})

it('rejects remote owner flush failure without falsely closing the transport', async () => {
  const close = vi.spyOn(Client.prototype, 'close')
  const { connection } = await setup(() => Promise.reject(new Error('project write failed')))
  const closing = connection.dispose()
  await expect(closing).rejects.toThrow('project write failed')
  expect(connection.dispose()).toBe(closing)
  expect(close).not.toHaveBeenCalled()
})

it('bounds an unfinished owner drain and preserves the failed result', async () => {
  const reached: PromiseWithResolvers<void> = Promise.withResolvers()
  const drain: PromiseWithResolvers<void> = Promise.withResolvers()
  const { connection } = await setup(() => { reached.resolve(); return drain.promise })
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    const closing = connection.dispose()
    const rejected = expect(closing).rejects.toThrow('shutdown timed out')
    await reached.promise
    await vi.advanceTimersByTimeAsync(1000)
    await rejected
    drain.resolve()
    await expect(connection.dispose()).rejects.toThrow('shutdown timed out')
  } finally { drain.resolve() }
})

it('preserves a transport close rejection even when onclose has fired', async () => {
  const { connection } = await setup()
  // eslint-disable-next-line @typescript-eslint/unbound-method -- The spy invokes the original with its actual Client receiver.
  const original = Client.prototype.close
  vi.spyOn(Client.prototype, 'close').mockImplementation(async function (this: Client) {
    await original.call(this)
    throw new Error('transport cleanup failed')
  })
  await expect(connection.dispose()).rejects.toThrow('transport cleanup failed')
  await expect(connection.dispose()).rejects.toThrow('transport cleanup failed')
})

it.each(['reject', 'timeout'] as const)('retains an expired generation cleanup %s after the tool call has settled', async (kind) => {
  const { connection, fixture, call } = await setup()
  // eslint-disable-next-line @typescript-eslint/unbound-method -- The spy invokes the original with its actual Client receiver.
  const original = Client.prototype.close
  const closed: PromiseWithResolvers<void> = Promise.withResolvers()
  vi.spyOn(Client.prototype, 'close').mockImplementation(async function (this: Client) {
    await original.call(this)
    if (kind === 'reject') throw new Error('expired transport cleanup failed')
    await closed.promise
  })
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    fixture.failures.set(fixture.initialized[0]!.id, 404)
    expect((await call('expired-before-shutdown')).isError).toBe(true)
    await vi.advanceTimersByTimeAsync(5000)
    await connection.stopAccepting()
    const stopping = connection.dispose()
    await expect(stopping).rejects.toThrow('generation cleanup failed')
    expect(connection.dispose()).toBe(stopping)
    expect(fixture.initializeRequests).toHaveLength(1)
  } finally { closed.resolve() }
})

it('does not treat an onclose callback as a finished close promise', async () => {
  const { connection } = await setup()
  // eslint-disable-next-line @typescript-eslint/unbound-method -- The spy invokes the original with its actual Client receiver.
  const original = Client.prototype.close
  const reached: PromiseWithResolvers<void> = Promise.withResolvers()
  const closed: PromiseWithResolvers<void> = Promise.withResolvers()
  vi.spyOn(Client.prototype, 'close').mockImplementation(async function (this: Client) {
    await original.call(this)
    reached.resolve()
    await closed.promise
  })
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    const closing = connection.dispose()
    const rejected = expect(closing).rejects.toThrow('shutdown timed out')
    await reached.promise
    await vi.advanceTimersByTimeAsync(5000)
    await rejected
  } finally { closed.resolve() }
})

it.each([false, true])('waits for the admitted image write and retains its failure (reject: %s)', async (reject) => {
  const { ctx, connection, fixture } = await setup()
  fixture.replyWithImage()
  const reached: PromiseWithResolvers<void> = Promise.withResolvers()
  const saved: PromiseWithResolvers<void> = Promise.withResolvers()
  // These service fakes expose only the methods consumed by MCP image projection.
  ctx.provide('llm', { resolveModelInfo: async () => ({ inputModalities: ['image'] }) } as unknown as LlmRuntime)
  ctx.provide('attachments', {
    saveImages: async () => {
      reached.resolve()
      await saved.promise
      return [{ attachmentId: AttachmentId(`sha256:${'1'.repeat(64)}`), mediaType: 'image/png', bytes: 1, width: 1, height: 1 }]
    },
  } as unknown as AttachmentStore)
  const accepted = ctx.tools.execute({
    name: 'mcp__mantur_cut__mutate', arguments: {}, callId: ToolCallId('image-write'), signal: new AbortController().signal,
    agent: { options: { provider: 'image-fixture', model: 'vision' }, session: { requestHeader: () => undefined } } as never,
  })
  try {
    await reached.promise
    const stopping = connection.stopAccepting()
    let done = false
    void stopping.then(() => { done = true }, () => { done = true })
    await Promise.resolve()
    expect(done).toBe(false)
    if (reject) saved.reject(new Error('image disk write failed'))
    else saved.resolve()
    // Ordinary image refusal remains model-visible text; shutdown still owns the write failure.
    expect((await accepted).isError).toBe(false)
    if (reject) await expect(stopping).rejects.toThrow('accepted execution failed')
    else await stopping
  } finally { saved.resolve(); await accepted }
})

it('retains its namespace until the owner finishes draining during scoped disposal', async () => {
  const reached: PromiseWithResolvers<void> = Promise.withResolvers()
  const drained: PromiseWithResolvers<void> = Promise.withResolvers()
  const { ctx, fiber, config } = await setup(() => { reached.resolve(); return drained.promise })
  const disposing = fiber.dispose()
  try {
    await reached.promise
    expect(() => connectMcpServer(ctx, config)).toThrow('already in use')
    drained.resolve()
    await disposing
    const replacement = connectMcpServer(ctx, config)
    await replacement.ready
    await replacement.dispose()
  } finally { drained.resolve(); await disposing }
})
