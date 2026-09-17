/** Main-owned LOOPBACK/PKCE login and encrypted account credentials for the current gateway. */
import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import type { NativeAccountSnapshot } from '@deepseek-ai/dsh-authorization-manturhub/types'
import { NativeBrowserCallback } from './browser-callback.ts'
import { NativeAccountFailure, type NativeControllerOptions, type NativeAccountController } from './controller.ts'
import { nativeAccountOrigin, type NativeHttpOptions } from './http.ts'
import { ClientSessionStore, type ClientSession } from './client-session-store.ts'

const tokenSchema = z.object({ accessToken: z.string().min(1), refreshToken: z.string().min(1),
  expiresIn: z.number().int().positive().max(2147483), userId: z.string().min(1),
  nickname: z.string().optional(), username: z.string().optional() })
class SessionFailure extends Error {
  constructor(readonly code: number) { super('Client session request failed') }
}
/** Public controller face shared with the renderer bridge; secrets never enter its snapshots. */
export type AccountController = Pick<NativeAccountController, 'getSnapshot' | 'subscribe' | 'refresh' | 'startBrowser'
  | 'reopenBrowser' | 'skip' | 'signOut' | 'switchAccount' | 'retryRevocations' | 'close'>

interface ClientLogin { abort: AbortController; callback: NativeBrowserCallback; url?: string; expiresAt?: number; done?: Promise<void> }

/** One profile and origin own the account, refresh rotation and every authorized command lifetime. */
export class ClientSessionController {
  private account: ClientSession | undefined
  private readonly ready: Promise<void>
  private readonly listeners = new Set<() => void>()
  private readonly shutdown = new AbortController()
  private readonly work = new Set<Promise<unknown>>()
  private readonly scopes = new Set<{ abort: AbortController; done: Promise<void> }>()
  private refreshing: Promise<void> | undefined
  private creatingKey: Promise<void> | undefined
  private login: ClientLogin | undefined
  private phase: NativeAccountSnapshot['phase'] = 'idle'
  private failure: NativeAccountSnapshot['failure']
  private skipped = false
  private signingOut: Promise<void> | undefined
  private closed: Promise<void> | undefined
  readonly origin: string
  /**
   * @param store - OS-encrypted profile storage.
   * @param config - explicit deployment and network budgets.
   * @param options - Main browser and installation settings.
   * @param transport - fetch implementation.
   */
  constructor(private readonly store: ClientSessionStore, private readonly config: NativeHttpOptions,
    private readonly options: NativeControllerOptions, private readonly transport: typeof fetch = fetch) {
    this.origin = nativeAccountOrigin(config)
    this.ready = Promise.all([store.read(), store.readSkipped()]).then(([account, skipped]) => {
      this.skipped = skipped
      this.account = account
      this.phase = account ? 'signed-in' : 'signed-out'
      this.notify()
    })
    void this.ready.catch(() => { this.phase = 'failed'; this.failure = { kind: 'storage' }; this.notify() })
  }
  /** @returns account display metadata, excluding credentials and authorization URLs. */
  getSnapshot(): NativeAccountSnapshot {
    return { phase: this.phase, busy: this.login !== undefined || this.signingOut !== undefined,
      authenticated: this.account !== undefined && this.signingOut === undefined && !this.shutdown.signal.aborted,
      skipped: this.skipped, pendingRevocations: 0,
      ...(this.account ? { account: { displayName: this.account.displayName, expiresAt: this.account.expiresAt } } : {}),
      ...(this.login?.expiresAt ? { attempt: { expiresAt: this.login.expiresAt } } : {}),
      ...(this.failure ? { failure: this.failure } : {}) }
  }
  /** @param listener - state observer. @returns its disposer. */
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  /** Validate the account online, rotating expiring access tokens before use. */
  async refresh(): Promise<void> {
    await this.ready
    if (!this.account) return
    await this.ensureToken()
    try { await this.request('/api/auth/front-token-validate', 'GET', undefined, this.shutdown.signal, { Authorization: this.account.accessToken }) }
    catch (error) {
      if (!(error instanceof SessionFailure) || error.code !== 401) throw error
      await this.rotate()
      await this.request('/api/auth/front-token-validate', 'GET', undefined, this.shutdown.signal, { Authorization: this.account.accessToken })
    }
    this.notify()
  }
  /** Open the system browser with a same-origin authorization URL after binding the loopback listener. */
  async startBrowser(): Promise<void> {
    await this.ready
    this.shutdown.signal.throwIfAborted()
    if (this.login || this.signingOut || this.account) throw new NativeAccountFailure('busy')
    const abort = new AbortController()
    const signal = AbortSignal.any([abort.signal, this.shutdown.signal])
    const state = randomBytes(32).toString('base64url')
    const verifier = randomBytes(32).toString('base64url')
    const callback = await NativeBrowserCallback.open({ protocol: 'client-session', state, issuer: this.origin,
      signal, requestTimeoutMs: this.options.requestTimeoutMs })
    const login: ClientLogin = { abort, callback }
    this.login = login
    this.failure = undefined
    this.phase = 'authorizing'
    this.notify()
    const operation = (async () => {
      try {
        const result = z.object({ flow: z.literal('LOOPBACK'), sessionId: z.string().min(1), authorizeUrl: z.url(),
          expiresIn: z.number().int().positive().max(600) }).parse(await this.request('/api/auth/client/sessions', 'POST', {
          flow: 'LOOPBACK', clientType: 'desktop', clientName: 'Mantur Agent',
          codeChallenge: createHash('sha256').update(verifier).digest('base64url'), codeChallengeMethod: 'S256',
          redirectUri: callback.redirectUri, state,
        }, signal))
        const url = new URL(result.authorizeUrl)
        if (url.origin !== this.origin || url.pathname !== '/auth/client-authorize' || url.username || url.password || url.hash
          || url.searchParams.get('session') !== result.sessionId) throw new NativeAccountFailure('protocol')
        login.url = url.href
        login.expiresAt = this.options.now() + result.expiresIn * 1000
        signal.throwIfAborted()
        await this.options.openBrowser(url.href)
        this.notify()
        const timer = setTimeout(() => { abort.abort() }, result.expiresIn * 1000)
        timer.unref()
        try {
          const code = await callback.code
          await callback.close()
          const result = await this.request('/api/auth/client/token', 'POST', { grantType: 'authorization_code', code,
            codeVerifier: verifier, redirectUri: callback.redirectUri }, signal)
          const account = this.tokens(result)
          await this.store.save(account, signal)
          signal.throwIfAborted()
          this.account = account
          this.phase = 'signed-in'
          try { this.options.onAuthorized?.() } catch { console.warn('Account window activation failed') }
        } finally { clearTimeout(timer) }
      } catch {
        if (!signal.aborted) { this.phase = 'failed'; this.failure = { kind: 'protocol' } }
        else if (!this.signingOut) { this.phase = 'signed-out'; this.failure = { kind: 'expired' } }
      } finally {
        await callback.close()
        if (this.login === login) this.login = undefined
        this.notify()
      }
    })()
    login.done = this.track(operation)
    // Browser completion stays owned by Main rather than holding a renderer IPC request open.
  }
  /** Reopen the current authorization without creating another server session. */
  async reopenBrowser(): Promise<void> {
    if (!this.login?.url || !this.login.expiresAt || this.login.expiresAt <= this.options.now()) throw new NativeAccountFailure('resume-required')
    await this.options.openBrowser(this.login.url)
  }
  /** Skip account onboarding and stop any accepted authorization. */
  async skip(): Promise<void> { await this.store.skip(); this.skipped = true; await this.signOut() }
  /** Locally disable commands before remote logout; local credentials are cleared even while offline. */
  signOut(): Promise<void> {
    if (this.signingOut) return this.signingOut
    this.login?.abort.abort()
    for (const scope of this.scopes) scope.abort.abort()
    const run = (async () => {
      await this.ready
      await Promise.allSettled([...this.work, ...[...this.scopes].map(s => s.done)])
      const account = this.account
      this.account = undefined
      await this.store.save(undefined)
      this.phase = 'signed-out'
      if (account) {
        try {
          if (account.key) await this.request('/api/agent/v1/api-keys/' + encodeURIComponent(account.key.id), 'DELETE', undefined,
            new AbortController().signal, { Authorization: account.accessToken })
        } catch { this.failure = { kind: 'remote' } }
        try { await this.request('/api/auth/front-logout', 'DELETE', undefined, new AbortController().signal, { Authorization: account.accessToken }) }
        catch { /* Documented logout clears local credentials regardless of remote availability. */ }
      }
    })()
    this.signingOut = run.catch(() => { this.phase = 'failed'; this.failure = { kind: 'logout-storage' }; throw new NativeAccountFailure('logout-storage') }).finally(() => { this.signingOut = undefined; this.notify() })
    this.notify()
    return this.signingOut
  }
  /** End the old account before beginning another browser authorization. */
  async switchAccount(): Promise<void> { await this.signOut(); await this.startBrowser() }
  /** The client-session protocol does not expose device-grant cleanup queues. */
  async retryRevocations(): Promise<{ revoked: number; expired: number; failures: never[] }> {
    await this.ready
    return { revoked: 0, expired: 0, failures: [] }
  }
  /** @param signal - command cancellation. @param consume - Main broker operation; never expose the key to children. */
  async withCredential(signal: AbortSignal, consume: (secrets: { credential: string; origin: string; environment: 'production' | 'test' }, lifetime: AbortSignal, expiresAt: number) => Promise<void>): Promise<void> {
    await this.ready
    if (this.signingOut || !this.account) throw new NativeAccountFailure('signed-out')
    await this.ensureToken()
    await this.ensureKey()
    const current = this.currentAccount()
    if (this.isSigningOut() || !current?.key) throw new NativeAccountFailure('signed-out')
    const abort = new AbortController()
    const lifetime = AbortSignal.any([signal, abort.signal, this.shutdown.signal])
    lifetime.throwIfAborted()
    const key = current.key
    const done = Promise.resolve().then(() => consume({ credential: key.secret, origin: this.origin, environment: this.config.environment },
      lifetime, key.expiresAt))
    const scope = { abort, done }
    this.scopes.add(scope)
    try { await done } finally { this.scopes.delete(scope) }
  }
  /** Stop scopes and await response streams and encrypted writes before returning. */
  close(): Promise<void> {
    this.shutdown.abort()
    this.login?.abort.abort()
    this.listeners.clear()
    this.closed ??= (async () => {
      await Promise.allSettled([this.ready, ...this.work, ...[...this.scopes].map(s => s.done),
        ...(this.signingOut ? [this.signingOut] : [])])
      await this.store.close()
    })()
    return this.closed
  }
  private currentAccount(): ClientSession | undefined { return this.account }
  private isSigningOut(): boolean { return this.signingOut !== undefined }
  private tokens(value: unknown): ClientSession {
    const result = tokenSchema.parse(value)
    return { origin: this.origin, userId: result.userId, displayName: result.nickname || result.username || result.userId,
      accessToken: result.accessToken, refreshToken: result.refreshToken, expiresAt: this.options.now() + result.expiresIn * 1000 }
  }
  private async ensureToken(): Promise<void> {
    if (!this.account) throw new NativeAccountFailure('signed-out')
    if (this.account.expiresAt - this.options.now() < 65 * 60000) await this.rotate()
  }
  private rotate(): Promise<void> {
    if (this.refreshing) return this.refreshing
    const previous = this.account
    if (!previous) throw new NativeAccountFailure('signed-out')
    this.refreshing = this.track((async () => {
      try {
        const result = await this.request('/api/auth/client/refresh', 'POST', undefined, this.shutdown.signal,
          { 'X-Refresh-Token': previous.refreshToken })
        const account = this.tokens(result)
        if (account.userId !== previous.userId) throw new NativeAccountFailure('protocol')
        const current = this.currentAccount()
        if (!current || current.userId !== previous.userId) throw new NativeAccountFailure('signed-out')
        if (current.key) account.key = current.key
        if (current.keyPending) account.keyPending = true
        await this.store.save(account, this.shutdown.signal)
        this.account = account
      } catch (error) {
        if (error instanceof SessionFailure && [401, 403, 1003810, 1003403].includes(error.code)) {
          this.account = undefined
          await this.store.save(undefined)
          this.phase = 'signed-out'
          this.notify()
        }
        throw error
      }
    })()).finally(() => { this.refreshing = undefined })
    return this.refreshing
  }
  private ensureKey(): Promise<void> {
    if (this.creatingKey) return this.creatingKey
    this.creatingKey = this.track((async () => {
      const account = this.account
      if (!account) throw new NativeAccountFailure('signed-out')
      if (account.key) {
        if (account.key.expiresAt <= this.options.now()) throw new NativeAccountFailure('credential-expired')
        return
      }
      if (account.keyPending) throw new NativeAccountFailure('key-creation-uncertain')
      const pending = { ...account, keyPending: true }
      await this.store.save(pending, this.shutdown.signal)
      this.account = pending
      const result = z.object({ id: z.string().min(1), plainSecret: z.string().min(1), expiresAt: z.string().min(1) })
        .parse(await this.request('/api/agent/v1/api-keys', 'POST', { name: 'Mantur Agent',
          scopes: ['operator.read', 'operator.invoke'], validityDays: 90 }, this.shutdown.signal, { Authorization: account.accessToken }))
      const current = this.currentAccount()
      if (!current || current.userId !== account.userId) throw new NativeAccountFailure('signed-out')
      if (!Number.isFinite(Date.parse(result.expiresAt)) || Date.parse(result.expiresAt) <= this.options.now()) {
        throw new NativeAccountFailure('protocol')
      }
      const saved = { ...current, keyPending: false,
        key: { id: result.id, secret: result.plainSecret, expiresAt: Date.parse(result.expiresAt) } }
      await this.store.save(saved, this.shutdown.signal)
      this.account = saved
    })()).finally(() => { this.creatingKey = undefined })
    return this.creatingKey
  }
  private request(path: string, method: string, body: object | undefined, signal: AbortSignal,
    headers: Record<string, string> = {}): Promise<unknown> {
    return this.track(this.fetchRequest(path, method, body, signal, headers))
  }
  private async fetchRequest(path: string, method: string, body: object | undefined, signal: AbortSignal,
    headers: Record<string, string>): Promise<unknown> {
    const lifetime = AbortSignal.any([signal, AbortSignal.timeout(this.config.timeoutMs)])
    const response = await this.transport(this.origin + path, { method, redirect: 'error', signal: lifetime,
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}) })
    const reader = response.body?.getReader()
    if (!reader) throw new NativeAccountFailure('protocol')
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      for (;;) {
        const chunk = await reader.read()
        if (chunk.done) break
        size += chunk.value.byteLength
        if (size > this.config.maxResponseBytes) { await reader.cancel(); throw new NativeAccountFailure('protocol') }
        chunks.push(chunk.value)
      }
    } finally { reader.releaseLock() }
    let value: unknown
    try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown } catch { throw new NativeAccountFailure('protocol') }
    const result = z.object({ code: z.number(), data: z.unknown().optional() }).safeParse(value)
    if (!response.ok || !result.success || result.data.code !== 0) {
      throw new SessionFailure(result.success ? result.data.code : response.status)
    }
    return result.data.data
  }
  private track<T>(promise: Promise<T>): Promise<T> {
    this.work.add(promise)
    void promise.finally(() => this.work.delete(promise)).catch(() => {})
    return promise
  }
  private notify(): void {
    if (this.shutdown.signal.aborted) return
    for (const listener of this.listeners) { try { listener() } catch { console.warn('Account observer failed') } }
  }
}
