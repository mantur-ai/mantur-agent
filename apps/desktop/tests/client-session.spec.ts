/** Isolated client-session gateway, encrypted storage and loopback lifecycle tests. */
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ClientSessionController } from '../src/auth/client-session-controller.ts'
import { ClientSessionStore, type ClientSession } from '../src/auth/client-session-store.ts'

const disposers: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const dispose of disposers.splice(0).reverse()) await dispose() })
const origin = 'https://hub.mantur.ai'
const cipher = {
  isAsyncEncryptionAvailable: async () => true,
  // Test cipher is deliberately non-OS and reversible; production receives Electron safeStorage.
  encryptStringAsync: async (text: string) => Buffer.from(Buffer.from(text).toString('base64')),
  decryptStringAsync: async (bytes: Buffer) => ({ result: Buffer.from(bytes.toString(), 'base64').toString(), shouldReEncrypt: false }),
}
async function fixture(stored?: ClientSession, handler?: (path: string, init: RequestInit) => unknown) {
  const root = await mkdtemp(join(tmpdir(), 'mantur-client-session-'))
  disposers.push(() => rm(root, { recursive: true, force: true }))
  const store = new ClientSessionStore(root, origin, cipher)
  if (stored) await store.save(stored)
  const calls: Array<{ path: string; init: RequestInit }> = []
  let redirect = '', state = ''
  const opened = Promise.withResolvers<string>()
  const fetcher: typeof fetch = async (input, init = {}) => {
    const path = new URL(input instanceof Request ? input.url : input).pathname
    calls.push({ path, init })
    let data: unknown = handler?.(path, init)
    if (path.endsWith('/sessions')) {
      const body = JSON.parse(typeof init.body === 'string' ? init.body : '{}') as { redirectUri: string; state: string; flow: string; codeChallenge: string }
      expect(body.flow).toBe('LOOPBACK'); expect(body.codeChallenge).toHaveLength(43)
      redirect = body.redirectUri; state = body.state
      expect(new URL(redirect).pathname).toBe('/callback')
      data ??= { flow: 'LOOPBACK', sessionId: 'session-1', authorizeUrl: origin + '/auth/client-authorize?session=session-1', expiresIn: 600 }
    } else if (path.endsWith('/token') || path.endsWith('/refresh')) {
      data ??= { accessToken: 'new-access-secret', refreshToken: 'new-refresh-secret', userId: 'user-1', nickname: '测试账号', expiresIn: 86400 }
    } else if (path === '/api/agent/v1/api-keys') {
      data ??= { id: 'key-1', plainSecret: 'key-secret', expiresAt: new Date(Date.now() + 86400000).toISOString() }
    }
    return Response.json({ code: 0, data })
  }
  const controller = new ClientSessionController(store, { origin, environment: 'production', timeoutMs: 1000, maxResponseBytes: 65536 },
    { environment: 'production', deviceName: 'test', platform: 'macos', now: Date.now, requestTimeoutMs: 1000,
      openBrowser: async (url) => { opened.resolve(url) } }, fetcher)
  disposers.push(() => controller.close())
  await controller.retryRevocations()
  return { root, store, controller, calls, opened: opened.promise,
    callback: async (override?: string) => fetch(redirect + '?' + new URLSearchParams({ state: override ?? state, code: 'one-time-code' }).toString()) }
}
const stored = (): ClientSession => ({ origin, userId: 'user-1', displayName: '用户', accessToken: 'old-access-secret',
  refreshToken: 'old-refresh-secret', expiresAt: Date.now() + 86400000 })
async function signedIn(f: Awaited<ReturnType<typeof fixture>>) {
  await f.controller.startBrowser(); expect(await f.opened).toBe(origin + '/auth/client-authorize?session=session-1')
  expect((await f.callback('wrong-state')).status).toBe(400)
  expect((await f.callback()).status).toBe(204)
  await expect.poll(() => f.controller.getSnapshot().authenticated).toBe(true)
}

describe('Main client-session authorization', () => {
  it('refuses an authorization URL for another deployment before opening the browser', async () => {
    const f = await fixture(undefined, path => path.endsWith('/sessions') ? {
      flow: 'LOOPBACK', sessionId: 'session-1', expiresIn: 600,
      authorizeUrl: 'http://localhost/auth/client-authorize?session=session-1',
    } : undefined)
    let opened = false
    void f.opened.then(() => { opened = true })
    await f.controller.startBrowser()
    await expect.poll(() => f.controller.getSnapshot().phase).toBe('failed')
    expect(opened).toBe(false)
    expect(await f.store.read()).toBeUndefined()
    expect(f.calls.some(call => call.path.endsWith('/token'))).toBe(false)
  })
  it('exchanges PKCE once, encrypts credentials, shares one call key and preserves browser identity', async () => {
    const f = await fixture(); await signedIn(f)
    const keys: string[] = []
    await Promise.all(Array.from({ length: 8 }, () => f.controller.withCredential(new AbortController().signal,
      async (secret) => { keys.push(secret.credential) })))
    expect(keys).toEqual(Array(8).fill('key-secret'))
    expect(f.calls.filter(c => c.path.endsWith('/token'))).toHaveLength(1)
    expect(f.calls.filter(c => c.path === '/api/agent/v1/api-keys')).toHaveLength(1)
    expect(JSON.stringify(f.controller.getSnapshot())).not.toMatch(/access-secret|refresh-secret|key-secret/)
    const files = await readdir(join(f.root, 'client-session'))
    const text = (await readFile(join(f.root, 'client-session', files[0]!))).toString()
    expect(text).not.toContain('new-access-secret')
    await f.controller.signOut()
    expect(await f.store.read()).toBeUndefined()
    expect(f.calls.some(c => c.path === '/api/agent/v1/api-keys/key-1' && c.init.method === 'DELETE')).toBe(true)
  })
  it('rotates an expiring account only once across concurrent commands', async () => {
    const f = await fixture({ ...stored(), expiresAt: Date.now() + 1000 })
    await Promise.all(Array.from({ length: 8 }, () => f.controller.withCredential(new AbortController().signal, async () => {})))
    expect(f.calls.filter(c => c.path.endsWith('/refresh'))).toHaveLength(1)
    expect((await f.store.read())?.refreshToken).toBe('new-refresh-secret')
  })
  it('waits for a running command to stop before completing logout', async () => {
    const f = await fixture(stored())
    const entered = Promise.withResolvers<undefined>()
    let stopped = false
    const command = f.controller.withCredential(new AbortController().signal, async (_key, signal) => {
      entered.resolve(undefined)
      await new Promise<void>((resolve) =>{  signal.addEventListener('abort', () => { stopped = true; resolve() }, { once: true }) })
    })
    await entered.promise
    await f.controller.signOut(); await command
    expect(stopped).toBe(true); expect(f.controller.getSnapshot().authenticated).toBe(false)
  })
  it('refuses repeated key creation after an incomplete response', async () => {
    const f = await fixture(stored(), path => path === '/api/agent/v1/api-keys' ? {} : undefined)
    await expect(f.controller.withCredential(new AbortController().signal, async () => {})).rejects.toThrow()
    await expect(f.controller.withCredential(new AbortController().signal, async () => {})).rejects.toThrow('key-creation-uncertain')
    expect(f.calls.filter(c => c.path === '/api/agent/v1/api-keys')).toHaveLength(1)
  })
  it('never writes a late encrypted account after cancellation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mantur-seal-cancel-'))
    disposers.push(() => rm(root, { recursive: true, force: true }))
    const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
    const store = new ClientSessionStore(root, origin, { ...cipher, encryptStringAsync: async (text) => {
      entered.resolve(undefined); await release.promise; return cipher.encryptStringAsync(text)
    } })
    const abort = new AbortController()
    const save = store.save(stored(), abort.signal)
    const rejection = expect(save).rejects.toThrow()
    await entered.promise; abort.abort(); release.resolve(undefined); await rejection
    expect(await store.read()).toBeUndefined()
  })
})
