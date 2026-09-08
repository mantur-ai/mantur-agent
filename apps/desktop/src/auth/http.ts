/** Host-only HTTP projection of native-account-v1 FROZEN 2026-09-07.1; no provider or identity fallback. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import { z } from 'zod'
import { nativeVerifier, type NativeDeviceId, type NativeSecrets } from './protocol.ts'

/** Server-owned attempt identity; never an authenticator. */
export type NativeAttemptId = Branded<'NativeAttemptId'>
/** Server-owned device grant identity; never the bearer. */
export type NativeCredentialId = Branded<'NativeCredentialId'>
/** Tenant identity reported by an authenticated native response. */
export type NativeAccountId = Branded<'NativeAccountId'>

const attemptId = z.uuid().transform(value => value as NativeAttemptId)
const credentialId = z.uuid().transform(value => value as NativeCredentialId)
const accountId = z.uuid().transform(value => value as NativeAccountId)
const timestamp = z.iso.datetime({ offset: true }).transform(value => Date.parse(value))
const account = z.object({ id: accountId, email: z.email(), display_name: z.string() })
const receipt = z.object({
  attempt_id: attemptId, user_code: z.string().regex(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/u),
  verification_uri: z.url(), verification_uri_complete: z.url(), attempt_expires_at: timestamp,
  expires_in: z.literal(600), poll_interval: z.literal(2), status: z.literal('pending'),
})
const grant = { credential_id: credentialId, credential_expires_at: timestamp, account }
const terminalReason = z.enum([
  'ACCOUNT_DISABLED', 'PENDING_ACTIVATION', 'ATTEMPT_CANCELLED', 'ATTEMPT_EXPIRED', 'DENIED', 'CANCELLED',
  'OAUTH_CANCELLED', 'OAUTH_STATE_INVALID', 'OAUTH_STATE_REPLAYED', 'OAUTH_PROVIDER_ERROR', 'EMAIL_NOT_VERIFIED',
  'CONSENT_REQUIRED', 'LINK_REAUTH_REQUIRED', 'LINK_CONFIRMATION_REQUIRED',
])
const poll = z.discriminatedUnion('status', [
  z.object({ status: z.literal('pending'), next_action: z.literal('wait_for_user'), expires_in: z.number().int().nonnegative() }),
  z.object({ status: z.literal('ready'), next_action: z.literal('activate'), ...grant }),
  z.object({ status: z.literal('active'), next_action: z.literal('none'), ...grant }),
  z.object({ status: z.literal('pending_activation'), next_action: z.literal('wait_for_activation') }),
  z.object({ status: z.literal('link_required'), next_action: z.literal('verify_existing_account_in_browser') }),
  z.object({ status: z.literal('denied'), next_action: z.literal('none'), reason: terminalReason }),
  z.object({ status: z.literal('cancelled'), next_action: z.literal('none'), reason: terminalReason }),
])
const ready = z.object({ status: z.literal('ready'), credential_id: credentialId, expires_at: timestamp, account })
const active = z.object({ status: z.literal('active'), credential_id: credentialId, expires_at: timestamp })
const session = active.extend({
  device_instance_id: z.uuid().transform(value => value as NativeDeviceId), client_id: z.literal('mantur-agent'), account,
  issued_at: timestamp, last_used_at: timestamp,
})
const errorCode = z.enum([
  'INVALID_REQUEST', 'INVALID_CLIENT', 'INVALID_DEVICE', 'IDEMPOTENCY_CONFLICT', 'RATE_LIMITED', 'AUTH_UNAVAILABLE',
  'CONSENT_REQUIRED', 'INVALID_CREDENTIALS', 'INVALID_ATTEMPT', 'PENDING_ACTIVATION', 'ACCOUNT_DISABLED',
  'ATTEMPT_FINALIZED', 'ATTEMPT_EXPIRED', 'ATTEMPT_CANCELLED', 'PROTOCOL_STATE_INVALID',
  'CREDENTIAL_INVALID', 'CREDENTIAL_REVOKED', 'CREDENTIAL_EXPIRED',
  'INVALID_EMAIL', 'EMAIL_TAKEN', 'SMTP_ERROR', 'WEAK_PASSWORD', 'INVALID_CODE', 'CODE_MISMATCH', 'INVALID_INVITE_CODE',
])
const errorEnvelope = z.object({
  error: errorCode,
  retry_after_ms: z.number().int().nonnegative().optional(),
  retryAfterMs: z.number().int().nonnegative().optional(),
})

/** Immutable create receipt. Current authorization state is read separately through poll. */
export type NativeAttemptReceipt = z.infer<typeof receipt>
/** Exhaustive states accepted from the frozen poll endpoint. */
export type NativePollResult = z.infer<typeof poll>
/** Confirmed ready grant; provisioning does not activate it. */
export type NativeReadyResult = z.infer<typeof ready>
/** Online validation response; its original expiry is authoritative. */
export type NativeSessionResult = z.infer<typeof session>

/** Fixed diagnostics exclude passwords, secrets, provider messages and transport exception text. */
export class NativeHttpFailure extends Error {
  /**
   * @param kind - local transport, cancellation, invalid protocol or recognized remote rejection.
   * @param status - HTTP status when a response exists.
   * @param code - recognized server code, never arbitrary response text.
   * @param retryAfterMs - server-provided registration/native throttling delay.
   */
  constructor(
    readonly kind: 'network' | 'cancelled' | 'protocol' | 'remote',
    readonly status?: number,
    readonly code?: z.infer<typeof errorCode>,
    readonly retryAfterMs?: number,
  ) { super(`Native account request failed: ${kind}`) }
}

/** Explicit Host-selected deployment and network resource budgets. */
export interface NativeHttpOptions {
  readonly origin: string
  readonly environment: NativeSecrets['environment']
  readonly timeoutMs: number
  readonly maxResponseBytes: number
}

/**
 * Validate the Main-selected deployment before any native credential can be attached.
 * @param options - configured origin and explicit production or test environment.
 * @returns canonical HTTPS origin, or an explicitly selected HTTP loopback test origin.
 */
export function nativeAccountOrigin(options: Pick<NativeHttpOptions, 'origin' | 'environment'>): string {
  let url: URL
  try { url = new URL(options.origin) } catch { throw new Error('Native account origin is invalid') }
  const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)
  if (url.username !== '' || url.password !== '' || url.pathname !== '/' || url.search !== '' || url.hash !== ''
    || (url.protocol !== 'https:' && !(options.environment === 'test' && url.protocol === 'http:' && loopback))) {
    throw new Error('Native account requires an HTTPS origin; only explicit loopback test deployments allow HTTP')
  }
  return url.origin
}

/** Only this client can attach native-account secrets; all URLs remain on its configured deployment. */
export class NativeHttpClient {
  readonly origin: string
  private readonly options: NativeHttpOptions

  /**
   * @param options - Host configuration, never renderer-supplied URLs or timing budgets.
   * @param transport - native fetch in production; an isolated transport in protocol tests.
   */
  constructor(options: NativeHttpOptions, private readonly transport: typeof fetch) {
    this.options = { ...options }
    this.origin = nativeAccountOrigin(options)
    if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 2_147_483_647
      || !Number.isSafeInteger(options.maxResponseBytes) || options.maxResponseBytes < 1) {
      throw new Error('Native account network budgets must be positive integers')
    }
  }

  /**
   * Submit only verifiers, using the complete previously persisted request after response loss.
   * @param secrets - OS-committed pending material; the owner must save it before calling.
   * @param signal - lifetime of the current operation.
   * @returns immutable receipt with a same-origin, allowlisted browser URL.
   */
  async create(secrets: NativeSecrets, signal: AbortSignal): Promise<NativeAttemptReceipt> {
    this.requireDeployment(secrets)
    const result = await this.request('/api/v1/native/auth/attempts', 'POST', receipt, [200, 201], signal, {
      request_id: secrets.requestId, client_id: 'mantur-agent', device_instance_id: secrets.deviceInstanceId,
      device_name: secrets.deviceName, platform: secrets.platform, credential_verifier: nativeVerifier(secrets.credential),
      attempt_token_verifier: nativeVerifier(secrets.attemptToken),
    })
    const base = new URL(result.verification_uri)
    const complete = new URL(result.verification_uri_complete)
    if (base.href !== `${this.origin}/auth/agent`
      || complete.origin !== this.origin || complete.pathname !== '/auth/agent' || complete.hash !== ''
      || complete.username !== '' || complete.password !== ''
      || complete.searchParams.size !== 1 || complete.searchParams.get('user_code') !== result.user_code) {
      throw new NativeHttpFailure('protocol')
    }
    return result
  }

  /**
   * Verify a password once; this call never retries or stores its input.
   * @param secrets - saved pending material from this deployment.
   * @param id - attempt selected by its immutable create receipt.
   * @param credentials - transient renderer form values, including explicit consent.
   * @param signal - originating UI operation lifetime.
   * @returns ready grant, not an active local account.
   */
  password(secrets: NativeSecrets, id: NativeAttemptId,
    credentials: { email: string; password: string; consent: true }, signal: AbortSignal): Promise<NativeReadyResult> {
    return this.request(`/api/v1/native/auth/attempts/${id}/password`, 'POST', ready, [200], signal, credentials, this.attemptHeaders(secrets))
  }

  /** Read the exact server state without retrying or converting unknown states to pending. */
  poll(secrets: NativeSecrets, id: NativeAttemptId, signal: AbortSignal): Promise<NativePollResult> {
    return this.request(`/api/v1/native/auth/attempts/${id}/poll`, 'POST', poll, [200], signal, undefined, this.attemptHeaders(secrets))
  }

  /** Cancel only this attempt, including a possibly active grant after a lost activation response. */
  cancel(secrets: NativeSecrets, id: NativeAttemptId, signal: AbortSignal): Promise<void> {
    return this.request(`/api/v1/native/auth/attempts/${id}/cancel`, 'POST', z.undefined(), [204], signal, undefined, this.attemptHeaders(secrets))
  }

  /** Prove possession of the pre-stored grant without returning its bearer. */
  activate(secrets: NativeSecrets, id: NativeAttemptId, signal: AbortSignal): Promise<z.infer<typeof active>> {
    return this.request('/api/v1/native/auth/credentials/activate', 'POST', active, [200], signal, { attempt_id: id }, this.credentialHeaders(secrets))
  }

  /** Validate this profile's exact device online; network failure never means expiry. */
  async session(secrets: NativeSecrets, signal: AbortSignal): Promise<NativeSessionResult> {
    const result = await this.request('/api/v1/native/session', 'GET', session, [200], signal, undefined, this.credentialHeaders(secrets))
    if (result.device_instance_id !== secrets.deviceInstanceId || result.expires_at <= result.issued_at) throw new NativeHttpFailure('protocol')
    return result
  }

  /** Confirm remote revocation only on 204; the owner retains encrypted material on every other outcome. */
  revoke(secrets: NativeSecrets, signal: AbortSignal): Promise<void> {
    return this.request('/api/v1/native/session/revoke', 'POST', z.undefined(), [204], signal, undefined, this.credentialHeaders(secrets))
  }

  /** Send a public registration code; the response owns code expiry, not an invented resend cooldown. */
  sendCode(email: string, signal: AbortSignal): Promise<{ ok: true; expiresInSec: number }> {
    return this.request('/api/v1/auth/send-code', 'POST', z.object({ ok: z.literal(true), expiresInSec: z.number().int().positive() }),
      [200], signal, { email, purpose: 'register' })
  }

  /** Register a pending account without a Cookie, grant, automatic login or password persistence. */
  register(input: { email: string; password: string; code: string; invite_code?: string }, signal: AbortSignal): Promise<{ ok: true; status: 'pending'; tenantId: NativeAccountId }> {
    return this.request('/api/v1/auth/register', 'POST', z.object({ ok: z.literal(true), status: z.literal('pending'), tenantId: accountId }), [201], signal, input)
  }

  private requireDeployment(secrets: NativeSecrets): void {
    if (secrets.origin !== this.origin || secrets.environment !== this.options.environment) throw new Error('Native account belongs to a different deployment')
  }

  private attemptHeaders(secrets: NativeSecrets): Record<string, string> {
    this.requireDeployment(secrets)
    return { 'X-Mantur-Attempt': secrets.attemptToken }
  }

  private credentialHeaders(secrets: NativeSecrets): Record<string, string> {
    this.requireDeployment(secrets)
    return { Authorization: `Bearer ${secrets.credential}` }
  }

  private async request<T>(path: string, method: 'GET' | 'POST', schema: z.ZodType<T>, statuses: readonly number[], signal: AbortSignal,
    body?: object, authorization: Record<string, string> = {}): Promise<T> {
    const lifetime = AbortSignal.any([signal, AbortSignal.timeout(this.options.timeoutMs)])
    let response: Response
    let value: unknown
    try {
      lifetime.throwIfAborted()
      response = await this.transport(`${this.origin}${path}`, {
        method, headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...authorization },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: lifetime, redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
      })
      value = response.status === 204 ? undefined : await this.readJson(response)
      lifetime.throwIfAborted()
    } catch (error) {
      if (error instanceof NativeHttpFailure) throw error
      throw new NativeHttpFailure(signal.aborted ? 'cancelled' : 'network')
    }
    if (!statuses.includes(response.status)) {
      const failure = errorEnvelope.safeParse(value)
      if (!failure.success) throw new NativeHttpFailure('protocol', response.status)
      throw new NativeHttpFailure('remote', response.status, failure.data.error,
        failure.data.retry_after_ms ?? failure.data.retryAfterMs)
    }
    const result = schema.safeParse(value)
    if (!result.success) throw new NativeHttpFailure('protocol', response.status)
    return result.data
  }

  private async readJson(response: Response): Promise<unknown> {
    const reader = response.body?.getReader()
    if (reader === undefined) throw new NativeHttpFailure('protocol', response.status)
    const chunks: Uint8Array[] = []
    let bytes = 0
    try {
      for (;;) {
        const chunk = await reader.read()
        if (chunk.done) break
        bytes += chunk.value.byteLength
        if (bytes > this.options.maxResponseBytes) {
          await reader.cancel()
          throw new NativeHttpFailure('protocol', response.status)
        }
        chunks.push(chunk.value)
      }
    } finally { reader.releaseLock() }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) as unknown }
    catch { throw new NativeHttpFailure('protocol', response.status) }
  }
}
