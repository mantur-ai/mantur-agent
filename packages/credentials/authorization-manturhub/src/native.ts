/** dsh-child client for Electron's account owner; neither Remotes nor command environments receive a device bearer. */
import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import type { Branded } from '@deepseek-ai/dsh-brand'
import { z } from 'zod'

type MessageId = Branded<'ManturNativeMessageId'>
type ScopeId = Branded<'ManturNativeScopeId'>
const id = z.uuid().transform(value => value as MessageId)
const scopeId = z.uuid().transform(value => value as ScopeId)
const snapshotSchema = z.strictObject({
  phase: z.enum(['idle', 'signed-out', 'authorizing', 'signed-in', 'pending-activation', 'link-required', 'failed']),
  busy: z.boolean(), authenticated: z.boolean(), skipped: z.boolean(), pendingRevocations: z.number().int().nonnegative(),
  account: z.strictObject({ displayName: z.string(), expiresAt: z.number().int().positive() }).optional(),
  attempt: z.strictObject({ expiresAt: z.number().int().positive(), exchangePending: z.literal(true).optional() }).optional(),
  failure: z.strictObject({ kind: z.string(), code: z.string().optional(), retryAfterMs: z.number().nonnegative().optional() }).optional(),
})
const descriptorSchema = z.strictObject({
  version: z.literal(2), proxy_origin: z.url(), public_base_url: z.url(), bridge_secret: z.string().regex(/^mbp_v2_[A-Za-z0-9_-]{43}$/u),
  environment: z.enum(['production', 'test']), environment_label: z.string().min(1).max(80), expires_at: z.iso.datetime({ offset: true }),
})
const environmentSchema = z.strictObject({
  MANTURHUB_IDENTITY_MODE: z.literal('desktop-managed'),
  MANTURHUB_AGENT_AUTH: z.string().refine(isAbsolute),
})
const preparedSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('authorized'), environment: environmentSchema, descriptor: descriptorSchema }),
  z.strictObject({ kind: z.literal('signed-out'), environment: z.strictObject({ MANTURHUB_IDENTITY_MODE: z.literal('desktop-managed') }) }),
])
const replySchema = z.strictObject({ type: z.literal('mantur:account:reply'), id, ok: z.boolean(), value: z.unknown() })
const stopSchema = z.strictObject({ type: z.literal('mantur:account:stop-scope'), scopeId })

/** Profile-owned transport budgets sent to Main once, before account or command requests. */
export interface NativeAccountConfiguration {
  /** Canonical API origin selected by the machine-local profile. */
  readonly origin: string
  /** Named deployment owning this device grant. */
  readonly environment: 'production' | 'test'
  /** Human-readable deployment label included in each local broker descriptor. */
  readonly environmentLabel: string
  /** Complete network-operation and IPC-reply deadline in milliseconds. */
  readonly requestTimeoutMs: number
  /** Maximum buffered native-account protocol response bytes. */
  readonly maxResponseBytes: number
  /** Maximum command capability lifetime in milliseconds, capped by the original device expiry. */
  readonly leaseMs: number
  /** Interval between attempts to finish encrypted pending remote revocations. */
  readonly revocationRetryMs: number
}

/** Prepared environment and cancellation; release is legal only after the consumer proves its entire process tree is gone. */
export interface NativeCommandLease {
  readonly environment: Readonly<Record<string, string>>
  readonly signal: AbortSignal
  release(): Promise<void>
}

interface Pending {
  readonly resolve: (value: unknown) => void
  readonly reject: (error: Error) => void
}

interface Scope {
  readonly abort: AbortController
  readonly done: PromiseWithResolvers<undefined>
}

/** One provider-owned IPC endpoint; command scopes outlive individual CLI descendants but never silently renew. */
export class NativeAccountConnection {
  private readonly pending = new Map<MessageId, Pending>()
  private readonly scopes = new Map<ScopeId, Scope>()
  private readonly ready: Promise<unknown>
  private readonly shutdown = new AbortController()
  private closing = false
  private closed: Promise<void> | undefined
  private readonly config: NativeAccountConfiguration

  /**
   * @param config - machine-local profile environment; renderer messages cannot change these values.
   */
  constructor(config: NativeAccountConfiguration) {
    this.config = config
    if (process.send === undefined || !process.connected) throw new Error('Native account requires the Electron parent IPC channel')
    process.on('message', this.receive)
    process.on('disconnect', this.disconnected)
    this.ready = this.request('configure', { config }, this.shutdown.signal)
    void this.ready.catch(() => { /* status and prepare return initialization failure; no standalone identity is consulted. */ })
  }

  /** Complete the Main configuration handshake before Cordis makes this provider available. */
  async initialize(): Promise<void> { await this.ready }

  /**
   * Read Main's public state after the profile is configured.
   * @returns the validated, secret-free account snapshot.
   */
  async status(): Promise<z.infer<typeof snapshotSchema>> {
    await this.ready
    return snapshotSchema.parse(await this.request('status', {}, this.shutdown.signal))
  }

  /**
   * Prepare an exact-grant command scope before any process allocation.
   * @param signal - cancellation covering preparation and the later command lifetime.
   * @returns non-secret environment, revocation signal and an awaited release operation.
   */
  async prepare(signal: AbortSignal): Promise<NativeCommandLease> {
    const lease = await this.admit(signal)
    return {
      environment: { MANTURHUB_AGENT_AUTH: '', ...lease.environment },
      signal: lease.signal, release: lease.release,
    }
  }

  /**
   * Read an authenticated API response through Main and retain the scope through EOF or cancellation.
   * @param path - root-relative versioned API path; Main independently validates it.
   * @param headers - non-secret consumer headers, filtered by Main.
   * @param signal - complete-request cancellation supplied by the API consumer.
   * @returns a streaming response, or undefined for an explicitly signed-out identity.
   */
  async requestApi(path: string, headers: HeadersInit | undefined, signal: AbortSignal): Promise<Response | undefined> {
    if (!path.startsWith('/api/v1/') || /[\\#\u0000-\u0020\u007f]/u.test(path)
      || /%(?:2f|5c|25)/iu.test(path) || path.split(/[/?]/u).some(part => /^(?:\.|%2e){1,2}$/iu.test(part))) {
      throw new TypeError('Native account request requires a versioned API path')
    }
    const lease = await this.admit(signal)
    if (lease.descriptor === undefined) { await lease.release(); return undefined }
    const descriptor = lease.descriptor
    const safeHeaders = new Headers(headers)
    safeHeaders.set('Authorization', `Bearer ${descriptor.bridge_secret}`)
    safeHeaders.set('X-Mantur-Broker-Version', '2')
    let response: Response
    try {
      response = await fetch(`${descriptor.proxy_origin}${path}`, { headers: safeHeaders, signal: lease.signal, redirect: 'error' })
    } catch {
      await lease.release()
      throw new Error('Native account request failed')
    }
    if (response.body === null) { await lease.release(); return response }
    const reader = response.body.getReader()
    let cleaned: Promise<void> | undefined
    const cleanup = (cancel: boolean): Promise<void> => {
      cleaned ??= (async () => {
        lease.signal.removeEventListener('abort', abort)
        try { if (cancel) await reader.cancel() }
        finally { reader.releaseLock(); await lease.release() }
      })()
      return cleaned
    }
    let stream: ReadableStreamDefaultController<Uint8Array>
    const abort = (): void => {
      void cleanup(true).then(
        () => { stream.error(new DOMException('Native account request cancelled', 'AbortError')) },
        () => { stream.error(new Error('Native account request cleanup failed')) },
      )
    }
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => { stream = controller },
      pull: async (controller) => {
        try {
          const next = await reader.read()
          if (lease.signal.aborted) return
          if (next.done) { await cleanup(false); controller.close() }
          else if (cleaned === undefined) controller.enqueue(next.value)
        } catch {
          try { await cleanup(true) }
          finally { controller.error(new Error('Native account response stream failed')) }
        }
      },
      cancel: () => cleanup(true),
    })
    lease.signal.addEventListener('abort', abort, { once: true })
    if (lease.signal.aborted) abort()
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
  }

  /** Stop preparation and API owners; command consumers retain their leases until their process trees stop. */
  close(): Promise<void> {
    this.closing = true
    this.closed ??= (async () => {
      const owned = [...this.scopes.values()]
      this.shutdown.abort()
      for (const scope of owned) scope.abort.abort()
      const settled = await Promise.allSettled(owned.map(scope => scope.done.promise))
      if (settled.some(result => result.status === 'rejected')) throw new Error('Native account cleanup was not acknowledged')
      process.removeListener('message', this.receive)
      process.removeListener('disconnect', this.disconnected)
    })()
    return this.closed
  }

  private async admit(signal: AbortSignal) {
    if (this.closing) throw new Error('Native account connection is closing')
    signal.throwIfAborted()
    const scopeId = randomUUID() as ScopeId
    const scope: Scope = { abort: new AbortController(), done: Promise.withResolvers<undefined>() }
    void scope.done.promise.catch(() => { /* release and close both report the unacknowledged cleanup. */ })
    const lifetime = AbortSignal.any([signal, scope.abort.signal, this.shutdown.signal])
    this.scopes.set(scopeId, scope)
    let opened = false
    let released: Promise<void> | undefined
    const release = (): Promise<void> => {
      released ??= (async () => {
        try {
          if (opened) await this.request('close-scope', { scopeId }, new AbortController().signal)
          this.scopes.delete(scopeId)
          scope.done.resolve(undefined)
        } catch (error) {
          scope.done.reject(error)
          throw error
        }
      })()
      return released
    }
    try {
      await this.ready
      lifetime.throwIfAborted()
      opened = true
      const result = preparedSchema.parse(await this.request('open-scope', { scopeId }, lifetime))
      lifetime.throwIfAborted()
      if (result.kind === 'signed-out') {
        opened = false
        return { environment: result.environment, signal: lifetime, release, descriptor: undefined }
      }
      const proxy = new URL(result.descriptor.proxy_origin)
      if (proxy.origin !== result.descriptor.proxy_origin || proxy.protocol !== 'http:' || proxy.hostname !== '127.0.0.1' || proxy.port === ''
        || result.descriptor.public_base_url !== this.config.origin || result.descriptor.environment !== this.config.environment
        || Date.parse(result.descriptor.expires_at) <= Date.now()) throw new Error('Native account descriptor does not match its profile')
      return { environment: result.environment, signal: lifetime, release, descriptor: result.descriptor }
    } catch (error) {
      await release()
      throw error
    }
  }

  private request(type: 'configure' | 'status' | 'open-scope' | 'close-scope', fields: object, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted()
    if (process.send === undefined || !process.connected) return Promise.reject(new Error('Native account parent is unavailable'))
    const id = randomUUID() as MessageId
    return new Promise((resolve, reject) => {
      const finish = (error: Error | undefined, value?: unknown): void => {
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        this.pending.delete(id)
        if (error === undefined) resolve(value)
        else reject(error)
      }
      const abort = (): void => { finish(new Error('Native account request cancelled')) }
      const timer = setTimeout(() => { finish(new Error('Native account parent did not reply')) }, this.config.requestTimeoutMs)
      this.pending.set(id, { resolve: (value) => { finish(undefined, value) }, reject: (error) => { finish(error) } })
      signal.addEventListener('abort', abort, { once: true })
      process.send?.({ type: `mantur:account:${type}`, id, ...fields }, (error) => {
        if (error !== null) finish(new Error('Native account IPC send failed'))
      })
    })
  }

  private readonly receive = (input: unknown): void => {
    const stopped = stopSchema.safeParse(input)
    if (stopped.success) { this.scopes.get(stopped.data.scopeId)?.abort.abort(); return }
    const parsed = replySchema.safeParse(input)
    if (!parsed.success) return
    const pending = this.pending.get(parsed.data.id)
    if (pending === undefined) return
    if (parsed.data.ok) pending.resolve(parsed.data.value)
    else pending.reject(new Error('Native account operation was refused by Main'))
  }

  private readonly disconnected = (): void => {
    for (const pending of this.pending.values()) pending.reject(new Error('Native account parent disconnected'))
    for (const scope of this.scopes.values()) scope.abort.abort()
  }
}
