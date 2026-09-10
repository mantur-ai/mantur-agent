/** Main-owned account request lifetimes and exact-grant revocation; no renderer or CLI bearer projection. */
import { NativeHttpClient, NativeHttpFailure, type NativeAttemptId } from './http.ts'
import type { NativeRequestId, NativeSecrets } from './protocol.ts'
import { NativeAccountStore, type NativeRecord } from './store.ts'

interface ActiveRequest {
  readonly id: NativeRequestId
  readonly abort: AbortController
  readonly done: Promise<void>
}

/** Remote cleanup reports retained failures independently from confirmed revocations and original expiries. */
export interface NativeRevocationResult {
  readonly revoked: number
  readonly expired: number
  readonly failures: ReadonlyArray<{ requestId: NativeRequestId; kind: 'network' | 'cancelled' | 'protocol' | 'remote' | 'storage' }>
}

/** Keeps a request owned until its caller finishes consuming the response or stopping its process scope. */
export class NativeAccountAccess {
  private readonly requests = new Set<ActiveRequest>()
  private readonly blocked = new Set<NativeRequestId>()
  private readonly shutdown = new AbortController()
  private sweep: Promise<NativeRevocationResult> | undefined
  private closing = false
  private closed: Promise<void> | undefined

  /**
   * @param store - profile-local OS-sealed records; the composition closes it after all account owners stop.
   * @param http - the exact profile deployment, also used for queued revocation.
   * @param now - wall clock used against the original server expiry, never a renewed lease.
   */
  constructor(private readonly store: NativeAccountStore, private readonly http: NativeHttpClient,
    private readonly now: () => number) {}

  /**
   * Read immediate local disallowance, including a disable whose persistence failed.
   * @param requestId - exact grant or attempt whose local request authority is being projected.
   * @returns whether this owner has blocked the identity before remote cleanup.
   */
  isLocallyBlocked(requestId: NativeRequestId): boolean { return this.blocked.has(requestId) }

  /**
   * Run one Main-owned request with the current active grant, including its entire response-body lifetime.
   * @param signal - cancellation of the caller's command or UI operation.
   * @param consume - Host-only operation that awaits body consumption and child cleanup before returning; it must not expose secrets.
   * @returns quiescent completion, not a still-readable response or a credential.
   */
  withCredential(signal: AbortSignal,
    consume: (secrets: NativeSecrets, lifetime: AbortSignal, expiresAt: number) => Promise<void>): Promise<void> {
    this.requireOpen()
    const record = this.store.records(this.http.origin).find(value => value.phase === 'active')
    if (record === undefined || this.isLocallyBlocked(record.requestId)) throw new Error('Native account is signed out')
    const expiresAt = record.metadata.credential?.expiresAt
    if (expiresAt === undefined) throw new Error('Native account has no confirmed expiry')
    if (expiresAt <= this.now()) throw new Error('Native account has expired')
    signal.throwIfAborted()
    const abort = new AbortController()
    const lifetime = AbortSignal.any([signal, abort.signal, this.shutdown.signal])
    const completion = Promise.withResolvers<void>()
    const request: ActiveRequest = { id: record.requestId, abort, done: completion.promise }
    this.requests.add(request)
    let timer: ReturnType<typeof setTimeout> | undefined
    const scheduleExpiry = (): void => {
      const remaining = expiresAt - this.now()
      if (remaining <= 0) { abort.abort(); return }
      // Node timers accept at most a signed 32-bit millisecond delay; the credential deadline never changes.
      timer = setTimeout(scheduleExpiry, Math.min(remaining, 2_147_483_647))
      timer.unref()
    }
    scheduleExpiry()
    const operation = (async () => {
      try {
        const secrets = await this.store.secrets(record.requestId, 'request')
        lifetime.throwIfAborted()
        if (expiresAt <= this.now()) throw new Error('Native account has expired')
        await consume(secrets, lifetime, expiresAt)
        lifetime.throwIfAborted()
      } finally {
        if (timer !== undefined) clearTimeout(timer)
        this.requests.delete(request)
        completion.resolve()
      }
    })()
    return operation
  }

  /**
   * Persist local disallowance before remote cleanup and wait for all accepted requests using this exact grant.
   * @param requestId - current or older attempt selected by the account controller, never a mutable device-id lookup.
   * @returns local quiescence; encrypted material remains until retryRevocations confirms 204 or original expiry.
   */
  disable(requestId: NativeRequestId): Promise<void> {
    this.requireOpen()
    this.blocked.add(requestId)
    const accepted = [...this.requests].filter(request => request.id === requestId)
    try { this.store.disable(requestId) }
    finally { for (const request of accepted) request.abort.abort() }
    return Promise.all(accepted.map(request => request.done)).then(() => {})
  }

  /**
   * Retry only exact disabled records; a failed request retains its existing OS-encrypted material.
   * @returns independent confirmed-revocation, original-expiry and retained-failure outcomes.
   */
  retryRevocations(): Promise<NativeRevocationResult> {
    this.requireOpen()
    if (this.sweep !== undefined) return this.sweep
    const operation = this.reconcile()
    this.sweep = operation
    void operation.finally(() => { this.sweep = undefined }).catch(() => {
      // The returned operation owns storage/invariant failures; this continuation only releases the single sweep.
    })
    return operation
  }

  /** Reject new requests and retries, abort accepted work, and await response-body and revocation cleanup. */
  close(): Promise<void> {
    this.closing = true
    this.shutdown.abort()
    this.closed ??= Promise.allSettled([
      ...[...this.requests].map(request => request.done),
      ...(this.sweep === undefined ? [] : [this.sweep]),
    ]).then(() => {})
    return this.closed
  }

  private async reconcile(): Promise<NativeRevocationResult> {
    let revoked = 0
    let expired = 0
    const failures: Array<NativeRevocationResult['failures'][number]> = []
    for (const original of this.store.records(this.http.origin)) {
      if (original.phase !== 'pending-cancel' && original.phase !== 'pending-revoke') continue
      if (this.shutdown.signal.aborted) {
        failures.push({ requestId: original.requestId, kind: 'cancelled' })
        continue
      }
      let record = original
      if (this.expired(record)) { this.store.removeDisabled(record.requestId); expired++; continue }
      let secrets: NativeSecrets
      try { secrets = await this.store.secrets(record.requestId, 'revoke') }
      catch { failures.push({ requestId: record.requestId, kind: 'storage' }); continue }
      try {
        if (record.phase === 'pending-cancel') {
          if (record.metadata.attempt === undefined) {
            const receipt = await this.http.create(secrets, this.shutdown.signal)
            const metadata = { ...record.metadata, attempt: {
              id: receipt.attempt_id, expiresAt: receipt.attempt_expires_at,
            } }
            this.store.saveMetadata(record.requestId, metadata)
            record = { ...record, metadata }
          }
          if (this.expired(record)) { this.store.removeDisabled(record.requestId); expired++; continue }
          const attempt = record.metadata.attempt
          if (attempt === undefined) throw new Error('Native cancellation requires its confirmed attempt')
          await this.http.cancel(secrets, attempt.id as NativeAttemptId, this.shutdown.signal)
        } else {
          await this.http.revoke(secrets, this.shutdown.signal)
        }
      } catch (error) {
        if (error instanceof NativeHttpFailure) failures.push({ requestId: record.requestId, kind: error.kind })
        else throw error
        continue
      }
      this.store.removeDisabled(record.requestId)
      revoked++
    }
    return { revoked, expired, failures }
  }

  private expired(record: NativeRecord): boolean {
    // A lost token response can leave a 90-day grant; attempt expiry alone cannot confirm its revocation.
    const attemptExpiry = record.metadata.attempt?.expiresAt
    const deadline = record.metadata.credential?.expiresAt ?? (attemptExpiry === undefined ? undefined
      : attemptExpiry + (record.metadata.exchangeStarted === true ? 90 * 86_400_000 : 0))
    return deadline !== undefined && deadline <= this.now()
  }

  private requireOpen(): void {
    if (this.closing) throw new Error('Native account access is closing')
  }
}
