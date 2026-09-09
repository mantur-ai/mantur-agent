/** Main-owned browser login, finite exchange recovery and exact device-grant cancellation. */
import { randomBytes } from 'node:crypto'
import { NativeBrowserCallback, NativeBrowserCallbackFailure } from './browser-callback.ts'
import type { NativeAccountSnapshot } from '@deepseek-ai/dsh-authorization-manturhub/types'
import { NativeAccountAccess, type NativeRevocationResult } from './access.ts'
import {
  NativeHttpClient, NativeHttpFailure, type NativeAttemptId, type NativeActiveResult,
} from './http.ts'
import { createNativeSecrets, type NativeRequestId, type NativeSecrets } from './protocol.ts'
import { NativeAccountStore, type NativeRecord } from './store.ts'

/** Fixed operation rejection; diagnostic payloads never include passwords or backend response text. */
export class NativeAccountFailure extends Error {
  constructor(readonly kind: string) { super(`Native account operation failed: ${kind}`) }
}

/** Explicit installation attributes and system-browser opener, owned by Electron Main. */
export interface NativeControllerOptions {
  readonly environment: NativeSecrets['environment']
  readonly deviceName: string
  readonly platform: NativeSecrets['platform']
  readonly now: () => number
  readonly openBrowser: (url: string) => Promise<void>
  readonly requestTimeoutMs: number
  readonly onAuthorized?: () => void
}

interface BrowserAttempt {
  readonly abort: AbortController
  readonly callback: NativeBrowserCallback
  readonly requestId: NativeRequestId
  done: Promise<void>
  timer?: ReturnType<typeof setTimeout>
}

interface ForegroundOperation {
  readonly abort: AbortController
  readonly done: Promise<void>
}

/** Owns first provisioning, response-loss recovery, activation and cancellation independently of any renderer lifetime. */
export class NativeAccountController {
  private readonly access: NativeAccountAccess
  private readonly listeners = new Set<() => void>()
  private phase: NativeAccountSnapshot['phase'] = 'idle'
  private failure: NativeAccountSnapshot['failure']
  private foreground: ForegroundOperation | undefined
  private browser: BrowserAttempt | undefined
  private cancellation: Promise<void> | undefined
  private closing = false
  private closed: Promise<void> | undefined

  /**
   * @param store - profile-local storage; this controller closes it after every accepted operation finishes.
   * @param http - frozen native-account protocol for the Host-selected origin.
   * @param options - installation attributes, absolute clock and validated-URL system-browser opener.
   */
  constructor(private readonly store: NativeAccountStore, private readonly http: NativeHttpClient,
    private readonly options: NativeControllerOptions) {
    this.access = new NativeAccountAccess(store, http, options.now)
  }

  /** Return only persisted public metadata and current operation state, never the sealed record or its plaintext. */
  getSnapshot(): NativeAccountSnapshot {
    this.requireOpen()
    const records = this.store.records(this.http.origin)
    const current = records.find(record => record.phase === 'pending' || record.phase === 'active')
    const account = current?.metadata.credential
    const attempt = current?.metadata.attempt
    const locallyBlocked = current !== undefined && this.access.isLocallyBlocked(current.requestId)
    const expired = current?.phase === 'active' && !locallyBlocked
      && account !== undefined && account.expiresAt <= this.options.now()
    const failure = expired ? { kind: 'credential-expired' } : this.failure
    return {
      phase: expired ? 'signed-out' : this.phase, busy: this.foreground !== undefined || this.cancellation !== undefined,
      authenticated: current?.phase === 'active' && !locallyBlocked && account !== undefined && !expired,
      skipped: this.store.skipped(),
      pendingRevocations: records.filter(record => record.phase === 'pending-cancel' || record.phase === 'pending-revoke').length,
      ...(account === undefined ? {} : { account: { displayName: account.displayName, expiresAt: account.expiresAt } }),
      ...(attempt === undefined || current?.phase !== 'pending' ? {} : { attempt: {
        expiresAt: attempt.expiresAt, ...(current.metadata.exchangeStarted === true ? { exchangePending: true as const } : {}),
      } }),
      ...(failure === undefined ? {} : { failure: { ...failure } }),
    }
  }

  /** Observe state changes; a failed observer cannot prevent the other observers from reading state. */
  subscribe(listener: () => void): () => void {
    this.requireOpen()
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Validate the active generation or retry an already sealed exchange before its original attempt deadline. */
  refresh(): Promise<void> {
    return this.perform(async (signal) => {
      const record = this.current()
      if (record === undefined) { this.phase = 'signed-out'; return }
      if (record.phase === 'active') {
        const metadata = record.metadata.credential
        if (metadata === undefined) throw new NativeAccountFailure('storage')
        if (metadata.expiresAt <= this.options.now()) {
          await this.access.disable(record.requestId)
          this.phase = 'signed-out'
          throw new NativeAccountFailure('credential-expired')
        }
        try {
          await this.access.withCredential(signal, async (secrets, lifetime) => {
            const session = await this.http.session(secrets, lifetime)
            if (session.grant_id !== metadata.id || session.grant_generation !== metadata.generation
              || session.credential_expires_at !== metadata.expiresAt || session.account.id !== metadata.accountId
              || session.policy_key.id !== metadata.policyKeyId) throw new NativeHttpFailure('protocol')
          })
        } catch (error) {
          if (error instanceof NativeHttpFailure && error.code !== undefined
            && ['INVALID_GRANT', 'GRANT_REVOKED', 'GRANT_EXPIRED', 'GRANT_SUPERSEDED', 'ACCOUNT_DISABLED', 'POLICY_KEY_INACTIVE'].includes(error.code)) {
            await this.access.disable(record.requestId)
          }
          throw error
        }
        this.phase = 'signed-in'
        return
      }
      if (record.metadata.exchangeStarted === true) { await this.exchange(record, signal); return }
      if (this.browser?.requestId === record.requestId) {
        if (record.metadata.attempt === undefined) throw new NativeAccountFailure('resume-required')
        this.phase = 'authorizing'
        return
      }
      await this.access.disable(record.requestId)
      await this.access.retryRevocations()
      throw new NativeAccountFailure('resume-required')
    })
  }

  /** Open a new browser attempt, or retry the same create request while its owned listener is still alive. */
  startBrowser(): Promise<void> {
    return this.perform(async (signal) => {
      let record = this.current()
      if (record?.phase === 'active') throw new NativeAccountFailure('already-signed-in')
      if (record !== undefined && (this.browser?.requestId !== record.requestId || record.metadata.exchangeStarted)) {
        throw new NativeAccountFailure('resume-required')
      }
      if (record === undefined) {
        const state = randomBytes(32).toString('base64url')
        const abort = new AbortController()
        const callback = await NativeBrowserCallback.open({ state, issuer: this.http.origin,
          signal: abort.signal, requestTimeoutMs: this.options.requestTimeoutMs })
        try {
          signal.throwIfAborted()
          const secrets = createNativeSecrets({ deviceInstanceId: this.store.deviceInstanceId, origin: this.http.origin,
            environment: this.options.environment, deviceName: this.options.deviceName, platform: this.options.platform,
            state, redirectUri: callback.redirectUri })
          await this.sealPending(secrets, signal)
          record = this.current()
          if (record === undefined) throw new NativeAccountFailure('storage')
          const browser: BrowserAttempt = { abort, callback, requestId: record.requestId, done: Promise.resolve() }
          this.browser = browser
          browser.done = this.receiveCallback(browser).catch(() => {
            if (!this.closing && !browser.abort.signal.aborted) {
              this.phase = 'failed'
              this.failure = { kind: 'local' }
              this.notify()
            }
          })
        } catch (error) {
          abort.abort()
          await callback.close()
          throw error
        }
      }
      const secrets = await this.store.secrets(record.requestId, 'authorize')
      const receipt = await this.http.create(secrets, signal)
      const attempt = { id: receipt.attempt_id, expiresAt: receipt.attempt_expires_at }
      const previous = record.metadata.attempt
      if (previous !== undefined && (previous.id !== attempt.id || previous.expiresAt !== attempt.expiresAt)) {
        throw new NativeHttpFailure('protocol')
      }
      this.store.saveMetadata(record.requestId, { ...record.metadata, attempt })
      const browser = this.browser
      if (browser === undefined) throw new NativeAccountFailure('resume-required')
      if (attempt.expiresAt <= this.options.now()) throw new NativeAccountFailure('expired')
      if (browser.timer === undefined) {
        browser.timer = setTimeout(() => { void this.expireBrowser(browser) }, attempt.expiresAt - this.options.now())
        browser.timer.unref()
      }
      await this.openBrowser(receipt.authorization_uri, signal)
    })
  }

  /** Reopen only the same live authorization; the renderer never receives its state-bearing URL. */
  reopenBrowser(): Promise<void> {
    return this.perform(async (signal) => {
      const record = this.current()
      const attempt = record?.metadata.attempt
      if (record?.phase !== 'pending' || attempt === undefined || record.metadata.exchangeStarted
        || this.browser?.requestId !== record.requestId) throw new NativeAccountFailure('resume-required')
      if (attempt.expiresAt <= this.options.now()) throw new NativeAccountFailure('expired')
      const secrets = await this.store.secrets(record.requestId, 'authorize')
      const url = new URL('/auth/client', this.http.origin)
      url.search = new URLSearchParams({ attempt_id: attempt.id, state: secrets.state, iss: this.http.origin }).toString()
      await this.openBrowser(url.href, signal)
    })
  }

  /** Persist Skip and cancel provisioning; pending first-write encryption does not delay Skip or commit after cancellation. */
  skip(): Promise<void> {
    this.requireOpen()
    this.store.setSkipped(true)
    return this.signOut()
  }

  /** Cancel provisioning or stop the current grant locally, then attempt exact remote revocation. */
  signOut(): Promise<void> {
    this.requireOpen()
    if (this.cancellation !== undefined) return this.cancellation
    const foreground = this.foreground
    foreground?.abort.abort()
    const browser = this.browser
    const record = this.current()
    let disabled: Promise<void>
    try { disabled = record === undefined ? Promise.resolve() : this.access.disable(record.requestId) }
    catch {
      this.phase = 'failed'
      this.failure = { kind: 'logout-storage' }
      this.notify()
      throw new NativeAccountFailure('logout-storage')
    }
    browser?.abort.abort()
    this.phase = 'signed-out'
    this.failure = undefined
    const operation = (async () => {
      try {
        await Promise.all([disabled, foreground?.done, browser?.done])
        await this.access.retryRevocations()
      } finally {
        this.cancellation = undefined
        this.notify()
      }
    })()
    this.cancellation = operation
    this.notify()
    return operation
  }

  /** Disable the old local identity before opening an explicit browser authorization for another account. */
  async switchAccount(): Promise<void> {
    await this.signOut()
    await this.startBrowser()
  }

  /** Retry retained remote cleanup without reviving an account or replacing a newer login. */
  async retryRevocations(): Promise<NativeRevocationResult> {
    this.requireOpen()
    try { return await this.access.retryRevocations() }
    finally { this.notify() }
  }

  /** Run a Host-only credentialed operation through complete response-body cleanup. */
  withCredential(signal: AbortSignal,
    consume: (secrets: NativeSecrets, lifetime: AbortSignal, expiresAt: number) => Promise<void>): Promise<void> {
    this.requireOpen()
    return this.access.withCredential(signal, consume)
  }

  /** Stop observers, cancel accepted work, then close SQLite after every network, body and OS operation settles. */
  close(): Promise<void> {
    this.closing = true
    this.listeners.clear()
    this.foreground?.abort.abort()
    this.browser?.abort.abort()
    this.closed ??= Promise.allSettled([
      this.access.close(),
      ...(this.browser === undefined ? [] : [this.browser.done]),
      ...(this.foreground === undefined ? [] : [this.foreground.done]),
      ...(this.cancellation === undefined ? [] : [this.cancellation]),
    ]).then(() => this.store.close())
    return this.closed
  }

  private async openBrowser(url: string, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    try { await this.options.openBrowser(url) }
    catch { throw new NativeAccountFailure('browser') }
    signal.throwIfAborted()
    this.phase = 'authorizing'
  }

  private async sealPending(secrets: NativeSecrets, signal: AbortSignal): Promise<void> {
    const cancelled = Promise.withResolvers<never>()
    const abort = (): void => { cancelled.reject(signal.reason) }
    signal.addEventListener('abort', abort, { once: true })
    try {
      signal.throwIfAborted()
      // Storage retains the OS operation for shutdown; the commit check rejects its late result.
      await Promise.race([this.store.savePending(secrets, () => { signal.throwIfAborted() }), cancelled.promise])
    } finally {
      signal.removeEventListener('abort', abort)
    }
  }

  private async receiveCallback(browser: BrowserAttempt): Promise<void> {
    try {
      const code = await browser.callback.code
      while (this.foreground !== undefined) await this.foreground.done
      browser.abort.signal.throwIfAborted()
      await this.perform(async (signal) => {
        const lifetime = AbortSignal.any([signal, browser.abort.signal])
        const record = this.current()
        if (record?.requestId !== browser.requestId || record.phase !== 'pending') throw new NativeAccountFailure('cancelled')
        if (record.metadata.attempt === undefined || record.metadata.attempt.expiresAt <= this.options.now()) {
          throw new NativeAccountFailure('expired')
        }
        await this.store.saveExchange(record.requestId, code, () => { lifetime.throwIfAborted() })
        const saved = this.current()
        if (saved === undefined) throw new NativeAccountFailure('storage')
        await this.exchange(saved, lifetime)
      })
    } catch (error) {
      if (!browser.abort.signal.aborted && !this.closing) {
        if (error instanceof NativeBrowserCallbackFailure) {
          await this.access.disable(browser.requestId)
          this.phase = 'failed'
          this.failure = { kind: error.kind }
        }
        this.notify()
      }
    } finally {
      if (browser.timer !== undefined) clearTimeout(browser.timer)
      await browser.callback.close()
      if (this.browser === browser) this.browser = undefined
    }
  }

  private async expireBrowser(browser: BrowserAttempt): Promise<void> {
    if (this.browser !== browser || this.closing) return
    try {
      await this.access.disable(browser.requestId)
      browser.abort.abort()
      this.phase = 'failed'
      this.failure = { kind: 'expired' }
      this.notify()
    } catch {
      browser.abort.abort()
      this.phase = 'failed'
      this.failure = { kind: 'logout-storage' }
      this.notify()
    }
  }

  private async exchange(record: NativeRecord, signal: AbortSignal): Promise<void> {
    const attempt = record.metadata.attempt
    if (attempt === undefined || !record.metadata.exchangeStarted) throw new NativeAccountFailure('storage')
    if (attempt.expiresAt <= this.options.now()) {
      await this.access.disable(record.requestId)
      throw new NativeAccountFailure('expired')
    }
    const secrets = await this.store.secrets(record.requestId, 'authorize')
    signal.throwIfAborted()
    let active: NativeActiveResult
    try { active = await this.http.exchange(secrets, attempt.id as NativeAttemptId, signal) }
    catch (error) {
      if (error instanceof NativeHttpFailure && error.code !== undefined
        && ['GRANT_SUPERSEDED', 'GRANT_REVOKED', 'GRANT_EXPIRED', 'INVALID_GRANT', 'CODE_EXPIRED',
          'CODE_ALREADY_USED', 'ATTEMPT_EXPIRED', 'ATTEMPT_CANCELLED', 'ATTEMPT_DENIED',
          'ACCOUNT_DISABLED', 'POLICY_KEY_INACTIVE'].includes(error.code)) await this.access.disable(record.requestId)
      throw error
    }
    if (attempt.expiresAt <= this.options.now()) throw new NativeAccountFailure('expired')
    if (active.credential_expires_at <= this.options.now()) throw new NativeHttpFailure('protocol')
    signal.throwIfAborted()
    this.store.activate(record.requestId, { attempt, credential: { id: active.grant_id,
      generation: active.grant_generation, accountId: active.account.id, displayName: active.account.display_name,
      policyKeyId: active.policy_key.id, expiresAt: active.credential_expires_at } })
    this.phase = 'signed-in'
    try { this.options.onAuthorized?.() }
    catch { console.warn('Native account window activation failed') }
  }

  private current(): NativeRecord | undefined {
    return this.store.records(this.http.origin).find(record => record.phase === 'pending' || record.phase === 'active')
  }

  private async perform<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.requireOpen()
    if (this.foreground !== undefined || this.cancellation !== undefined) throw new NativeAccountFailure('busy')
    const done = Promise.withResolvers<void>()
    const operation = { abort: new AbortController(), done: done.promise }
    this.foreground = operation
    this.failure = undefined
    this.notify()
    try { return await run(operation.abort.signal) }
    catch (error) {
      if (!operation.abort.signal.aborted && !this.closing) {
        this.phase = 'failed'
        this.failure = error instanceof NativeHttpFailure ? { kind: error.kind,
          ...(error.code === undefined ? {} : { code: error.code }),
          ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }) }
          : { kind: error instanceof NativeAccountFailure ? error.kind : 'local' }
      }
      throw new NativeAccountFailure(operation.abort.signal.aborted ? 'cancelled' : this.failure?.kind ?? 'local')
    } finally {
      this.foreground = undefined
      done.resolve()
      this.notify()
    }
  }

  private notify(): void {
    if (this.closing) return
    for (const listener of this.listeners) {
      try { listener() }
      catch { console.warn('Native account state listener failed') }
    }
  }

  private requireOpen(): void {
    if (this.closing) throw new NativeAccountFailure('closing')
  }
}
