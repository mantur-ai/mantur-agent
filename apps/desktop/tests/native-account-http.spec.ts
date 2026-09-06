/** Frozen native-account wire validation with isolated transports and real loopback redirect/cancellation checks. */
import { randomUUID } from 'node:crypto'
import { createServer, type RequestListener, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NativeHttpClient, NativeHttpFailure, type NativeAttemptId } from '../src/auth/http.ts'
import { createNativeSecrets, nativeVerifier, type NativeDeviceId } from '../src/auth/protocol.ts'

const attempt = randomUUID() as NativeAttemptId
const credential = randomUUID()
const tenant = randomUUID()
const account = { id: tenant, email: 'isolated@example.com', display_name: 'Isolated account' }
const expires = '2030-01-01T00:00:00Z'
const credentialData = { credential_id: credential, credential_expires_at: expires, account }
const signal = (): AbortSignal => new AbortController().signal

function createReceipt(origin = 'https://auth.example') {
  return {
    attempt_id: attempt, user_code: 'ABCD-EFGH', verification_uri: `${origin}/auth/agent`,
    verification_uri_complete: `${origin}/auth/agent?user_code=ABCD-EFGH`,
    attempt_expires_at: '2029-01-01T00:10:00Z', expires_in: 600, poll_interval: 2, status: 'pending',
  }
}

function bench(origin = 'https://auth.example') {
  const transport = vi.fn<typeof fetch>()
  const options = { origin, environment: 'test' as const, timeoutMs: 10_000, maxResponseBytes: 16_384 }
  const client = new NativeHttpClient(options, transport)
  const secrets = createNativeSecrets({ origin, environment: 'test', deviceInstanceId: randomUUID() as NativeDeviceId,
    deviceName: 'Isolated test device', platform: 'macos' })
  return { client, secrets, transport, options }
}

const servers: Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.closeAllConnections()
    server.close((error) => { if (error === undefined) resolve(); else reject(error) })
  })))
})

async function listen(handler: RequestListener): Promise<string> {
  const server = createServer(handler)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve() })
  })
  servers.push(server)
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Expected allocated loopback port')
  return `http://127.0.0.1:${address.port}`
}

describe('native account HTTP', () => {
  it('sends only full-prefix verifiers and replays the same persisted create fields after a lost response', async () => {
    const b = bench()
    b.transport.mockRejectedValueOnce(new Error(`Lost ${b.secrets.credential}`))
      .mockResolvedValueOnce(Response.json(createReceipt(), { status: 201 }))
    await expect(b.client.create(b.secrets, signal())).rejects.toMatchObject({ kind: 'network' })
    const result = await b.client.create(b.secrets, signal())
    expect(result.attempt_expires_at).toBe(Date.parse('2029-01-01T00:10:00Z'))
    expect(b.transport).toHaveBeenCalledTimes(2)
    const [url, init] = b.transport.mock.calls[0]!
    expect(url).toBe('https://auth.example/api/v1/native/auth/attempts')
    expect(init).toMatchObject({ redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' })
    expect(init?.body).toBe(b.transport.mock.calls[1]?.[1]?.body)
    if (typeof init?.body !== 'string') throw new Error('Expected JSON request body')
    expect(JSON.parse(init.body)).toEqual({ request_id: b.secrets.requestId, client_id: 'mantur-agent',
      device_instance_id: b.secrets.deviceInstanceId, device_name: b.secrets.deviceName, platform: 'macos',
      credential_verifier: nativeVerifier(b.secrets.credential), attempt_token_verifier: nativeVerifier(b.secrets.attemptToken) })
    expect(JSON.stringify(init)).not.toContain(b.secrets.credential)
    expect(JSON.stringify(init)).not.toContain(b.secrets.attemptToken)
  })

  it('returns only ready after password consent, activates separately, and never retries the password', async () => {
    const b = bench()
    b.transport.mockResolvedValueOnce(Response.json({ status: 'ready', credential_id: credential, expires_at: expires, account }))
      .mockResolvedValueOnce(Response.json({ status: 'active', credential_id: credential, expires_at: expires }))
    const input = { email: account.email, password: 'Transient password', consent: true as const }
    expect((await b.client.password(b.secrets, attempt, input, signal())).status).toBe('ready')
    expect((await b.client.activate(b.secrets, attempt, signal())).status).toBe('active')
    expect(b.transport).toHaveBeenCalledTimes(2)
    const passwordRequest = b.transport.mock.calls[0]?.[1]
    expect(passwordRequest?.headers).toMatchObject({ 'X-Mantur-Attempt': b.secrets.attemptToken })
    expect(passwordRequest?.headers).not.toHaveProperty('Authorization')
    expect(passwordRequest?.body).toBe(JSON.stringify(input))
    const activationRequest = b.transport.mock.calls[1]?.[1]
    expect(activationRequest?.headers).toMatchObject({ Authorization: `Bearer ${b.secrets.credential}` })
    expect(activationRequest?.body).toBe(JSON.stringify({ attempt_id: attempt }))
    expect(activationRequest?.body).not.toContain(input.password)
  })

  it.each([
    { status: 'pending', next_action: 'wait_for_user', expires_in: 480 },
    { status: 'ready', next_action: 'activate', ...credentialData },
    { status: 'active', next_action: 'none', ...credentialData },
    { status: 'pending_activation', next_action: 'wait_for_activation' },
    { status: 'link_required', next_action: 'verify_existing_account_in_browser' },
    { status: 'denied', next_action: 'none', reason: 'ACCOUNT_DISABLED' },
    { status: 'cancelled', next_action: 'none', reason: 'ATTEMPT_CANCELLED' },
  ])('preserves the $status poll state', async (value) => {
    const b = bench()
    b.transport.mockResolvedValueOnce(Response.json(value))
    const result = await b.client.poll(b.secrets, attempt, signal())
    expect(result.status).toBe(value.status)
    expect(result.next_action).toBe(value.next_action)
    expect(b.transport.mock.calls[0]?.[1]?.headers).toMatchObject({ 'X-Mantur-Attempt': b.secrets.attemptToken })
  })

  it.each([
    { status: 'mystery', next_action: 'wait_for_user' },
    { status: 'pending', next_action: 'activate', expires_in: 480 },
    { status: 'ready', next_action: 'activate', ...credentialData, credential_expires_at: 'tomorrow' },
    { status: 'denied', next_action: 'none', reason: 'provider echoed secret text' },
  ])('fails closed for invalid poll response %#', async (value) => {
    const b = bench()
    b.transport.mockResolvedValueOnce(Response.json(value))
    await expect(b.client.poll(b.secrets, attempt, signal())).rejects.toMatchObject({ kind: 'protocol' })
  })

  it('requires 204 for cancellation and revocation, with distinct exact-attempt and bearer headers', async () => {
    const b = bench()
    b.transport.mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json({ ok: true }))
    await b.client.cancel(b.secrets, attempt, signal())
    await b.client.revoke(b.secrets, signal())
    expect(b.transport.mock.calls[0]?.[0]).toContain(`/attempts/${attempt}/cancel`)
    expect(b.transport.mock.calls[0]?.[1]?.headers).toMatchObject({ 'X-Mantur-Attempt': b.secrets.attemptToken })
    expect(b.transport.mock.calls[1]?.[0]).toBe('https://auth.example/api/v1/native/session/revoke')
    expect(b.transport.mock.calls[1]?.[1]?.headers).toMatchObject({ Authorization: `Bearer ${b.secrets.credential}` })
    await expect(b.client.revoke(b.secrets, signal())).rejects.toMatchObject({ kind: 'protocol', status: 200 })
  })

  it('validates the exact installation and original server timestamps', async () => {
    const b = bench()
    const value = { status: 'active', credential_id: credential, device_instance_id: b.secrets.deviceInstanceId,
      client_id: 'mantur-agent', account, issued_at: '2029-10-03T00:00:00Z', expires_at: expires, last_used_at: '2029-10-04T00:00:00Z' }
    b.transport.mockResolvedValueOnce(Response.json(value))
      .mockResolvedValueOnce(Response.json({ ...value, device_instance_id: randomUUID() }))
      .mockResolvedValueOnce(Response.json({ ...value, expires_at: value.issued_at }))
    expect((await b.client.session(b.secrets, signal())).expires_at).toBe(Date.parse(expires))
    await expect(b.client.session(b.secrets, signal())).rejects.toMatchObject({ kind: 'protocol' })
    await expect(b.client.session(b.secrets, signal())).rejects.toMatchObject({ kind: 'protocol' })
  })

  it('keeps registration public and pending without Cookie or device authorization', async () => {
    const b = bench()
    b.transport.mockResolvedValueOnce(Response.json({ ok: true, expiresInSec: 600 }))
      .mockResolvedValueOnce(Response.json({ ok: true, tenantId: tenant, status: 'pending', initialBalance: 0, dataAccess: {} }, { status: 201 }))
    expect(await b.client.sendCode(account.email, signal())).toEqual({ ok: true, expiresInSec: 600 })
    expect(await b.client.register({ email: account.email, password: 'Transient registration', code: '123456' }, signal()))
      .toEqual({ ok: true, tenantId: tenant, status: 'pending' })
    for (const [, init] of b.transport.mock.calls) {
      expect(init?.headers).not.toHaveProperty('Authorization')
      expect(init?.headers).not.toHaveProperty('X-Mantur-Attempt')
      expect(init?.credentials).toBe('omit')
    }
  })

  it('exposes known error codes and server delays but never provider text or secrets', async () => {
    const b = bench()
    b.transport.mockResolvedValueOnce(Response.json({ error: 'RATE_LIMITED', retryAfterMs: 60_000, message: b.secrets.credential }, { status: 429 }))
      .mockResolvedValueOnce(Response.json({ error: 'RATE_LIMITED', retry_after_ms: 2_000, message: b.secrets.attemptToken }, { status: 429 }))
      .mockResolvedValueOnce(Response.json({ error: b.secrets.credential, message: 'Do not display this' }, { status: 401 }))
    const failure: unknown = await b.client.sendCode(account.email, signal()).catch((error: unknown) => error)
    expect(failure).toMatchObject({ kind: 'remote', code: 'RATE_LIMITED', status: 429, retryAfterMs: 60_000 })
    expect(JSON.stringify(failure)).not.toContain(b.secrets.credential)
    expect(String(failure)).not.toContain(b.secrets.credential)
    await expect(b.client.poll(b.secrets, attempt, signal())).rejects.toMatchObject({ kind: 'remote', retryAfterMs: 2_000 })
    await expect(b.client.poll(b.secrets, attempt, signal())).rejects.toMatchObject({ kind: 'protocol' })
  })

  it('treats a network failure as unknown, never expiry, and does not retry password requests', async () => {
    const b = bench()
    b.transport.mockRejectedValueOnce(new Error(`upstream printed ${b.secrets.credential}`))
    const failure: unknown = await b.client.password(b.secrets, attempt, { email: account.email, password: 'Transient', consent: true }, signal())
      .catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(NativeHttpFailure)
    expect(failure).toMatchObject({ kind: 'network', code: undefined })
    expect(String(failure)).not.toContain(b.secrets.credential)
    expect(b.transport).toHaveBeenCalledOnce()
  })

  it.each([
    'http://remote.example', 'https://auth.example/wrong', 'https://user:secret@auth.example',
    'https://auth.example/?secret=oops', 'https://auth.example/#oops', 'not a URL',
  ])('rejects unsafe deployment %s before any request', (origin) => {
    expect(() => bench(origin)).toThrow()
  })

  it('allows HTTP only for explicitly selected loopback test deployments and validates network budgets', () => {
    const b = bench('http://127.0.0.1:12345')
    expect(() => new NativeHttpClient({ ...b.options, environment: 'production' }, b.transport)).toThrow('HTTPS')
    expect(() => new NativeHttpClient({ ...b.options, timeoutMs: 0 }, b.transport)).toThrow('budgets')
    expect(() => new NativeHttpClient({ ...b.options, maxResponseBytes: 0 }, b.transport)).toThrow('budgets')
  })

  it('rejects cross-origin and cross-environment secret records without making a request', async () => {
    const b = bench()
    await expect(b.client.create({ ...b.secrets, origin: 'https://other.example' }, signal())).rejects.toThrow('different deployment')
    expect(() => b.client.revoke({ ...b.secrets, environment: 'production' }, signal())).toThrow('different deployment')
    expect(b.transport).not.toHaveBeenCalled()
  })

  it.each([
    'https://other.example/auth/agent?user_code=ABCD-EFGH',
    'https://auth.example/other?user_code=ABCD-EFGH',
    'https://auth.example/auth/agent?user_code=ABCD-EFGH&return_to=other',
    'https://auth.example/auth/agent?user_code=WRONG-CODE',
    'https://user:secret@auth.example/auth/agent?user_code=ABCD-EFGH',
    'https://auth.example/auth/agent?user_code=ABCD-EFGH#oops',
  ])('rejects unapproved browser URL %s', async (url) => {
    const b = bench()
    b.transport.mockResolvedValueOnce(Response.json({ ...createReceipt(), verification_uri_complete: url }))
    await expect(b.client.create(b.secrets, signal())).rejects.toMatchObject({ kind: 'protocol' })
  })

  it('rejects malformed JSON, oversized bodies and invalid UTF-8 without reflecting response contents', async () => {
    const b = bench()
    const cancel = vi.fn()
    const large = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(16_385)) }, cancel })
    b.transport.mockResolvedValueOnce(new Response(b.secrets.credential))
      .mockResolvedValueOnce(new Response(large))
      .mockResolvedValueOnce(new Response(new Uint8Array([0xff])))
    for (let i = 0; i < 3; i++) await expect(b.client.poll(b.secrets, attempt, signal())).rejects.toMatchObject({ kind: 'protocol' })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('rejects an already cancelled operation before invoking its transport', async () => {
    const b = bench()
    const controller = new AbortController()
    controller.abort(new Error(b.secrets.credential))
    await expect(b.client.create(b.secrets, controller.signal)).rejects.toMatchObject({ kind: 'cancelled' })
    expect(b.transport).not.toHaveBeenCalled()
  })

  it('does not follow a real HTTP redirect with the password or attempt token', async () => {
    let forwarded = 0
    const other = await listen((_request, response) => { forwarded++; response.end('{}') })
    const origin = await listen((_request, response) => { response.writeHead(307, { Location: `${other}/capture` }); response.end() })
    const b = bench(origin)
    const client = new NativeHttpClient(b.options, fetch)
    await expect(client.password(b.secrets, attempt, { email: account.email, password: 'Never forward', consent: true }, signal()))
      .rejects.toMatchObject({ kind: 'network' })
    expect(forwarded).toBe(0)
  })

  it('aborts a real in-flight response without exposing cancellation reasons', async () => {
    const entered = Promise.withResolvers<undefined>()
    const origin = await listen((_request, response) => { response.writeHead(200); response.write('{'); entered.resolve(undefined) })
    const b = bench(origin)
    const client = new NativeHttpClient(b.options, fetch)
    const controller = new AbortController()
    const result = client.poll(b.secrets, attempt, controller.signal)
    const rejected = expect(result).rejects.toMatchObject({ kind: 'cancelled' })
    await entered.promise
    controller.abort(new Error(b.secrets.credential))
    await rejected
  })
})
