/** ManturHub device authorization and browser-safe account Remote. */

import { createHash, randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import type { AuthorizationSession } from '@deepseek-ai/dsh-authorization'
import { credentialKey, type CredentialKey, type CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { brandString } from '@deepseek-ai/dsh-brand'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import type {
  ManturAccount,
  ManturAccountStatus,
  ManturEnvironment,
  ManturIdentityMode,
  ManturLoginAttemptId,
  ManturLoginProgress,
  ManturLoginStart,
} from './types.ts'
import { NativeAccountConnection, type NativeAccountConfiguration } from './native.ts'
import type {} from '@deepseek-ai/dsh-command-scopes'

export type * from './types.ts'

/** Credential record owned by this authorization provider. */
export const MANTUR_ACCOUNT_CREDENTIAL = credentialKey('authorization-manturhub', 'account')

/** Public production deployment used when no endpoint override is configured. */
export const MANTUR_PRODUCTION_BASE_URL = 'https://hub.mantur.ai'

/** ManturHub deployment endpoint. */
export interface Config {
  /** Standalone credential storage or Electron Main ownership; no cross-mode credential lookup. */
  readonly identity?: ManturIdentityMode
  /** Explicit Main transport and command budgets, required for desktop-managed identity. */
  readonly native?: Omit<NativeAccountConfiguration, 'origin' | 'environment'> | undefined
  /** Active ManturHub deployment; defaults to production. */
  readonly environment?: ManturEnvironment
  /** Production HTTP origin serving the ManturHub APIs. */
  readonly baseUrl?: string
  /** Test HTTP origin; required before the test deployment can be selected. */
  readonly testBaseUrl?: string
}

interface ResolvedEnvironment {
  readonly environment: ManturEnvironment
  readonly baseUrl: URL
  readonly credential: CredentialKey
}

interface ResolvedConfig {
  readonly native?: NativeAccountConfiguration
  readonly active: ResolvedEnvironment
  readonly production: ResolvedEnvironment
  readonly test?: ResolvedEnvironment
}

interface StoredGrant {
  readonly version: 1
  readonly apiKey: string
  readonly account: ManturAccount
}

interface Attempt {
  readonly id: ManturLoginAttemptId
  readonly deployment: ResolvedEnvironment
  readonly ready: PromiseWithResolvers<ManturLoginStart>
  progress: ManturLoginProgress
}

/** Host-only options for one request to the configured ManturHub origin. */
export interface ManturHubRequestOptions {
  /** Attach the locally stored account grant; unsigned callers receive `undefined`. */
  readonly authenticated: boolean
  /** Additional non-secret request headers. */
  readonly headers?: HeadersInit
  /** Abort the network request. */
  readonly signal?: AbortSignal
  /** Redirect handling for the caller-owned protocol. */
  readonly redirect?: RequestRedirect
}

const authorizationResponseLimitBytes = 64 * 1024
const environments = ['production', 'test'] as const satisfies readonly ManturEnvironment[]
const nativeConfigurationSchema = z.strictObject({
  environmentLabel: z.string().min(1).max(80), requestTimeoutMs: z.number().int().min(1).max(2_147_483_647),
  maxResponseBytes: z.number().int().positive(), leaseMs: z.number().int().positive(),
  revocationRetryMs: z.number().int().min(1).max(2_147_483_647),
})

const deviceSessionSchema = z.object({
  device_code: z.string().min(1),
  user_code: z.string().min(1),
  verify_url: z.url(),
  interval: z.number().int().min(1).default(5),
  expires_in: z.number().int().positive().default(600),
})

const nonReadyPollStatusSchema = z.enum([
  'pending',
  'slow_down',
  'access_denied',
  'denied',
  'expired',
])

const devicePollSchema = z.union([
  z.object({ status: nonReadyPollStatusSchema }),
  z.object({ error: nonReadyPollStatusSchema }),
  z.object({ status: z.literal('ready'), key: z.string().min(1) }),
])

const accountSchema = z.object({
  email: z.string().min(1),
})

const storedGrantSchema = z.object({
  version: z.literal(1),
  apiKey: z.string().min(1),
  account: accountSchema,
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the ManturHub account Remote namespace. */
    manturAccount: ManturHubAuthorization
  }
}

/** Parse one configured deployment origin. */
function parseOrigin(field: 'baseUrl' | 'testBaseUrl', value: string): URL {
  let baseUrl: URL
  try {
    baseUrl = new URL(value)
  } catch (error) {
    throw new TypeError(`authorization-manturhub: ${field} must be an HTTP(S) origin`, { cause: error })
  }
  if (!['http:', 'https:'].includes(baseUrl.protocol)
    || baseUrl.username !== ''
    || baseUrl.password !== ''
    || baseUrl.pathname !== '/'
    || baseUrl.search !== ''
    || baseUrl.hash !== '') {
    throw new TypeError(`authorization-manturhub: ${field} must be an HTTP(S) origin without credentials, query, or fragment`)
  }
  return baseUrl
}

/**
 * Address the grant for one deployment origin without allowing another origin to read it.
 * The public production origin retains the original key so existing local login remains valid.
 * @param environment - named deployment owning the grant.
 * @param baseUrl - validated deployment origin.
 * @returns credential key unique to the named origin.
 */
export function manturAccountCredential(environment: ManturEnvironment, baseUrl: URL): CredentialKey {
  if (environment === 'production' && baseUrl.origin === MANTUR_PRODUCTION_BASE_URL) {
    return MANTUR_ACCOUNT_CREDENTIAL
  }
  const fingerprint = createHash('sha256').update(baseUrl.origin).digest('hex')
  return credentialKey('authorization-manturhub', `account-${environment}-${fingerprint}`)
}

/** Resolve and validate every configured endpoint and the active deployment. */
function resolveConfig(config: Config): ResolvedConfig {
  const productionBaseUrl = parseOrigin('baseUrl', config.baseUrl ?? MANTUR_PRODUCTION_BASE_URL)
  const production: ResolvedEnvironment = {
    environment: 'production',
    baseUrl: productionBaseUrl,
    credential: manturAccountCredential('production', productionBaseUrl),
  }
  const testBaseUrl = config.testBaseUrl === undefined || config.testBaseUrl.trim() === ''
    ? undefined
    : parseOrigin('testBaseUrl', config.testBaseUrl.trim())
  if (testBaseUrl?.origin === productionBaseUrl.origin) {
    throw new TypeError('authorization-manturhub: testBaseUrl must differ from the production baseUrl')
  }
  const test: ResolvedEnvironment | undefined = testBaseUrl === undefined
    ? undefined
    : {
      environment: 'test',
      baseUrl: testBaseUrl,
      credential: manturAccountCredential('test', testBaseUrl),
    }
  const environment = config.environment ?? 'production'
  if (!environments.includes(environment)) {
    throw new TypeError('authorization-manturhub: environment must be "production" or "test"')
  }
  const native = config.identity === 'desktop-managed' ? nativeConfigurationSchema.parse(config.native) : undefined
  if (environment === 'test') {
    if (test === undefined) {
      throw new TypeError('authorization-manturhub: testBaseUrl is required when environment is "test"')
    }
    return { active: test, production, test,
      ...(native === undefined ? {} : { native: { ...native, origin: test.baseUrl.origin, environment } }) }
  }
  return { active: production, production, ...(test === undefined ? {} : { test }),
    ...(native === undefined ? {} : { native: { ...native, origin: production.baseUrl.origin, environment } }) }
}

/**
 * Read and parse one ManturHub JSON response without unbounded buffering.
 * @param response - ManturHub HTTP response whose body remains unread.
 * @param maxBytes - Maximum response-body bytes accepted before cancellation.
 * @param limitSubject - Diagnostic noun identifying the caller-owned response class.
 * @returns the parsed JSON value.
 * @throws when the body is absent, exceeds `maxBytes`, cannot be read, or is not valid JSON.
 */
export async function readManturHubJson(
  response: Response,
  maxBytes: number,
  limitSubject: string,
): Promise<unknown> {
  const reader = response.body?.getReader()
  if (reader === undefined) throw new Error('ManturHub returned no response body')
  const chunks: Uint8Array[] = []
  let length = 0
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    length += chunk.value.byteLength
    if (length > maxBytes) {
      await reader.cancel()
      throw new Error(`ManturHub ${limitSubject} exceeded ${maxBytes} bytes`)
    }
    chunks.push(chunk.value)
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown
}

/** Reject non-success HTTP responses after consuming their bounded body. */
async function requireJson(response: Response): Promise<unknown> {
  const body = await readManturHubJson(response, authorizationResponseLimitBytes, 'response')
  if (!response.ok) throw new Error(`ManturHub request failed with HTTP ${response.status}`)
  return body
}

/** Wait for the server-directed polling interval, withdrawing promptly. */
function wait(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  const timeout = Promise.withResolvers<void>()
  const aborted = Promise.withResolvers<void>()
  const timer = setTimeout(timeout.resolve, ms)
  const onAbort: EventListener = aborted.reject
  signal.addEventListener('abort', onAbort, { once: true })
  return Promise.race([timeout.promise, aborted.promise]).finally(() => {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
  })
}

/** Project the exact account fields allowed onto the browser wire and record. */
function projectAccount(value: z.infer<typeof accountSchema>): ManturAccount {
  return { email: value.email }
}

/** Normalize ManturHub's status and OAuth-style error response fields. */
function parsePoll(value: unknown):
  | { readonly status: z.infer<typeof nonReadyPollStatusSchema> }
  | { readonly status: 'ready'; readonly key: string } {
  const parsed = devicePollSchema.parse(value)
  return 'error' in parsed ? { status: parsed.error } : parsed
}

/** Parse this plugin's private grant record and fail on foreign or damaged data. */
function parseGrant(record: CredentialRecord | undefined): StoredGrant | undefined {
  if (record === undefined) return undefined
  if (record.kind !== 'grant') throw new Error('ManturHub account credential has the wrong record kind')
  const parsed = storedGrantSchema.parse(record.payload)
  return { version: 1, apiKey: parsed.apiKey, account: projectAccount(parsed.account) }
}

/** Host service registering the ManturHub authorization flow and account Remote. */
export class ManturHubAuthorization extends TypertRemoteService {
  static inject = ['authorization', 'credentials']

  static Config: s<Config> = s.object({
    identity: s.union(['standalone', 'desktop-managed']).default('standalone'),
    native: s.union([s.const(undefined), s.object({ environmentLabel: s.string().required(), requestTimeoutMs: s.number().required(),
      maxResponseBytes: s.number().required(), leaseMs: s.number().required(), revocationRetryMs: s.number().required() })]),
    environment: s.union(environments).default('production'),
    baseUrl: s.string().default(MANTUR_PRODUCTION_BASE_URL),
    testBaseUrl: s.string(),
  })

  private readonly config: ResolvedConfig
  private native: NativeAccountConnection | undefined
  private stopNative: (() => Promise<void>) | undefined
  private nativeShutdown: Promise<void> | undefined
  private currentAttempt: Attempt | undefined
  private lastAttempt: Attempt | undefined

  /**
   * @param ctx - Host context carrying authorization and credential services.
   * @param config - ManturHub endpoint selection.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'manturAccount', { namespace: 'manturAccount' })
    this.config = resolveConfig(config)
    const native = this.config.native
    if (native !== undefined) {
      ctx.effect(() => {
        const connection = new NativeAccountConnection(native)
        this.native = connection
        let stopCommands: (() => Promise<void>) | undefined
        const commands = ctx.inject(['commandScopes'], (commandCtx) => {
          commandCtx.effect(() => {
            const stop = commandCtx.commandScopes.register({ prepare: signal => connection.prepare(signal) })
            stopCommands = stop
            return stop
          }, 'authorization-manturhub: native command identity')
        })
        this.stopNative = async () => {
          const outcomes = await Promise.allSettled([stopCommands?.(), commands.dispose(), connection.close()])
          const failures = outcomes.flatMap(outcome => outcome.status === 'rejected' ? [outcome.reason as unknown] : [])
          if (failures.length > 0) throw new AggregateError(failures, 'Native account shutdown failed')
        }
        return () => this.stopNativeForShutdown()
      }, 'authorization-manturhub: native Main connection')
      return
    }
    ctx.effect(() => {
      const deployments = [
        this.config.production,
        ...(this.config.test === undefined ? [] : [this.config.test]),
      ]
      const disposers = deployments.map(deployment => ctx.authorization.registerFlow({
        key: deployment.credential,
        label: deployment.environment === 'production' ? 'ManturHub' : 'ManturHub (Test)',
        methods: [{ id: 'device-code', label: 'Device code' }],
        run: session => this.runDeviceFlow(
          session,
          this.currentAttempt?.deployment.credential === deployment.credential ? this.currentAttempt : undefined,
          deployment,
        ),
      }))
      return () => {
        for (const dispose of disposers) dispose()
      }
    }, 'authorization-manturhub: deployment flows')
    ctx.effect(() => () => {
      if (this.currentAttempt !== undefined) ctx.authorization.cancel(this.currentAttempt.deployment.credential)
    }, 'authorization-manturhub: cancel active attempt')
  }

  protected async [Service.init](): Promise<void> {
    if (this.config.native !== undefined) await this.nativeConnection().initialize()
  }

  /**
   * Read the profile-selected identity owner without probing credentials or browser globals.
   * @returns the configured identity mode.
   */
  @Remote
  identityMode(): ManturIdentityMode { return this.config.native === undefined ? 'standalone' : 'desktop-managed' }

  /**
   * Freeze native command identity and brokered API admission, then join trees, leases and IPC cleanup.
   * The parent must keep IPC connected until this operation completes.
   * @returns the same completion on every call; retained cleanup failures reject.
   * @throws when this provider has no initialized desktop-managed connection, including standalone mode.
   */
  stopNativeForShutdown(): Promise<void> {
    if (this.stopNative === undefined) return Promise.reject(new Error('Native shutdown requires an initialized desktop-managed provider'))
    this.nativeShutdown ??= this.stopNative()
    return this.nativeShutdown
  }

  private nativeConnection(): NativeAccountConnection {
    if (this.native === undefined) throw new Error('Native command preparation requires the configured Main connection')
    return this.native
  }

  private requireStandalone(): void {
    if (this.config.native !== undefined) throw new RemoteError('gateway/bad-request', 'Use the native account window for this desktop identity', {})
  }

  /**
   * Send a Host-only GET to this account provider's configured deployment.
   *
   * The method accepts only root-relative paths so a stored grant cannot be
   * forwarded to another origin. It is intentionally not a browser Remote.
   *
   * @param pathname - root-relative ManturHub API path.
   * @param options - authentication, headers, cancellation, and redirect policy.
   * @returns the response, or `undefined` when authentication was requested while signed out.
   */
  async request(pathname: string, options: ManturHubRequestOptions): Promise<Response | undefined> {
    const deployment = this.config.active
    const url = new URL(pathname, deployment.baseUrl)
    if (!pathname.startsWith('/') || pathname.startsWith('//') || url.origin !== deployment.baseUrl.origin) {
      throw new TypeError('authorization-manturhub: request pathname must be root-relative')
    }
    const headers = new Headers(options.headers)
    if (options.authenticated) {
      if (this.config.native !== undefined) {
        return await this.nativeConnection().requestApi(pathname, headers, options.signal ?? new AbortController().signal)
      }
      const grant = parseGrant(await this.ctx.credentials.readRecord(deployment.credential))
      if (grant === undefined) return undefined
      headers.set('x-api-key', grant.apiKey)
    }
    return await fetch(url, {
      headers,
      redirect: options.redirect ?? 'error',
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
  }

  /**
   * Read local sign-in state without exposing the stored API key.
   * @returns signed-out or the sanitized account committed with the grant.
   */
  @Remote
  async status(): Promise<ManturAccountStatus> {
    try {
      if (this.config.native !== undefined) {
        const snapshot = await this.nativeConnection().status()
        if (!snapshot.authenticated) return { status: 'signed-out' }
        if (snapshot.account === undefined) throw new Error('Native account metadata is missing')
        return { status: 'signed-in', account: { displayName: snapshot.account.displayName } }
      }
      const grant = parseGrant(await this.ctx.credentials.readRecord(this.config.active.credential))
      return grant === undefined
        ? { status: 'signed-out' }
        : { status: 'signed-in', account: grant.account }
    } catch (error) {
      throw new RemoteError('gateway/internal', 'ManturHub account credential could not be read', {}, { cause: error })
    }
  }

  /**
   * Start one process-local device authorization attempt.
   * @returns browser-safe verification instructions after ManturHub creates the device session.
   */
  @Remote
  async startLogin(): Promise<ManturLoginStart> {
    this.requireStandalone()
    if (this.currentAttempt !== undefined) {
      throw new RemoteError('gateway/bad-request', 'a ManturHub login attempt is already running', {})
    }
    const deployment = this.config.active
    const grant = parseGrant(await this.ctx.credentials.readRecord(deployment.credential))
    if (grant !== undefined) {
      throw new RemoteError('gateway/bad-request', 'the ManturHub account is already signed in', {})
    }
    const attempt: Attempt = {
      id: brandString<ManturLoginAttemptId>(randomUUID()),
      deployment,
      ready: Promise.withResolvers<ManturLoginStart>(),
      progress: { status: 'pending' },
    }
    this.currentAttempt = attempt
    this.lastAttempt = attempt
    void this.ctx.authorization.begin({
      key: attempt.deployment.credential,
      method: 'device-code',
      interaction: {
        notify: () => {},
        prompt: () => Promise.reject(new Error('ManturHub device authorization does not prompt in the client')),
      },
    }).then((outcome) => {
      if (outcome.status === 'cancelled') {
        attempt.progress = { status: 'cancelled' }
        attempt.ready.reject(new Error('ManturHub login was cancelled'))
        return
      }
    }).catch((error: unknown) => {
      this.ctx.logger.warn('authorization-manturhub: device login failed')
      this.ctx.logger.warn(error)
      attempt.progress = { status: 'failed' }
      attempt.ready.reject(error)
    }).finally(() => { this.currentAttempt = undefined })

    try {
      return await attempt.ready.promise
    } catch (error) {
      throw new RemoteError('gateway/internal', 'ManturHub login could not be started', {}, { cause: error })
    }
  }

  /**
   * Read one attempt's current process-local outcome.
   * @param attemptId - opaque id returned by {@link startLogin}.
   * @returns pending or the settled outcome; no secret is included.
   */
  @Remote
  loginProgress(attemptId: ManturLoginAttemptId): ManturLoginProgress {
    this.requireStandalone()
    if (this.lastAttempt?.id !== attemptId) {
      throw new RemoteError('gateway/bad-request', 'unknown ManturHub login attempt', {})
    }
    return this.lastAttempt.progress
  }

  /**
   * Cancel the matching active attempt; a settled or unknown attempt is unchanged.
   * @param attemptId - opaque id returned by {@link startLogin}.
   */
  @Remote
  cancelLogin(attemptId: ManturLoginAttemptId): void {
    this.requireStandalone()
    if (this.currentAttempt?.id !== attemptId) return
    this.ctx.authorization.cancel(this.currentAttempt.deployment.credential)
  }

  /** Remove the local ManturHub grant and cancel any unfinished login. */
  @Remote
  async signOut(): Promise<void> {
    this.requireStandalone()
    const deployment = this.config.active
    if (this.currentAttempt !== undefined) this.ctx.authorization.cancel(this.currentAttempt.deployment.credential)
    try {
      await this.ctx.credentials.deleteRecord(deployment.credential)
    } catch (error) {
      throw new RemoteError('gateway/internal', 'ManturHub account could not be signed out', {}, { cause: error })
    }
  }

  /** Publish the first browser instruction to the matching process-local attempt. */
  private publishStart(
    attempt: Attempt | undefined,
    verificationUrl: URL,
    userCode: string,
    expiresInSeconds: number,
  ): void {
    if (attempt === undefined) return
    const start: ManturLoginStart = {
      attemptId: attempt.id,
      verificationUrl: verificationUrl.toString(),
      userCode,
      expiresAt: Date.now() + expiresInSeconds * 1000,
    }
    attempt.ready.resolve(start)
  }

  /** Run the provider protocol and commit its grant before resolving. */
  private async runDeviceFlow(
    session: AuthorizationSession,
    attempt: Attempt | undefined,
    deployment: ResolvedEnvironment,
  ): Promise<void> {
    const created = deviceSessionSchema.parse(await requireJson(await fetch(
      new URL('/api/v1/cli/session', deployment.baseUrl),
      { method: 'POST', redirect: 'error', signal: session.signal },
    )))
    const verificationUrl = new URL(created.verify_url)
    if (verificationUrl.origin !== deployment.baseUrl.origin) {
      throw new Error('ManturHub returned a verification URL on another origin')
    }
    this.publishStart(attempt, verificationUrl, created.user_code, created.expires_in)
    session.notify({
      message: 'Continue in your browser to authorize Mantur Agent.',
      url: verificationUrl.toString(),
      code: created.user_code,
    })

    let pollIntervalSeconds = created.interval
    while (true) {
      const response = await fetch(new URL(
        `/api/v1/cli/poll?device_code=${encodeURIComponent(created.device_code)}`,
        deployment.baseUrl,
      ), { redirect: 'error', signal: session.signal })
      const poll = parsePoll(await readManturHubJson(response, authorizationResponseLimitBytes, 'response'))
      if (poll.status === 'ready') {
        if (!response.ok) throw new Error(`ManturHub login poll failed with HTTP ${response.status}`)
        const account = projectAccount(accountSchema.parse(await requireJson(await fetch(
          new URL('/api/v1/me', deployment.baseUrl),
          {
            headers: { 'x-api-key': poll.key },
            redirect: 'error',
            signal: session.signal,
          },
        ))))
        const payload: StoredGrant = { version: 1, apiKey: poll.key, account }
        await this.ctx.credentials.modifyRecord(
          deployment.credential,
          () => Promise.resolve({ kind: 'grant', payload }),
        )
        if (attempt !== undefined) attempt.progress = { status: 'authorized', account }
        return
      }
      if (poll.status === 'expired' || poll.status === 'access_denied' || poll.status === 'denied') {
        throw new Error(`ManturHub device login ${poll.status}`)
      }
      if (!response.ok) throw new Error(`ManturHub login poll failed with HTTP ${response.status}`)
      if (poll.status === 'slow_down') pollIntervalSeconds += 5
      await wait(pollIntervalSeconds * 1000, session.signal)
    }
  }
}

export default ManturHubAuthorization
