/** Main-owned broker-v2 transport; device bearers stay inside credential-scoped streaming operations. */
import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { finished, pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import type { NativeAccountController } from './controller.ts'
import { nativeAccountOrigin } from './http.ts'
import type { NativeSecrets } from './protocol.ts'

/** Local capability only; the descriptor writer must apply private ownership before a managed command can start. */
export interface NativeBrokerDescriptor {
  readonly version: 2
  readonly proxy_origin: string
  readonly public_base_url: string
  readonly bridge_secret: string
  readonly environment: NativeSecrets['environment']
  readonly environment_label: string
  readonly expires_at: string
}

/** Profile-selected origin and explicit network/command lifetime budgets. */
export interface NativeBrokerOptions {
  readonly origin: string
  readonly environment: NativeSecrets['environment']
  readonly environmentLabel: string
  readonly requestTimeoutMs: number
  readonly leaseMs: number
  readonly now: () => number
}

type BrokerCode = 'UNAVAILABLE' | 'SIGNED_OUT' | 'SESSION_EXPIRED' | 'REQUEST_INVALID'
  | 'ENVIRONMENT_MISMATCH' | 'UPSTREAM_UNAVAILABLE'

interface CommandScope {
  readonly secrets: NativeSecrets
  readonly expiresAt: number
  readonly signal: AbortSignal
  readonly pending: Set<Promise<void>>
}

const requestHeaders = ['accept', 'content-type', 'range', 'if-range', 'if-none-match', 'if-modified-since'] as const
const responseHeaders = ['content-type', 'content-disposition', 'content-range', 'accept-ranges',
  'cache-control', 'last-modified', 'retry-after', 'x-request-id'] as const

function reject(response: ServerResponse, code: BrokerCode, status: number): void {
  if (response.destroyed) return
  if (response.headersSent) { response.destroy(); return }
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify({ error: `MANTUR_BROKER_${code}`, message: `Native command broker: ${code}` }))
}

function targetPath(raw: string | undefined): string | undefined {
  if (raw === undefined || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('#')) return undefined
  const path = raw.split('?', 1)[0]
  if (path === undefined || /[\\\u0000-\u0020\u007f]|%(?:25|2f|5c)/iu.test(path)) return undefined
  let decoded: string
  try { decoded = decodeURIComponent(path) } catch { return undefined }
  if (decoded.split('/').some(part => part === '.' || part === '..') || /[\\\u0000-\u001f\u007f]/u.test(decoded)) return undefined
  if (path !== '/api/v1' && !path.startsWith('/api/v1/')) return undefined
  return raw
}

/** Runs the loopback endpoint and holds each exact grant until both its command owner and response streams stop. */
export class NativeCommandBroker {
  private readonly origin: string
  private readonly server = createServer((request, response) => { this.accept(request, response) })
  private readonly ready: Promise<string>
  private readonly shutdown = new AbortController()
  private readonly scopes = new Map<string, CommandScope>()
  private readonly commands = new Set<Promise<void>>()
  private closed: Promise<void> | undefined

  /**
   * @param account - Main-owned active-grant authority, never a renderer token supplier.
   * @param options - profile configuration, including absolute lease and complete-request budgets.
   * @param transport - native fetch, or an isolated streaming transport in tests.
   */
  constructor(private readonly account: Pick<NativeAccountController, 'withCredential'>,
    private readonly options: NativeBrokerOptions, private readonly transport: typeof fetch) {
    this.origin = nativeAccountOrigin(options)
    if (options.environmentLabel.trim() === '' || options.environmentLabel.length > 80
      || !Number.isSafeInteger(options.requestTimeoutMs) || options.requestTimeoutMs < 1 || options.requestTimeoutMs > 2_147_483_647
      || !Number.isSafeInteger(options.leaseMs) || options.leaseMs < 1) throw new Error('Native broker configuration is invalid')
    this.server.requestTimeout = options.requestTimeoutMs
    this.server.headersTimeout = options.requestTimeoutMs
    this.ready = new Promise((resolve, fail) => {
      this.server.once('error', fail)
      this.server.listen(0, '127.0.0.1', () => {
        this.server.removeListener('error', fail)
        const address = this.server.address()
        if (address === null || typeof address === 'string') throw new Error('Native broker did not bind a loopback port')
        resolve(`http://127.0.0.1:${String(address.port)}`)
      })
    })
    void this.ready.catch(() => { /* run and close return the failed listener startup to their callers. */ })
  }

  /**
   * Prepare a grant-bound command without exposing its device credential.
   * @param signal - command caller cancellation, also covering descriptor preparation.
   * @param execute - saves a private descriptor, rechecks cancellation before spawn,
   * then awaits whole-tree cleanup and descriptor removal.
   * @returns completion after the command owner and all upstream response bodies become quiescent; never a renewed lease.
   */
  run(signal: AbortSignal, execute: (descriptor: NativeBrokerDescriptor, lifetime: AbortSignal) => Promise<void>): Promise<void> {
    if (this.shutdown.signal.aborted) throw new Error('Native broker is closed')
    const admitted = this.account.withCredential(AbortSignal.any([signal, this.shutdown.signal]),
      async (secrets, lifetime, grantExpiry) => {
        const proxy = await this.ready
        lifetime.throwIfAborted()
        if (secrets.origin !== this.origin || secrets.environment !== this.options.environment) {
          throw new Error('Native broker environment mismatch')
        }
        const expiresAt = Math.min(grantExpiry, this.options.now() + this.options.leaseMs)
        const stop = new AbortController()
        const scope: CommandScope = { secrets, expiresAt, signal: AbortSignal.any([lifetime, stop.signal]), pending: new Set() }
        const capability = `mbp_v2_${randomBytes(32).toString('base64url')}`
        let timer: ReturnType<typeof setTimeout> | undefined
        const expire = (): void => {
          const remaining = expiresAt - this.options.now()
          if (remaining <= 0) { stop.abort(); return }
          timer = setTimeout(expire, Math.min(remaining, 2_147_483_647))
          timer.unref()
        }
        expire()
        this.scopes.set(capability, scope)
        try {
          scope.signal.throwIfAborted()
          await execute({ version: 2, proxy_origin: proxy, public_base_url: this.origin, bridge_secret: capability,
            environment: this.options.environment, environment_label: this.options.environmentLabel,
            expires_at: new Date(expiresAt).toISOString() }, scope.signal)
          scope.signal.throwIfAborted()
        } finally {
          this.scopes.delete(capability)
          stop.abort()
          if (timer !== undefined) clearTimeout(timer)
          await Promise.allSettled([...scope.pending])
        }
      })
    this.commands.add(admitted)
    void admitted.finally(() => { this.commands.delete(admitted) }).catch(() => {
      // The run caller owns command rejection; this continuation only releases command tracking.
    })
    return admitted
  }

  /** Reject new scopes, abort every accepted scope, and wait for command cleanup and the loopback listener to close. */
  close(): Promise<void> {
    this.shutdown.abort()
    this.closed ??= (async () => {
      await this.ready
      const stopped = new Promise<void>((resolve, fail) => {
        this.server.close((error) => { if (error === undefined) resolve(); else fail(error) })
      })
      this.server.closeAllConnections()
      await Promise.allSettled([...this.commands])
      await stopped
    })()
    return this.closed
  }

  private accept(request: IncomingMessage, response: ServerResponse): void {
    if (this.shutdown.signal.aborted) { reject(response, 'UNAVAILABLE', 503); return }
    const address = this.server.address()
    if (address === null || typeof address === 'string' || request.headers.host !== `127.0.0.1:${String(address.port)}`
      || request.headers.origin !== undefined || request.headers['x-mantur-broker-version'] !== '2') {
      reject(response, 'REQUEST_INVALID', 400); return
    }
    const token = request.headers.authorization
    const scope = token?.startsWith('Bearer ') === true ? this.scopes.get(token.slice(7)) : undefined
    if (scope === undefined) { reject(response, 'SIGNED_OUT', 401); return }
    if (scope.expiresAt <= this.options.now()) { reject(response, 'SESSION_EXPIRED', 401); return }
    if (scope.signal.aborted) { reject(response, 'SIGNED_OUT', 401); return }
    const path = targetPath(request.url)
    if (path === undefined || request.method === undefined || !['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
      reject(response, 'REQUEST_INVALID', 400); return
    }
    const pending = this.forward(request, response, path, request.method, scope).catch(() => {
      reject(response, scope.signal.aborted ? 'SIGNED_OUT' : 'UPSTREAM_UNAVAILABLE', 502)
    })
    scope.pending.add(pending)
    void pending.finally(() => { scope.pending.delete(pending) }).catch(() => {
      // A destroyed socket cannot receive a local error envelope; no upstream error text is logged.
    })
  }

  private async forward(request: IncomingMessage, response: ServerResponse, path: string,
    method: string, scope: CommandScope): Promise<void> {
    const disconnected = new AbortController()
    const abort = (): void => { disconnected.abort() }
    const closed = (): void => { if (!response.writableFinished) abort() }
    request.once('aborted', abort)
    response.once('close', closed)
    const signal = AbortSignal.any([scope.signal, disconnected.signal, AbortSignal.timeout(this.options.requestTimeoutMs)])
    try {
      signal.throwIfAborted()
      const headers = new Headers({ Authorization: `Bearer ${scope.secrets.credential}`, 'X-Mantur-Client': 'cli', 'Accept-Encoding': 'identity' })
      for (const name of requestHeaders) {
        const value = request.headers[name]
        if (typeof value === 'string') headers.set(name, value)
      }
      const options: RequestInit & { duplex?: 'half' } = { method, headers,
        signal, redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' }
      if (method !== 'GET' && method !== 'HEAD') {
        // Node fetch accepts IncomingMessage streams; the shared DOM BodyInit omits Node's streaming extension.
        options.body = request as unknown as BodyInit
        options.duplex = 'half'
      }
      const upstream = await this.transport(`${this.origin}${path}`, options)
      response.statusCode = upstream.status
      for (const name of responseHeaders) {
        const value = upstream.headers.get(name)
        if (value !== null) response.setHeader(name, value)
      }
      if (upstream.body === null) {
        response.end()
        await finished(response, { signal, cleanup: true })
      } else {
        await pipeline(Readable.fromWeb(upstream.body as NodeReadableStream<Uint8Array>), response, { signal })
      }
    } finally {
      request.removeListener('aborted', abort)
      response.removeListener('close', closed)
    }
  }
}
