import { randomUUID } from 'node:crypto'
import { resolve, join } from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import CommandScopes, { type CommandIdentityProvider } from '@deepseek-ai/dsh-command-scopes'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import ManturHubAuthorization, { type Config } from '../src/index.ts'
import { afterEach, expect, it, vi } from 'vitest'
import { NativeAccountConnection, type NativeAccountConfiguration, type NativeCommandLease } from '../src/native.ts'

const config: NativeAccountConfiguration = {
  origin: 'https://account.example', environment: 'test', environmentLabel: 'Test',
  requestTimeoutMs: 1000, maxResponseBytes: 4096, leaseMs: 60000, revocationRetryMs: 1000,
}
const signedOut = { kind: 'signed-out', environment: { MANTURHUB_IDENTITY_MODE: 'desktop-managed' } }
const authorized = () => ({
  kind: 'authorized', environment: { MANTURHUB_IDENTITY_MODE: 'desktop-managed', MANTURHUB_AGENT_AUTH: resolve('descriptor.json') },
  descriptor: { version: 2, proxy_origin: 'http://127.0.0.1:12345', public_base_url: config.origin,
    bridge_secret: `mbp_v2_${'a'.repeat(43)}`, environment: 'test', environment_label: 'Test',
    expires_at: new Date(Date.now() + 60000).toISOString() },
})
type Frame = { type: string; id: string; scopeId?: string }
const restorers: Array<() => Promise<void>> = []
const unblockers: Array<() => void> = []
const globalRestorers: Array<() => Promise<void>> = []

/** Release fixture barriers before waiting for owners; restore process globals last, even after cleanup failure. */
async function cleanupFixture(): Promise<void> {
  const failures: unknown[] = []
  for (const unblock of unblockers.splice(0)) {
    try { unblock() } catch (error) { failures.push(error) }
  }
  for (const queue of [restorers, globalRestorers]) {
    while (queue.length > 0) {
      try { await queue.pop()!() } catch (error) { failures.push(error) }
    }
  }
  vi.useRealTimers()
  vi.restoreAllMocks()
  if (failures.length > 0) throw new AggregateError(failures, 'Native test cleanup failed')
}
afterEach(cleanupFixture)

/** Own resources acquired through the actual connection, including failed-test cleanup. */
class OwnedConnection extends NativeAccountConnection {
  private readonly apiAbort = new AbortController()
  private readonly leases = new Set<NativeCommandLease>()
  private readonly apiRequests = new Set<Promise<Response | undefined>>()

  constructor(configuration: NativeAccountConfiguration, expectedCleanupFailure = false) {
    super(configuration)
    restorers.push(async () => {
      this.apiAbort.abort()
      await Promise.allSettled([...this.apiRequests])
      const released = await Promise.allSettled([...this.leases].map(lease => lease.release()))
      if (expectedCleanupFailure) {
        for (const result of released) {
          if (result.status === 'rejected') {
            expect(result.reason).toBeInstanceOf(Error)
            expect((result.reason as Error).message).toContain('refused')
          }
        }
        await expect(this.close()).rejects.toThrow('not acknowledged')
      } else {
        await this.close()
        for (const result of released) if (result.status === 'rejected') throw result.reason
      }
    })
  }

  override async prepare(signal: AbortSignal): Promise<NativeCommandLease> {
    const lease = await super.prepare(signal)
    this.leases.add(lease)
    return lease
  }

  override requestApi(path: string, headers: HeadersInit | undefined, signal: AbortSignal): Promise<Response | undefined> {
    const request = super.requestApi(path, headers, AbortSignal.any([signal, this.apiAbort.signal]))
    this.apiRequests.add(request)
    return request
  }
}

/** Intercept only account frames and deliver replies to this connection's own listener. */
function transport() {
  const sendDescriptor = Object.getOwnPropertyDescriptor(process, 'send')
  const connectedDescriptor = Object.getOwnPropertyDescriptor(process, 'connected')
  const originalSend = process.send?.bind(process)
  const baselineMessage = new Set(process.listeners('message'))
  const baselineDisconnect = new Set(process.listeners('disconnect'))
  const frames: Frame[] = []
  let sendError: Error | undefined
  let handler: (frame: Frame) => void = (frame) => { reply(frame, undefined) }
  const receive = (value: unknown) => {
    for (const listener of process.listeners('message')) if (!baselineMessage.has(listener)) listener(value, undefined)
  }
  const reply = (frame: Frame, value: unknown, ok = true) => { receive({ type: 'mantur:account:reply', id: frame.id, ok, value }) }
  Object.defineProperty(process, 'connected', { configurable: true, value: true })
  Object.defineProperty(process, 'send', { configurable: true, value: (...args: unknown[]) => {
    const message = args[0]
    if (typeof message === 'object' && message !== null && 'type' in message
      && typeof message.type === 'string' && message.type.startsWith('mantur:account:')) {
      const frame = message as Frame
      frames.push(frame)
      const callback = args.find(value => typeof value === 'function')
      if (typeof callback === 'function') (callback as (error: Error | null) => void)(sendError ?? null)
      if (sendError === undefined) queueMicrotask(() => { handler(frame) })
      return true
    }
    return originalSend === undefined ? undefined : Reflect.apply(originalSend, process, args) as unknown
  } })
  globalRestorers.push(async () => {
    for (const listener of process.listeners('message')) if (!baselineMessage.has(listener)) process.removeListener('message', listener)
    for (const listener of process.listeners('disconnect')) if (!baselineDisconnect.has(listener)) process.removeListener('disconnect', listener)
    if (sendDescriptor) Object.defineProperty(process, 'send', sendDescriptor)
    else Reflect.deleteProperty(process, 'send')
    if (connectedDescriptor) Object.defineProperty(process, 'connected', connectedDescriptor)
    else Reflect.deleteProperty(process, 'connected')
    expect(Object.getOwnPropertyDescriptor(process, 'send')).toEqual(sendDescriptor)
    expect(Object.getOwnPropertyDescriptor(process, 'connected')).toEqual(connectedDescriptor)
  })
  unblockers.push(() => {
    // Pending injected IPC must not keep teardown waiting after an assertion aborts a case.
    handler = (frame) => { reply(frame, undefined) }
    for (const frame of frames) reply(frame, undefined)
  })
  return { frames, reply, receive, failSend: () => { sendError = new Error('transport failure') }, handle: (next: typeof handler) => { handler = next }, disconnect: () => {
    for (const listener of process.listeners('disconnect')) if (!baselineDisconnect.has(listener)) listener()
  } }
}

it('requires a connected Electron parent', () => {
  transport()
  Object.defineProperty(process, 'connected', { configurable: true, value: false })
  expect(() => new NativeAccountConnection(config)).toThrow('Electron parent')
  Object.defineProperty(process, 'connected', { configurable: true, value: true })
  Object.defineProperty(process, 'send', { configurable: true, value: undefined })
  expect(() => new NativeAccountConnection(config)).toThrow('Electron parent')
})

it('validates public snapshots and ignores unrelated or stale IPC replies', async () => {
  const ipc = transport()
  const connection = new OwnedConnection(config)
  await connection.initialize()
  ipc.handle((frame) => {
    ipc.receive({ type: 'other' })
    ipc.receive({ type: 'mantur:account:reply', id: randomUUID(), ok: true, value: 'stale' })
    ipc.receive({ type: 'mantur:account:stop-scope', scopeId: randomUUID() })
    ipc.reply(frame, { phase: 'signed-out', busy: false, authenticated: false, skipped: false, pendingRevocations: 0 })
  })
  expect(await connection.status()).toMatchObject({ authenticated: false })
  ipc.handle((frame) => { ipc.reply(frame, { phase: 'signed-out', secret: 'unexpected' }) })
  await expect(connection.status()).rejects.toThrow()
  await connection.close()
})

it('holds shutdown until the caller releases its revoked command scope once', async () => {
  const ipc = transport()
  ipc.handle((frame) => { ipc.reply(frame, frame.type.endsWith('open-scope') ? authorized() : undefined) })
  const connection = new OwnedConnection(config)
  const lease = await connection.prepare(new AbortController().signal)
  expect(lease.environment.MANTURHUB_AGENT_AUTH).toBe(resolve('descriptor.json'))
  let closed = false
  const closing = connection.close().then(() => { closed = true })
  expect(connection.close()).toBe(connection.close())
  await Promise.resolve()
  expect(lease.signal.aborted).toBe(true)
  expect(closed).toBe(false)
  await expect(connection.prepare(new AbortController().signal)).rejects.toThrow('closing')
  const closeRequest = Promise.withResolvers<Frame>()
  ipc.handle((frame) => { closeRequest.resolve(frame) })
  const releasing = Promise.all([lease.release(), lease.release()])
  const closeFrame = await closeRequest.promise
  expect(closed).toBe(false)
  ipc.reply(closeFrame, undefined)
  await releasing
  await closing
  expect(ipc.frames.filter(frame => frame.type.endsWith('close-scope'))).toHaveLength(1)
})

it('keeps explicitly signed-out commands free of inherited descriptor paths', async () => {
  const ipc = transport()
  ipc.handle((frame) => { ipc.reply(frame, frame.type.endsWith('open-scope') ? signedOut : undefined) })
  const connection = new OwnedConnection(config)
  const lease = await connection.prepare(new AbortController().signal)
  expect(lease.environment).toEqual({ MANTURHUB_AGENT_AUTH: '', MANTURHUB_IDENTITY_MODE: 'desktop-managed' })
  await lease.release()
  expect(await connection.requestApi('/api/v1/me', undefined, new AbortController().signal)).toBeUndefined()
  expect(ipc.frames.some(frame => frame.type.endsWith('close-scope'))).toBe(false)
  await connection.close()
})

it.each(['/api/v2/me', '/api/v1/a\\b', '/api/v1/a#b', '/api/v1/%2f', '/api/v1/%5c', '/api/v1/%25', '/api/v1/../me', '/api/v1/%2e%2e/me'])('rejects unsafe API path %s before admission', async (path) => {
  transport()
  const connection = new OwnedConnection(config)
  await connection.initialize()
  await expect(connection.requestApi(path, undefined, new AbortController().signal)).rejects.toThrow('versioned API path')
  await connection.close()
})

it.each(['proxy_origin', 'public_base_url', 'environment', 'expires_at'] as const)('releases a scope whose descriptor has invalid %s', async (field) => {
  const ipc = transport()
  const prepared = authorized()
  prepared.descriptor[field] = { proxy_origin: 'https://127.0.0.1:12345', public_base_url: 'https://other.example', environment: 'production', expires_at: '2000-01-01T00:00:00.000Z' }[field]
  ipc.handle((frame) => { ipc.reply(frame, frame.type.endsWith('open-scope') ? prepared : undefined) })
  const connection = new OwnedConnection(config)
  await expect(connection.prepare(new AbortController().signal)).rejects.toThrow('does not match')
  expect(ipc.frames.filter(frame => frame.type.endsWith('close-scope'))).toHaveLength(1)
  await connection.close()
})

it('surfaces an unacknowledged release to both caller and shutdown', async () => {
  const ipc = transport()
  ipc.handle((frame) => { ipc.reply(frame, frame.type.endsWith('open-scope') ? authorized() : undefined, !frame.type.endsWith('close-scope')) })
  const connection = new OwnedConnection(config, true)
  const lease = await connection.prepare(new AbortController().signal)
  await expect(lease.release()).rejects.toThrow('refused')
  await expect(connection.close()).rejects.toThrow('not acknowledged')
})

it('bounds an unanswered configuration handshake', async () => {
  vi.useFakeTimers()
  const ipc = transport()
  ipc.handle(() => {})
  const connection = new OwnedConnection(config)
  const result = expect(connection.initialize()).rejects.toThrow('did not reply')
  await vi.advanceTimersByTimeAsync(config.requestTimeoutMs)
  await result
  await connection.close()
})

it('rejects pending work when its own parent channel disconnects', async () => {
  const ipc = transport()
  const connection = new OwnedConnection(config)
  await connection.initialize()
  ipc.handle(() => { ipc.disconnect() })
  await expect(connection.status()).rejects.toThrow('disconnected')
  await connection.close()
})

it('stops an exact command scope on a Main revocation message', async () => {
  const ipc = transport()
  ipc.handle((frame) => { ipc.reply(frame, frame.type.endsWith('open-scope') ? authorized() : undefined) })
  const connection = new OwnedConnection(config)
  const lease = await connection.prepare(new AbortController().signal)
  ipc.receive({ type: 'mantur:account:stop-scope', scopeId: ipc.frames.find(frame => frame.type.endsWith('open-scope'))!.scopeId })
  expect(lease.signal.aborted).toBe(true)
  await lease.release()
  await connection.close()
})

it('rejects an aborted caller before opening a scope', async () => {
  const ipc = transport()
  const connection = new OwnedConnection(config)
  await connection.initialize()
  await expect(connection.prepare(AbortSignal.abort())).rejects.toThrow()
  expect(ipc.frames).toHaveLength(1)
  await connection.close()
})

it('cancels an in-flight scope handshake and waits for its close acknowledgement', async () => {
  const ipc = transport()
  const opened = Promise.withResolvers<Frame>()
  ipc.handle((frame) => {
    if (frame.type.endsWith('open-scope')) opened.resolve(frame)
    else ipc.reply(frame, undefined)
  })
  const connection = new OwnedConnection(config)
  const controller = new AbortController()
  const pending = connection.prepare(controller.signal)
  const rejected = expect(pending).rejects.toThrow('cancelled')
  await opened.promise
  controller.abort()
  await rejected
  expect(ipc.frames.filter(frame => frame.type.endsWith('close-scope'))).toHaveLength(1)
  await connection.close()
})

it('fails a request when the configured parent becomes unavailable', async () => {
  transport()
  const connection = new OwnedConnection(config)
  await connection.initialize()
  Object.defineProperty(process, 'connected', { configurable: true, value: false })
  await expect(connection.status()).rejects.toThrow('unavailable')
  await connection.close()
})

/** Replace only the exact broker URL used by this fixture, forwarding every other fetch. */
function brokerFetch(run: (init: RequestInit | undefined) => Promise<Response>) {
  const original = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    if (input === 'http://127.0.0.1:12345/api/v1/me') return run(init)
    return original(input, init)
  })
}

it.each(['body', 'empty', 'fetch-error'] as const)('releases authenticated API scope after %s', async (mode) => {
  const ipc = transport()
  ipc.handle((frame) => { ipc.reply(frame, frame.type.endsWith('open-scope') ? authorized() : undefined) })
  const connection = new OwnedConnection(config)
  brokerFetch(async (init) => {
    expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer mbp_v2_${'a'.repeat(43)}`)
    expect(new Headers(init?.headers).get('X-Mantur-Broker-Version')).toBe('2')
    expect(init?.redirect).toBe('error')
    if (mode === 'fetch-error') throw new Error('private transport failure')
    return mode === 'empty' ? new Response(null, { status: 204 }) : new Response('account', { status: 201, statusText: 'Created', headers: { 'x-test': 'retained' } })
  })
  const response = connection.requestApi('/api/v1/me', { Authorization: 'untrusted' }, new AbortController().signal)
  if (mode === 'fetch-error') await expect(response).rejects.toThrow('Native account request failed')
  else {
    const value = (await response)!
    if (mode === 'body') {
      expect(value.status).toBe(201)
      expect(value.statusText).toBe('Created')
      expect(value.headers.get('x-test')).toBe('retained')
      expect(await value.text()).toBe('account')
    } else expect(value.status).toBe(204)
  }
  expect(ipc.frames.filter(frame => frame.type.endsWith('close-scope'))).toHaveLength(1)
  await connection.close()
})

it.each(['cancel', 'abort', 'read-error', 'abort-cleanup-error'] as const)('joins response cleanup on %s', async (mode) => {
  const ipc = transport()
  ipc.handle((frame) => { ipc.reply(frame, frame.type.endsWith('open-scope') ? authorized() : undefined) })
  const connection = new OwnedConnection(config, mode === 'abort-cleanup-error')
  let source!: ReadableStreamDefaultController<Uint8Array>
  const cancelled = Promise.withResolvers<undefined>()
  const cleanup = Promise.withResolvers<undefined>()
  unblockers.push(() => { cleanup.resolve(undefined) })
  const body = new ReadableStream<Uint8Array>({
    start(controller) { source = controller },
    async cancel() { cancelled.resolve(undefined); await cleanup.promise },
  })
  brokerFetch(async () => new Response(body))
  const controller = new AbortController()
  const response = (await connection.requestApi('/api/v1/me', undefined, controller.signal))!
  const reader = response.body!.getReader()
  restorers.push(async () => { reader.releaseLock() })
  if (mode === 'read-error') {
    source.error(new Error('private stream failure'))
    await expect(reader.read()).rejects.toThrow('response stream failed')
  } else {
    const ending = mode === 'cancel' ? reader.cancel() : reader.read()
    const asserted = mode === 'cancel' ? expect(ending).resolves.toBeUndefined()
      : expect(ending).rejects.toThrow(mode === 'abort' ? 'cancelled' : 'cleanup failed')
    if (mode !== 'cancel') controller.abort()
    await cancelled.promise
    expect(ipc.frames.filter(frame => frame.type.endsWith('close-scope'))).toHaveLength(0)
    if (mode === 'abort-cleanup-error') {
      ipc.handle((frame) => { ipc.reply(frame, undefined, false) })
    }
    cleanup.resolve(undefined)
    await asserted
  }
  reader.releaseLock()
  expect(body.locked).toBe(false)
  expect(ipc.frames.filter(frame => frame.type.endsWith('close-scope'))).toHaveLength(1)
  if (mode === 'abort-cleanup-error') await expect(connection.close()).rejects.toThrow('not acknowledged')
  else await connection.close()
})

it('reports IPC send failure without leaking transport detail', async () => {
  const ipc = transport()
  ipc.failSend()
  const connection = new OwnedConnection(config)
  await expect(connection.initialize()).rejects.toThrow('IPC send failed')
  await connection.close()
})

it('revokes existing scopes when the parent disconnects', async () => {
  const ipc = transport()
  ipc.handle((frame) => { ipc.reply(frame, frame.type.endsWith('open-scope') ? authorized() : undefined) })
  const connection = new OwnedConnection(config)
  const lease = await connection.prepare(new AbortController().signal)
  ipc.disconnect()
  expect(lease.signal.aborted).toBe(true)
  await lease.release()
  await connection.close()
})

it('cleans up a response whose caller aborted before fetch returned it', async () => {
  const ipc = transport()
  ipc.handle((frame) => { ipc.reply(frame, frame.type.endsWith('open-scope') ? authorized() : undefined) })
  const connection = new OwnedConnection(config)
  const controller = new AbortController()
  brokerFetch(async () => {
    controller.abort()
    return new Response('late body')
  })
  const response = (await connection.requestApi('/api/v1/me', undefined, controller.signal))!
  await expect(response.text()).rejects.toThrow('cancelled')
  await connection.close()
})

it('discards a chunk already delivered by the source when the consumer cancels', async () => {
  const ipc = transport()
  ipc.handle((frame) => { ipc.reply(frame, frame.type.endsWith('open-scope') ? authorized() : undefined) })
  const connection = new OwnedConnection(config)
  let source!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({ start(controller) { source = controller } })
  brokerFetch(async () => new Response(body))
  const response = (await connection.requestApi('/api/v1/me', undefined, new AbortController().signal))!
  source.enqueue(new Uint8Array([1]))
  await response.body!.cancel()
  expect(body.locked).toBe(false)
  await connection.close()
})

/** Mount the real authorization provider with a private credential directory. */
async function bootNative(commandIdentity = false, overrides: Config = {}) {
  const root = await mkdtemp(join(tmpdir(), 'mantur-native-unit-'))
  restorers.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  restorers.push(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(LocalCredentialProvider, { path: join(root, 'credentials.yaml'), watch: false })
  await ctx.plugin(AuthorizationService)
  if (commandIdentity) {
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(CommandScopes, { identity: 'required' })
  }
  const fiber = ctx.plugin(ManturHubAuthorization, {
    identity: 'desktop-managed', environment: 'test', testBaseUrl: config.origin,
    native: { environmentLabel: config.environmentLabel, requestTimeoutMs: config.requestTimeoutMs,
      maxResponseBytes: config.maxResponseBytes, leaseMs: config.leaseMs, revocationRetryMs: config.revocationRetryMs },
    ...overrides,
  })
  await fiber.await()
  return { ctx, account: ctx.manturAccount }
}

it('projects Main identity and refuses browser-owned login mutations', async () => {
  const ipc = transport()
  const { account } = await bootNative()
  expect(account.identityMode()).toBe('desktop-managed')
  ipc.handle((frame) => { ipc.reply(frame, { phase: 'signed-in', busy: false, authenticated: true, skipped: false, pendingRevocations: 0,
    account: { email: 'artist@example.com', expiresAt: Date.now() + 60000 } }) })
  expect(await account.status()).toEqual({ status: 'signed-in', account: { email: 'artist@example.com' } })
  ipc.handle((frame) => { ipc.reply(frame, { phase: 'signed-out', busy: false, authenticated: false, skipped: false, pendingRevocations: 0 }) })
  expect(await account.status()).toEqual({ status: 'signed-out' })
  ipc.handle((frame) => { ipc.reply(frame, { phase: 'signed-in', busy: false, authenticated: true, skipped: false, pendingRevocations: 0 }) })
  await expect(account.status()).rejects.toThrow('could not be read')
  await expect(account.startLogin()).rejects.toThrow('native account window')
  await expect(account.signOut()).rejects.toThrow('native account window')
  expect(() => { account.cancelLogin('attempt' as never) }).toThrow('native account window')
  expect(() => account.loginProgress('attempt' as never)).toThrow('native account window')
})

it('routes authenticated Host requests through the configured Main identity', async () => {
  const ipc = transport()
  ipc.handle((frame) => { ipc.reply(frame, frame.type.endsWith('open-scope') ? signedOut : undefined) })
  const { account } = await bootNative()
  expect(await account.request('/api/v1/me', { authenticated: true })).toBeUndefined()
  expect(await account.request('/api/v1/me', { authenticated: true, signal: new AbortController().signal })).toBeUndefined()
})

it.each([
  { identity: 'desktop-managed' },
  { identity: 'desktop-managed', native: { ...config, requestTimeoutMs: 0 } },
] as Config[])('rejects incomplete native configuration at load', (invalid) => {
  const ctx = new Context()
  restorers.push(async () => { await ctx.fiber.dispose() })
  expect(() => new ManturHubAuthorization(ctx, invalid)).toThrow()
})

it('registers the native command identity and awaits provider teardown', async () => {
  const ipc = transport()
  ipc.handle((frame) => { ipc.reply(frame, frame.type.endsWith('open-scope') ? signedOut : undefined) })
  let provider!: CommandIdentityProvider
  const register = Object.getOwnPropertyDescriptor(CommandScopes.prototype, 'register')!.value as CommandScopes['register']
  vi.spyOn(CommandScopes.prototype, 'register').mockImplementation(function (this: CommandScopes, value) {
    provider = value
    return register.call(this, value)
  })
  const { ctx } = await bootNative(true, { environment: 'production' })
  const lease = await provider.prepare(new AbortController().signal)
  expect(lease.environment.MANTURHUB_IDENTITY_MODE).toBe('desktop-managed')
  await lease.release()
  await ctx.fiber.dispose()
})

it('reports standalone identity without requiring a native connection', async () => {
  transport()
  const { account } = await bootNative(false, { identity: 'standalone' })
  expect(account.identityMode()).toBe('standalone')
  await expect(account.stopNativeForShutdown()).rejects.toThrow('requires an initialized desktop-managed provider')
})

it('does not consult standalone credentials when native connection construction fails', async () => {
  transport()
  Object.defineProperty(process, 'connected', { configurable: true, value: false })
  const ctx = new Context()
  restorers.push(async () => { await ctx.fiber.dispose() })
  expect(() => new ManturHubAuthorization(ctx, { identity: 'desktop-managed', native: {
    environmentLabel: config.environmentLabel, requestTimeoutMs: config.requestTimeoutMs,
    maxResponseBytes: config.maxResponseBytes, leaseMs: config.leaseMs, revocationRetryMs: config.revocationRetryMs,
  } })).toThrow('Electron parent')
  await expect(ctx.manturAccount.status()).rejects.toThrow('could not be read')
})

it('unblocks and releases owned resources when a case fails before normal cleanup', async () => {
  const originalSend = Object.getOwnPropertyDescriptor(process, 'send')
  const originalConnected = Object.getOwnPropertyDescriptor(process, 'connected')
  const originalMessages = process.listeners('message')
  const originalDisconnects = process.listeners('disconnect')
  const ipc = transport()
  ipc.handle((frame) => { ipc.reply(frame, frame.type.endsWith('open-scope') ? authorized() : undefined) })
  const connection = new OwnedConnection(config)
  const lease = await connection.prepare(new AbortController().signal)
  const releaseSource = Promise.withResolvers<undefined>()
  unblockers.push(() => { releaseSource.resolve(undefined) })
  let cancelled = false
  const body = new ReadableStream<Uint8Array>({
    async cancel() { await releaseSource.promise; cancelled = true },
  })
  brokerFetch(async () => new Response(body))
  await connection.requestApi('/api/v1/me', undefined, new AbortController().signal)
  const intentionalFailure = new Error('fixture body failed')
  await expect((async () => {
    try { throw intentionalFailure }
    finally { await cleanupFixture() }
  })()).rejects.toBe(intentionalFailure)
  expect(cancelled).toBe(true)
  expect(body.locked).toBe(false)
  expect(lease.signal.aborted).toBe(true)
  expect(ipc.frames.filter(frame => frame.type.endsWith('close-scope'))).toHaveLength(2)
  await connection.close()
  expect(Object.getOwnPropertyDescriptor(process, 'send')).toEqual(originalSend)
  expect(Object.getOwnPropertyDescriptor(process, 'connected')).toEqual(originalConnected)
  expect(process.listeners('message')).toEqual(originalMessages)
  expect(process.listeners('disconnect')).toEqual(originalDisconnects)
})

it.each([false, true])('joins native command tree and lease receipt before explicit shutdown (failed receipt: %s)', async (failedReceipt) => {
  const ipc = transport()
  ipc.handle((frame) => { ipc.reply(frame, frame.type.endsWith('open-scope') ? authorized() : undefined) })
  const { ctx, account } = await bootNative(true)
  const spec = { argv: [process.execPath, '-e', 'setInterval(() => {}, 1000)'], cwd: process.cwd(), graceMs: 100,
    stdio: { stdin: 'ignore' as const, stdout: { maxBytes: 4096 }, stderr: { maxBytes: 4096 } } }
  const command = await ctx.commandScopes.spawn(spec)
  const receipt = Promise.withResolvers<Frame>()
  ipc.handle((frame) => { receipt.resolve(frame) })
  const stopping = account.stopNativeForShutdown()
  let settled = false
  void stopping.then(() => { settled = true }, () => { settled = true })
  expect(account.stopNativeForShutdown()).toBe(stopping)
  const frame = await receipt.promise
  expect(frame.type).toBe('mantur:account:close-scope')
  await command.done
  expect(await command.waitForExit()).toBe(true)
  expect(settled).toBe(false)
  await expect(ctx.commandScopes.spawn(spec)).rejects.toThrow('Required command identity provider')
  ipc.reply(frame, undefined, !failedReceipt)
  if (failedReceipt) {
    await expect(stopping).rejects.toThrow('Native account shutdown failed')
    await expect(account.stopNativeForShutdown()).rejects.toThrow('Native account shutdown failed')
    await expect(command.cleanup).rejects.toThrow()
  } else {
    await stopping
    await command.cleanup
  }
  expect(account.identityMode()).toBe('desktop-managed')
})

it('joins native API body cancellation through the explicit provider shutdown consumer', async () => {
  const ipc = transport()
  ipc.handle((frame) => { ipc.reply(frame, frame.type.endsWith('open-scope') ? authorized() : undefined) })
  const { account } = await bootNative()
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  unblockers.push(() => { release.resolve(undefined) })
  const body = new ReadableStream<Uint8Array>({
    async cancel() { entered.resolve(undefined); await release.promise },
  })
  brokerFetch(async () => new Response(body))
  const response = await account.request('/api/v1/me', { authenticated: true })
  expect(response).toBeInstanceOf(Response)
  const stopping = account.stopNativeForShutdown()
  let settled = false
  void stopping.then(() => { settled = true }, () => { settled = true })
  await entered.promise
  await expect(account.request('/api/v1/me', { authenticated: true })).rejects.toThrow('Native account connection is closing')
  expect(settled).toBe(false)
  expect(ipc.frames.filter(frame => frame.type.endsWith('close-scope'))).toHaveLength(0)
  release.resolve(undefined)
  await stopping
  expect(body.locked).toBe(false)
  expect(ipc.frames.filter(frame => frame.type.endsWith('close-scope'))).toHaveLength(1)
})
