/** Host-only HTTP projection of browser-account-v2 FROZEN 2026-09-08.3; no provider or identity fallback. */
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
const account = z.strictObject({ id: accountId, display_name: z.string() })
const receipt = z.strictObject({
  attempt_id: attemptId, authorization_uri: z.url(), issuer: z.url(), environment: z.enum(['production', 'test']),
  attempt_expires_at: timestamp, expires_in: z.literal(600), status: z.literal('pending'),
})
const active = z.strictObject({
  status: z.literal('active'), grant_id: credentialId, grant_generation: z.number().int().positive(),
  device_instance_id: z.uuid().transform(value => value as NativeDeviceId),
  issuer: z.url(), environment: z.enum(['production', 'test']), credential_expires_at: timestamp, account,
  authority: z.literal('non_admin_api_key'),
  policy_key: z.strictObject({ id: z.uuid(), prefix: z.string(), expires_at: timestamp.nullable() }),
})
const session = active.extend({ last_verified_at: timestamp })
const errorCode = z.enum([
  'INVALID_REQUEST', 'INVALID_CLIENT', 'INVALID_DEVICE', 'INVALID_PLATFORM', 'INVALID_STATE', 'INVALID_PKCE',
  'INVALID_REDIRECT_URI', 'IDEMPOTENCY_CONFLICT', 'RATE_LIMITED', 'AUTH_UNAVAILABLE', 'CONSENT_REQUIRED',
  'ACCOUNT_DISABLED', 'ACCOUNT_NOT_ELIGIBLE', 'ATTEMPT_FINALIZED', 'ATTEMPT_EXPIRED', 'ATTEMPT_CANCELLED',
  'ATTEMPT_DENIED', 'ATTEMPT_NOT_FOUND', 'INVALID_DEVICE_PROOF', 'INVALID_CODE', 'INVALID_GRANT',
  'GRANT_REVOKED', 'GRANT_EXPIRED', 'GRANT_SUPERSEDED', 'CODE_ALREADY_USED', 'CODE_EXPIRED', 'ISSUER_MISMATCH',
  'POLICY_KEY_INACTIVE', 'DEFAULT_KEY_REQUIRED', 'DEFAULT_KEY_PROVISIONING_UNAVAILABLE',
])
const errorEnvelope = z.object({ error: errorCode, retry_after_ms: z.number().int().nonnegative().optional() })

/** Immutable create receipt; browser navigation alone cannot activate a device grant. */
export type NativeAttemptReceipt = z.infer<typeof receipt>
/** Confirmed device grant generation with a fixed policy Key and absolute expiry. */
export type NativeActiveResult = z.infer<typeof active>
/** Online validation response; its original expiry and generation remain authoritative. */
export type NativeSessionResult = z.infer<typeof session>

/** Fixed diagnostics exclude passwords, secrets, provider messages and transport exception text. */
export class NativeHttpFailure extends Error {
  /**
   * @param kind - local transport, cancellation, invalid protocol or recognized remote rejection.
   * @param status - HTTP status when a response exists.
   * @param code - recognized server code, never arbitrary response text.
   * @param retryAfterMs - server-provided authorization throttling delay.
   */
  constructor(
    readonly kind: 'network' | 'cancelled' | 'protocol' | 'remote' | 'endpoint-unavailable',
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
   * Register the pre-sealed browser attempt, replaying identical fields after response loss.
   * @param secrets - OS-committed pending material from this exact deployment.
   * @param signal - current operation lifetime.
   * @returns immutable receipt whose authorization URL has been checked field by field.
   */
  async create(secrets: NativeSecrets, signal: AbortSignal): Promise<NativeAttemptReceipt> {
    this.requireDeployment(secrets)
    this.requireRedirect(secrets.redirectUri)
    const result = await this.request('/api/v1/client-auth/attempts', 'POST', receipt, [200, 201], signal, {
      request_id: secrets.requestId, client_id: 'mantur-agent', device_instance_id: secrets.deviceInstanceId,
      device_name: secrets.deviceName, platform: secrets.platform, credential_verifier: nativeVerifier(secrets.credential),
      state: secrets.state, code_challenge: nativeVerifier(secrets.codeVerifier), code_challenge_method: 'S256',
      redirect_uri: secrets.redirectUri,
    })
    this.requireIssuer(result)
    const url = new URL(result.authorization_uri)
    if (url.origin !== this.origin || url.pathname !== '/auth/client' || url.hash !== ''
      || url.username !== '' || url.password !== '' || url.searchParams.size !== 3
      || url.searchParams.getAll('attempt_id').length !== 1 || url.searchParams.get('attempt_id') !== result.attempt_id
      || url.searchParams.getAll('state').length !== 1 || url.searchParams.get('state') !== secrets.state
      || url.searchParams.getAll('iss').length !== 1 || url.searchParams.get('iss') !== this.origin) {
      throw new NativeHttpFailure('protocol')
    }
    return result
  }

  /**
   * Exchange or recover the exact sealed request; no new request ID or credential is generated here.
   * @param secrets - saved code, state, verifier, redirect and device proof.
   * @param id - original server attempt identity.
   * @param signal - foreground operation lifetime.
   * @returns current server-confirmed grant generation, never a raw bearer or platform Key.
   */
  async exchange(secrets: NativeSecrets, id: NativeAttemptId, signal: AbortSignal): Promise<NativeActiveResult> {
    if (secrets.code === undefined) throw new NativeHttpFailure('protocol')
    this.requireRedirect(secrets.redirectUri)
    const result = await this.request('/api/v1/client-auth/token', 'POST', active, [200], signal, {
      exchange_request_id: secrets.exchangeRequestId, attempt_id: id, client_id: 'mantur-agent',
      device_instance_id: secrets.deviceInstanceId, code: secrets.code, state: secrets.state,
      code_verifier: secrets.codeVerifier, redirect_uri: secrets.redirectUri, issuer: this.origin,
    }, this.credentialHeaders(secrets))
    this.requireGrant(result, secrets)
    return result
  }

  /** Cancel the exact attempt; the server may revoke only the generation produced by that attempt. */
  cancel(secrets: NativeSecrets, id: NativeAttemptId, signal: AbortSignal): Promise<void> {
    return this.request(`/api/v1/client-auth/attempts/${id}/cancel`, 'POST', z.undefined(), [204], signal, {
      request_id: secrets.requestId, client_id: 'mantur-agent', device_instance_id: secrets.deviceInstanceId,
      state: secrets.state, issuer: this.origin,
    }, this.credentialHeaders(secrets))
  }

  /** Validate this profile's exact device online; network failure never means expiry. */
  async session(secrets: NativeSecrets, signal: AbortSignal): Promise<NativeSessionResult> {
    const result = await this.request('/api/v1/client-auth/session', 'GET', session, [200], signal, undefined,
      { ...this.credentialHeaders(secrets), 'X-Mantur-Client': 'desktop' })
    this.requireGrant(result, secrets)
    return result
  }

  /** Confirm remote revocation only on 204; retain encrypted material on every other outcome. */
  revoke(secrets: NativeSecrets, signal: AbortSignal): Promise<void> {
    return this.request('/api/v1/client-auth/grants/revoke', 'POST', z.undefined(), [204], signal, {
      request_id: secrets.requestId, device_instance_id: secrets.deviceInstanceId, issuer: this.origin,
    }, this.credentialHeaders(secrets))
  }

  private requireDeployment(secrets: NativeSecrets): void {
    if (secrets.origin !== this.origin || secrets.environment !== this.options.environment) throw new NativeHttpFailure('protocol')
  }

  private requireIssuer(result: { issuer: string; environment: string }): void {
    if (result.issuer !== this.origin || result.environment !== this.options.environment) throw new NativeHttpFailure('protocol')
  }

  private requireGrant(result: NativeActiveResult, secrets: NativeSecrets): void {
    this.requireIssuer(result)
    if (result.device_instance_id !== secrets.deviceInstanceId) throw new NativeHttpFailure('protocol')
  }

  private requireRedirect(value: string): void {
    const url = new URL(value)
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.port === ''
      || url.username !== '' || url.password !== '' || url.pathname !== '/oauth/mantur/callback'
      || url.search !== '' || url.hash !== '' || url.href !== value) throw new NativeHttpFailure('protocol')
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
      if (response.status === 404 && path === '/api/v1/client-auth/attempts') {
        await response.body?.cancel()
        throw new NativeHttpFailure('endpoint-unavailable', response.status)
      }
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
        failure.data.retry_after_ms)
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
