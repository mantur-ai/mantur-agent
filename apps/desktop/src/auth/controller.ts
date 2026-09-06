/** Profile-local native login orchestration; passwords are transient, and only confirmed activation enables requests. */
import { assertNever } from '@deepseek-ai/dsh-util-values'
import { NativeAccountAccess, type NativeRevocationResult } from './access.ts'
import {
  NativeHttpClient, NativeHttpFailure, type NativeAttemptId, type NativePollResult,
} from './http.ts'
import { createNativeSecrets, type NativeActiveMetadata, type NativeMetadata, type NativeSecrets } from './protocol.ts'
import { NativeAccountStore, type NativeRecord } from './store.ts'

/** Non-secret account state suitable for a guarded Main-to-renderer message. */
export interface NativeAccountSnapshot {
  readonly phase: 'idle' | 'signed-out' | 'authorizing' | 'signed-in' | 'pending-activation' | 'link-required' | 'failed'
  readonly busy: boolean
  /** A locally active, unexpired grant; a recoverable offline check failure does not change this fact. */
  readonly authenticated: boolean
  readonly skipped: boolean
  readonly pendingRevocations: number
  readonly account?: { readonly email: string; readonly expiresAt: number }
  readonly attempt?: { readonly userCode: string; readonly verificationUrl: string; readonly expiresAt: number }
  readonly failure?: { readonly kind: string; readonly code?: string; readonly retryAfterMs?: number }
}

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
    return {
      phase: this.phase, busy: this.foreground !== undefined || this.cancellation !== undefined,
      authenticated: current?.phase === 'active' && !this.access.isLocallyBlocked(current.requestId)
        && account !== undefined && account.expiresAt > this.options.now(),
      skipped: this.store.skipped(),
      pendingRevocations: records.filter(record => record.phase === 'pending-cancel' || record.phase === 'pending-revoke').length,
      ...(account === undefined ? {} : { account: { email: account.email, expiresAt: account.expiresAt } }),
      ...(attempt === undefined || current?.phase !== 'pending' ? {} : { attempt: {
        userCode: attempt.userCode, verificationUrl: attempt.verificationUrl, expiresAt: attempt.expiresAt,
      } }),
      ...(this.failure === undefined ? {} : { failure: { ...this.failure } }),
    }
  }

  /** Observe state changes; a failed observer cannot prevent the other observers from reading state. */
  subscribe(listener: () => void): () => void {
    this.requireOpen()
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Recover the saved attempt or validate the saved device online; an offline failure is not an expiry. */
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
          throw new NativeAccountFailure('expired')
        }
        try {
          await this.access.withCredential(signal, async (secrets, lifetime) => {
            const session = await this.http.session(secrets, lifetime)
            if (session.credential_id !== metadata.id || session.expires_at !== metadata.expiresAt) throw new NativeHttpFailure('protocol')
          })
        } catch (error) {
          if (error instanceof NativeHttpFailure && error.code !== undefined
            && ['CREDENTIAL_INVALID', 'CREDENTIAL_REVOKED', 'CREDENTIAL_EXPIRED', 'ACCOUNT_DISABLED'].includes(error.code)) {
            await this.access.disable(record.requestId)
          }
          throw error
        }
        this.phase = 'signed-in'
        return
      }
      const saved = await this.pending(signal)
      if (saved.metadata.credential !== undefined) {
        await this.activate(saved.record, saved.secrets,
          { attempt: saved.metadata.attempt, credential: saved.metadata.credential }, signal)
      } else {
        const progress = await this.http.poll(saved.secrets, saved.metadata.attempt.id, signal)
        await this.progress(saved.record, saved.secrets, saved.metadata.attempt, progress, signal)
      }
    })
  }

  /** Open the allowlisted same-deployment authorization page in the OS browser; browser OAuth never enters the renderer. */
  startBrowser(): Promise<void> {
    return this.perform(async (signal) => {
      const saved = await this.pending(signal)
      if (saved.metadata.credential !== undefined) throw new NativeAccountFailure('resume-required')
      signal.throwIfAborted()
      await this.options.openBrowser(saved.metadata.attempt.verificationUrl)
      signal.throwIfAborted()
      this.phase = 'authorizing'
    })
  }

  /** Submit explicit password consent once, persist ready metadata, then activate the exact pre-sealed grant. */
  password(credentials: { email: string; password: string; consent: true }): Promise<void> {
    return this.perform(async (signal) => {
      const saved = await this.pending(signal)
      if (saved.metadata.credential !== undefined) throw new NativeAccountFailure('resume-required')
      const ready = await this.http.password(saved.secrets, saved.metadata.attempt.id, credentials, signal)
      const metadata = { attempt: saved.metadata.attempt,
        credential: { id: ready.credential_id, email: ready.account.email, expiresAt: ready.expires_at } }
      this.store.saveMetadata(saved.record.requestId, metadata)
      await this.activate(saved.record, saved.secrets, metadata, signal)
    })
  }

  /** Poll on the caller's explicit two-second schedule; no passwords, registrations or unknown network outcomes are retried here. */
  poll(): Promise<void> { return this.refresh() }

  /** Persist Skip before cancelling local provisioning; model credentials, projects and drafts remain untouched. */
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
    const record = this.current()
    let disabled: Promise<void>
    try { disabled = record === undefined ? Promise.resolve() : this.access.disable(record.requestId) }
    catch {
      this.phase = 'failed'
      this.failure = { kind: 'logout-storage' }
      this.notify()
      throw new NativeAccountFailure('logout-storage')
    }
    this.phase = 'signed-out'
    this.failure = undefined
    const operation = (async () => {
      try {
        await Promise.all([disabled, foreground?.done])
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

  /** Retry retained remote cleanup without reviving an account or replacing a newer login. */
  async retryRevocations(): Promise<NativeRevocationResult> {
    this.requireOpen()
    try { return await this.access.retryRevocations() }
    finally { this.notify() }
  }

  /** Request a registration code without creating an authorization attempt or persisting form values. */
  sendCode(email: string): Promise<{ ok: true; expiresInSec: number }> {
    return this.perform(signal => this.http.sendCode(email, signal))
  }

  /** Register a pending account; activation and login remain separate explicit operations. */
  async register(input: { email: string; password: string; code: string; invite_code?: string }): Promise<void> {
    await this.perform(async (signal) => {
      await this.http.register(input, signal)
      this.phase = 'pending-activation'
    })
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
    this.closed ??= Promise.allSettled([
      this.access.close(),
      ...(this.foreground === undefined ? [] : [this.foreground.done]),
      ...(this.cancellation === undefined ? [] : [this.cancellation]),
    ]).then(() => this.store.close())
    return this.closed
  }

  private async pending(signal: AbortSignal) {
    let record = this.current()
    if (record?.phase === 'active') throw new NativeAccountFailure('already-signed-in')
    if (record === undefined) {
      const secrets = createNativeSecrets({ deviceInstanceId: this.store.deviceInstanceId, origin: this.http.origin,
        environment: this.options.environment, deviceName: this.options.deviceName, platform: this.options.platform })
      await this.store.savePending(secrets, () => { signal.throwIfAborted() })
      record = this.current()
      if (record === undefined) throw new NativeAccountFailure('storage')
    }
    const secrets = await this.store.secrets(record.requestId, 'authorize')
    signal.throwIfAborted()
    const receipt = await this.http.create(secrets, signal)
    const attempt = { id: receipt.attempt_id, userCode: receipt.user_code,
      verificationUrl: receipt.verification_uri_complete, expiresAt: receipt.attempt_expires_at }
    const previous = record.metadata.attempt
    if (previous !== undefined && (previous.id !== attempt.id || previous.expiresAt !== attempt.expiresAt
      || previous.userCode !== attempt.userCode || previous.verificationUrl !== attempt.verificationUrl)) {
      throw new NativeHttpFailure('protocol')
    }
    const metadata = { ...record.metadata, attempt }
    this.store.saveMetadata(record.requestId, metadata)
    this.phase = 'authorizing'
    return { record, secrets, metadata }
  }

  private async progress(record: NativeRecord, secrets: NativeSecrets, attempt: NonNullable<NativeMetadata['attempt']>,
    progress: NativePollResult, signal: AbortSignal): Promise<void> {
    switch (progress.status) {
      case 'pending': this.phase = 'authorizing'; return
      case 'pending_activation': this.phase = 'pending-activation'; return
      case 'link_required': this.phase = 'link-required'; return
      case 'ready': case 'active': {
        const metadata = { attempt, credential: { id: progress.credential_id,
          email: progress.account.email, expiresAt: progress.credential_expires_at } }
        this.store.saveMetadata(record.requestId, metadata)
        await this.activate(record, secrets, metadata, signal)
        return
      }
      case 'denied': case 'cancelled':
        await this.access.disable(record.requestId)
        this.phase = 'signed-out'
        throw new NativeAccountFailure(progress.reason)
      default: return assertNever(progress)
    }
  }

  private async activate(record: NativeRecord, secrets: NativeSecrets, metadata: NativeActiveMetadata, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    const active = await this.http.activate(secrets, metadata.attempt.id as NativeAttemptId, signal)
    if (active.credential_id !== metadata.credential.id || active.expires_at !== metadata.credential.expiresAt
      || active.expires_at <= this.options.now()) throw new NativeHttpFailure('protocol')
    signal.throwIfAborted()
    this.store.activate(record.requestId, metadata)
    this.phase = 'signed-in'
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
