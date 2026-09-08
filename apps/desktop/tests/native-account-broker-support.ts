/** Isolated frozen native protocol and real loopback transport; OS encryption alone is substituted. */
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, onTestFinished } from 'vitest'
import { NativeCommandBroker, type NativeBrokerDescriptor } from '../src/auth/broker.ts'
import { NativeAccountController } from '../src/auth/controller.ts'
import { NativeHttpClient } from '../src/auth/http.ts'
import { nativeVerifier } from '../src/auth/protocol.ts'
import { NativeAccountStore } from '../src/auth/store.ts'
import { nativeTestCipher } from './native-account-test-support.ts'

/**
 * Start a private backend and the real controller/broker, without external account operations.
 * @param api - test-owned authenticated API endpoint handler.
 * @param leaseMs - command lease under test; the fixture's original device grant remains ninety days.
 * @returns owners and observed wire facts, cleaned up by the current test.
 */
export async function nativeBrokerBench(api: (request: IncomingMessage, response: ServerResponse) => void,
  leaseMs = 60_000) {
  const root = await mkdtemp(join(tmpdir(), 'mantur-native-broker-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const store = new NativeAccountStore(root, nativeTestCipher())
  onTestFinished(() => store.close())
  const id = randomUUID()
  const grantId = randomUUID()
  const account = { id: randomUUID(), display_name: 'Isolated account' }
  const now = { value: Date.now() }
  const expiry = new Date(now.value + 90 * 86_400_000).toISOString()
  const password = 'Isolated transient password 123!'
  let verifier: string | undefined
  let bearer: string | undefined
  let device: string | undefined
  let revoked = false
  let callback = ''
  let state = ''
  let challenge = ''
  const code = 'a'.repeat(43)
  const policy = randomUUID()
  const grant = () => ({ status: 'active', grant_id: grantId, grant_generation: 1,
    credential_expires_at: expiry, account, device_instance_id: device, issuer: origin, environment: 'test',
    authority: 'non_admin_api_key', policy_key: { id: policy, prefix: 'test', expires_at: null } })
  const openBrowser = async (url: string): Promise<void> => {
    const page = new URL(url)
    if (page.origin !== origin || page.pathname !== '/auth/client' || page.searchParams.get('state') !== state) {
      throw new Error('Wrong isolated authorization page')
    }
    const result = await fetch(callback + '?' + new URLSearchParams({ code, state, iss: origin }).toString())
    expect(result.status).toBe(204)
  }
  const observed: Array<{
    path: string
    authorization: string | undefined
    apiKey: string | string[] | undefined
    client: string | string[] | undefined
  }> = []
  const server = createServer((request, response) => {
    const send = (body: object, status = 200): void => {
      response.writeHead(status, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify(body))
    }
    if (request.url === '/api/v1/client-auth/attempts') {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => { chunks.push(chunk) })
      request.on('end', () => {
        const input = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          credential_verifier: string
          device_instance_id: string
          redirect_uri: string
          state: string
          code_challenge: string
        }
        verifier = input.credential_verifier
        device = input.device_instance_id
        callback = input.redirect_uri
        state = input.state
        challenge = input.code_challenge
        send({ status: 'pending', attempt_id: id,
          authorization_uri: origin + '/auth/client?' + new URLSearchParams({ attempt_id: id, state, iss: origin }).toString(),
          issuer: origin, environment: 'test', attempt_expires_at: new Date(now.value + 600_000).toISOString(),
          expires_in: 600 }, 201)
      })
    } else if (request.url === '/api/v1/client-auth/token') {
      const candidate = request.headers.authorization?.slice(7)
      if (candidate === undefined || nativeVerifier(candidate) !== verifier) { send({ error: 'INVALID_DEVICE_PROOF' }, 401); return }
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => { chunks.push(chunk) })
      request.on('end', () => {
        const input = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          code: string
          state: string
          code_verifier: string
          redirect_uri: string
        }
        if (input.code !== code || input.state !== state || nativeVerifier(input.code_verifier) !== challenge
          || input.redirect_uri !== callback) { send({ error: 'INVALID_CODE' }, 401); return }
        bearer = candidate
        revoked = false
        send(grant())
      })
    } else if (request.url === '/api/v1/client-auth/grants/revoke'
      || request.url === '/api/v1/client-auth/attempts/' + id + '/cancel') {
      revoked = true
      response.writeHead(204).end()
    } else if (request.url === '/api/v1/client-auth/session') {
      send({ ...grant(), last_verified_at: new Date(now.value).toISOString() })
    } else {
      observed.push({ path: request.url ?? '', authorization: request.headers.authorization,
        apiKey: request.headers['x-api-key'], client: request.headers['x-mantur-client'] })
      if (revoked || request.headers.authorization !== `Bearer ${String(bearer)}`) { send({ error: 'CREDENTIAL_INVALID' }, 401); return }
      api(request, response)
    }
  })
  onTestFinished(async () => {
    const closing = new Promise<void>((resolve, reject) => {
      server.close((error) => { if (error === undefined) resolve(); else reject(error) })
    })
    server.closeAllConnections()
    await closing
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Expected isolated TCP backend')
  const origin = `http://127.0.0.1:${String(address.port)}`
  const http = new NativeHttpClient({ origin, environment: 'test', timeoutMs: 10_000, maxResponseBytes: 16_384 }, fetch)
  const controller = new NativeAccountController(store, http, { environment: 'test', deviceName: 'Isolated broker test',
    platform: 'macos', now: () => now.value, openBrowser, requestTimeoutMs: 10_000 })
  onTestFinished(() => controller.close())
  const broker = new NativeCommandBroker(controller, { origin, environment: 'test', environmentLabel: 'Isolated broker test',
    requestTimeoutMs: 10_000, leaseMs, now: () => now.value }, fetch)
  onTestFinished(() => broker.close())
  await controller.startBrowser()
  await expect.poll(() => controller.getSnapshot().authenticated).toBe(true)
  return { root, controller, broker, store, origin, observed, now, expiry, password, openBrowser, bearer: () => bearer }
}

/**
 * Hold a real credential scope open across individual HTTP assertions.
 * @param broker - real Main broker under test.
 * @returns descriptor, cancellation signal and explicit command-cleanup barrier.
 */
export async function nativeBrokerScope(broker: NativeCommandBroker) {
  const entered = Promise.withResolvers<{ descriptor: NativeBrokerDescriptor; signal: AbortSignal }>()
  const release = Promise.withResolvers<undefined>()
  const done = broker.run(new AbortController().signal, async (descriptor, signal) => {
    entered.resolve({ descriptor, signal })
    await release.promise
  })
  void done.catch((error: unknown) => { entered.reject(error) })
  onTestFinished(async () => { release.resolve(undefined); await done.catch(() => {}) })
  return { ...await entered.promise, done, release: () => { release.resolve(undefined) } }
}

/** Local-only capability headers; the native bearer is never available from a descriptor. */
export function nativeBrokerHeaders(descriptor: NativeBrokerDescriptor): Record<string, string> {
  return { Authorization: `Bearer ${descriptor.bridge_secret}`, 'X-Mantur-Broker-Version': '2' }
}
