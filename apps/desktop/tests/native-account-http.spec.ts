/** Browser-account-v2 validation and secret-free failures at the HTTP boundary. */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { describe, expect, it, vi } from 'vitest'
import { NativeHttpClient, NativeHttpFailure, type NativeAttemptId } from '../src/auth/http.ts'
import { createNativeSecrets, nativeVerifier, type NativeDeviceId } from '../src/auth/protocol.ts'

const signal = (): AbortSignal => new AbortController().signal

function bench(origin = 'https://auth.example') {
  const options = { origin, environment: 'test' as const, timeoutMs: 10_000, maxResponseBytes: 16_384 }
  const transport = vi.fn<typeof fetch>()
  const client = new NativeHttpClient(options, transport)
  const secrets = { ...createNativeSecrets({ origin, environment: 'test', deviceInstanceId: randomUUID() as NativeDeviceId,
    deviceName: 'Isolated device', platform: 'macos', state: 's'.repeat(43),
    redirectUri: 'http://127.0.0.1:49152/oauth/mantur/callback' }), code: 'c'.repeat(43) }
  const attempt = randomUUID() as NativeAttemptId
  const receipt = { status: 'pending', attempt_id: attempt, issuer: origin, environment: 'test',
    authorization_uri: origin + '/auth/client?' + new URLSearchParams({ attempt_id: attempt, state: secrets.state, iss: origin }).toString(),
    attempt_expires_at: new Date(Date.now() + 600_000).toISOString(), expires_in: 600 }
  const grant = { status: 'active', grant_id: randomUUID(), grant_generation: 1, issuer: origin, environment: 'test',
    device_instance_id: secrets.deviceInstanceId, credential_expires_at: new Date(Date.now() + 90 * 86_400_000).toISOString(),
    account: { id: randomUUID(), display_name: 'Isolated account' }, authority: 'non_admin_api_key',
    policy_key: { id: randomUUID(), prefix: 'test', expires_at: null } }
  return { options, transport, client, secrets, attempt, receipt, grant }
}

describe('browser account HTTP', () => {
  it.each(['{"error":"NOT_FOUND"}', '<html>not found</html>'])('reports a missing create endpoint without exposing its body: %s', async (body) => {
    const b = bench()
    const cancel = vi.fn()
    b.transport.mockResolvedValueOnce(new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(body))
    }, cancel }), { status: 404 }))
    await expect(b.client.create(b.secrets, signal())).rejects.toMatchObject({ kind: 'endpoint-unavailable', status: 404 })
    expect(cancel).toHaveBeenCalledOnce()
    expect(b.transport).toHaveBeenCalledOnce()
  })

  it('keeps a missing attempt distinct from a missing create route', async () => {
    const b = bench()
    b.transport.mockResolvedValueOnce(Response.json({ error: 'ATTEMPT_NOT_FOUND' }, { status: 404 }))
    await expect(b.client.cancel(b.secrets, b.attempt, signal())).rejects.toMatchObject({ kind: 'remote', code: 'ATTEMPT_NOT_FOUND' })
  })

  it.each([599, 1, 0])('accepts an idempotent create receipt with %i remaining seconds', async (expiresIn) => {
    const b = bench()
    b.transport.mockResolvedValueOnce(Response.json({ ...b.receipt, expires_in: expiresIn }, { status: 200 }))
    const receipt = await b.client.create(b.secrets, signal())
    expect(receipt.expires_in).toBe(expiresIn)
    expect(receipt.attempt_expires_at).toBe(Date.parse(b.receipt.attempt_expires_at))
  })

  it.each([-1, 601, 599.5])('rejects a create receipt with invalid remaining lifetime %s', async (expiresIn) => {
    const b = bench()
    b.transport.mockResolvedValueOnce(Response.json({ ...b.receipt, expires_in: expiresIn }, { status: 200 }))
    await expect(b.client.create(b.secrets, signal())).rejects.toMatchObject({ kind: 'protocol' })
  })

  it('sends only device proof hashes during create and accepts only the exact authorization URL', async () => {
    const b = bench()
    b.transport.mockResolvedValueOnce(Response.json(b.receipt, { status: 201 }))
    await b.client.create(b.secrets, signal())
    const [url, request] = b.transport.mock.calls[0]!
    expect(url).toBe(b.options.origin + '/api/v1/client-auth/attempts')
    expect(JSON.parse(z.string().parse(request?.body))).toEqual({
      request_id: b.secrets.requestId, client_id: 'mantur-agent', device_instance_id: b.secrets.deviceInstanceId,
      device_name: b.secrets.deviceName, platform: 'macos', credential_verifier: nativeVerifier(b.secrets.credential),
      state: b.secrets.state, code_challenge: nativeVerifier(b.secrets.codeVerifier), code_challenge_method: 'S256',
      redirect_uri: b.secrets.redirectUri,
    })
    expect(request).toMatchObject({ redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' })
    expect(JSON.stringify(request)).not.toContain(b.secrets.credential)
    expect(JSON.stringify(request)).not.toContain(b.secrets.codeVerifier)
  })

  it.each(['issuer', 'environment', 'foreign-url', 'wrong-path', 'wrong-state', 'wrong-attempt', 'extra-query', 'duplicate-query', 'userinfo', 'fragment'])(
    'rejects create receipt mutation %s', async (mutation) => {
      const b = bench()
      const receipt = { ...b.receipt }
      const url = new URL(receipt.authorization_uri)
      if (mutation === 'issuer') receipt.issuer = 'https://other.example'
      if (mutation === 'environment') receipt.environment = 'production'
      if (mutation === 'foreign-url') url.hostname = 'other.example'
      if (mutation === 'wrong-path') url.pathname = '/auth/agent'
      if (mutation === 'wrong-state') url.searchParams.set('state', 'wrong')
      if (mutation === 'wrong-attempt') url.searchParams.set('attempt_id', randomUUID())
      if (mutation === 'extra-query') url.searchParams.set('key', 'never-forward')
      if (mutation === 'duplicate-query') url.searchParams.append('iss', b.options.origin)
      if (mutation === 'userinfo') url.username = 'hidden'
      if (mutation === 'fragment') url.hash = 'hidden'
      receipt.authorization_uri = url.href
      b.transport.mockResolvedValueOnce(Response.json(receipt))
      await expect(b.client.create(b.secrets, signal())).rejects.toMatchObject({ kind: 'protocol' })
    })

  it('replays exactly the same exchange after an unknown network result and never returns a new bearer', async () => {
    const b = bench()
    b.transport.mockRejectedValueOnce(new Error(b.secrets.credential)).mockResolvedValueOnce(Response.json(b.grant))
    await expect(b.client.exchange(b.secrets, b.attempt, signal())).rejects.toMatchObject({ kind: 'network' })
    const result = await b.client.exchange(b.secrets, b.attempt, signal())
    expect(b.transport.mock.calls[0]?.[1]?.body).toBe(b.transport.mock.calls[1]?.[1]?.body)
    expect(b.transport.mock.calls[1]?.[1]?.headers).toMatchObject({ Authorization: 'Bearer ' + b.secrets.credential })
    expect(JSON.parse(z.string().parse(b.transport.mock.calls[1]?.[1]?.body))).toEqual({
      exchange_request_id: b.secrets.exchangeRequestId, attempt_id: b.attempt, client_id: 'mantur-agent',
      device_instance_id: b.secrets.deviceInstanceId, code: b.secrets.code, state: b.secrets.state,
      code_verifier: b.secrets.codeVerifier, redirect_uri: b.secrets.redirectUri, issuer: b.options.origin,
    })
    expect(result).toMatchObject({ grant_generation: 1, credential_expires_at: Date.parse(b.grant.credential_expires_at) })
    expect(JSON.stringify(result)).not.toContain(b.secrets.credential)
  })

  it.each([
    { issuer: 'https://other.example' }, { environment: 'production' }, { device_instance_id: randomUUID() },
    { grant_generation: 0 }, { grant_generation: Number.MAX_SAFE_INTEGER + 1 }, { authority: 'admin' },
    { token: 'unexpected-secret' },
  ])('rejects mismatched or unsafe grant metadata %j', async (fields) => {
    const b = bench()
    b.transport.mockResolvedValueOnce(Response.json({ ...b.grant, ...fields }))
    await expect(b.client.exchange(b.secrets, b.attempt, signal())).rejects.toMatchObject({ kind: 'protocol' })
  })

  it.each(['GRANT_SUPERSEDED', 'GRANT_REVOKED', 'GRANT_EXPIRED', 'CODE_ALREADY_USED', 'POLICY_KEY_INACTIVE'])(
    'does not restore authority from an old receipt rejected with %s', async (code) => {
      const b = bench()
      b.transport.mockResolvedValueOnce(Response.json({ error: code, message: b.secrets.credential }, { status: 409 }))
      const error: unknown = await b.client.exchange(b.secrets, b.attempt, signal()).catch((value: unknown) => value)
      expect(error).toMatchObject({ kind: 'remote', code })
      expect(error).toBeInstanceOf(NativeHttpFailure)
      expect(String(error)).not.toContain(b.secrets.credential)
      expect(b.transport).toHaveBeenCalledOnce()
    })

  it('uses device proof for independent session, cancel and revoke, and never accepts a non-204 cleanup', async () => {
    const b = bench()
    b.transport.mockResolvedValueOnce(Response.json({ ...b.grant, last_verified_at: new Date().toISOString() }))
      .mockResolvedValueOnce(new Response(null, { status: 204 })).mockResolvedValueOnce(new Response(null, { status: 204 }))
    await b.client.session(b.secrets, signal())
    await b.client.cancel(b.secrets, b.attempt, signal())
    await b.client.revoke(b.secrets, signal())
    expect(b.transport.mock.calls.map(call => call[0])).toEqual([
      b.options.origin + '/api/v1/client-auth/session',
      b.options.origin + '/api/v1/client-auth/attempts/' + b.attempt + '/cancel',
      b.options.origin + '/api/v1/client-auth/grants/revoke',
    ])
    expect(b.transport.mock.calls[0]?.[1]?.headers).toMatchObject({ 'X-Mantur-Client': 'desktop' })
    for (const [, request] of b.transport.mock.calls) expect(request?.headers).toMatchObject({ Authorization: 'Bearer ' + b.secrets.credential })
    b.transport.mockResolvedValueOnce(Response.json({ ok: true }))
    await expect(b.client.revoke(b.secrets, signal())).rejects.toMatchObject({ kind: 'protocol' })
  })

  it.each(['http://localhost:49152/oauth/mantur/callback', 'http://[::1]:49152/oauth/mantur/callback',
    'http://127.0.0.1/oauth/mantur/callback', 'http://127.0.0.1:49152/wrong',
    'http://127.0.0.1:49152/oauth/mantur/callback?key=bad'])('refuses invalid redirect %s before transport', async (redirectUri) => {
    const b = bench()
    await expect(b.client.create({ ...b.secrets, redirectUri }, signal())).rejects.toMatchObject({ kind: 'protocol' })
    expect(b.transport).not.toHaveBeenCalled()
  })

  it('rejects a different configured deployment before attaching credentials', async () => {
    const b = bench()
    await expect(b.client.exchange({ ...b.secrets, origin: 'https://other.example' }, b.attempt, signal())).rejects.toThrow()
    expect(b.transport).not.toHaveBeenCalled()
  })

  it.each(['http://remote.example', 'https://auth.example/wrong', 'https://user:secret@auth.example',
    'https://auth.example/?secret=oops', 'https://auth.example/#oops', 'not a URL'])('rejects unsafe deployment %s', (origin) => {
    expect(() => bench(origin)).toThrow()
  })

  it('requires explicit test mode for loopback HTTP and positive resource budgets', () => {
    const b = bench('http://127.0.0.1:12345')
    expect(() => new NativeHttpClient({ ...b.options, environment: 'production' }, b.transport)).toThrow('HTTPS')
    expect(() => new NativeHttpClient({ ...b.options, timeoutMs: 0 }, b.transport)).toThrow('positive')
    expect(() => new NativeHttpClient({ ...b.options, maxResponseBytes: 0 }, b.transport)).toThrow('positive')
  })

  it('cancels an oversized body and redacts malformed JSON and unknown remote messages', async () => {
    const b = bench()
    const cancel = vi.fn()
    b.transport.mockResolvedValueOnce(new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array(b.options.maxResponseBytes + 1))
    }, cancel }))).mockResolvedValueOnce(new Response(b.secrets.credential))
      .mockResolvedValueOnce(Response.json({ error: b.secrets.credential }, { status: 500 }))
    for (let i = 0; i < 3; i++) await expect(b.client.create(b.secrets, signal())).rejects.toMatchObject({ kind: 'protocol' })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('does not start a request after cancellation and preserves recognized throttling without displaying messages', async () => {
    const b = bench()
    const abort = new AbortController()
    abort.abort()
    await expect(b.client.create(b.secrets, abort.signal)).rejects.toMatchObject({ kind: 'cancelled' })
    expect(b.transport).not.toHaveBeenCalled()
    b.transport.mockResolvedValueOnce(Response.json({ error: 'RATE_LIMITED', retry_after_ms: 1000,
      message: b.secrets.credential }, { status: 429 }))
    await expect(b.client.create(b.secrets, signal())).rejects.toMatchObject({ kind: 'remote', code: 'RATE_LIMITED', retryAfterMs: 1000 })
  })
})
