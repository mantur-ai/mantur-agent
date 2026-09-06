/** Native login state transitions with real encrypted SQLite and frozen HTTP validation, without real accounts or email. */
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NativeAccountController } from '../src/auth/controller.ts'
import { NativeHttpClient } from '../src/auth/http.ts'
import { NativeAccountStore } from '../src/auth/store.ts'
import { nativeTestCipher } from './native-account-test-support.ts'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
const credentials = { email: 'isolated@example.com', password: 'Isolated transient password 123!', consent: true as const }

async function bench() {
  const root = await mkdtemp(join(tmpdir(), 'mantur-auth-controller-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const cipher = nativeTestCipher()
  const store = new NativeAccountStore(root, cipher)
  cleanup.push(() => store.close())
  const transport = vi.fn<typeof fetch>()
  const http = new NativeHttpClient({ origin: 'https://auth.example', environment: 'test', timeoutMs: 10_000, maxResponseBytes: 16_384 }, transport)
  const options = { environment: 'test' as const, deviceName: 'Isolated test device', platform: 'macos' as const,
    now: () => Date.now(), openBrowser: vi.fn(async (_url: string) => {}) }
  const controller = new NativeAccountController(store, http, options)
  cleanup.push(() => controller.close())
  const attempt = randomUUID()
  const credential = randomUUID()
  const account = { id: randomUUID(), email: credentials.email, display_name: 'Isolated account' }
  const expires = new Date(Date.now() + 90 * 86_400_000).toISOString()
  const receipt = { status: 'pending', attempt_id: attempt, user_code: 'ABCD-EFGH', verification_uri: `${http.origin}/auth/agent`,
    verification_uri_complete: `${http.origin}/auth/agent?user_code=ABCD-EFGH`,
    attempt_expires_at: new Date(Date.now() + 600_000).toISOString(), expires_in: 600, poll_interval: 2 }
  const ready = { status: 'ready', credential_id: credential, expires_at: expires, account }
  const active = { status: 'active', credential_id: credential, expires_at: expires }
  function queue(...values: unknown[]) { for (const value of values) transport.mockResolvedValueOnce(Response.json(value)) }
  return { root, cipher, store, transport, http, options, controller, attempt, credential, account, expires, receipt, ready, active, queue }
}

describe('native account controller', () => {
  it('publishes locally blocked authority and a persistence error when logout cannot be saved, then permits an explicit retry', async () => {
    const b = await bench()
    b.queue(b.receipt, b.ready, b.active)
    await b.controller.password(credentials)
    const changed = vi.fn()
    b.controller.subscribe(changed)
    const write = vi.spyOn(b.store, 'disable').mockImplementationOnce(() => { throw new Error('Isolated logout write failure') })
    try {
      expect(() => b.controller.signOut()).toThrow('logout-storage')
      expect(() => b.controller.withCredential(new AbortController().signal, async () => {})).toThrow('signed out')
      expect(b.controller.getSnapshot()).toMatchObject({ authenticated: false, phase: 'failed', failure: { kind: 'logout-storage' } })
      expect(b.store.records(b.http.origin)).toMatchObject([{ phase: 'active' }])
      expect(b.transport).toHaveBeenCalledTimes(3)
      expect(changed).toHaveBeenCalledOnce()
    } finally { write.mockRestore() }
    b.transport.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await b.controller.signOut()
    expect(b.controller.getSnapshot()).toMatchObject({ authenticated: false, phase: 'signed-out', pendingRevocations: 0 })
    expect(b.controller.getSnapshot().failure).toBeUndefined()
    expect(b.store.records(b.http.origin)).toEqual([])
  })

  it('commits OS-sealed secrets before create and ready metadata before activation, without publishing a premature sign-in', async () => {
    const b = await bench()
    const activating = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<Response>()
    b.transport.mockImplementationOnce(async () => {
      expect(b.store.records(b.http.origin)).toMatchObject([{ phase: 'pending', metadata: {} }])
      expect(b.cipher.encryptStringAsync).toHaveBeenCalledOnce()
      return Response.json(b.receipt)
    }).mockResolvedValueOnce(Response.json(b.ready))
      .mockImplementationOnce(() => { activating.resolve(undefined); return release.promise })
    const login = b.controller.password(credentials)
    try {
      await activating.promise
      expect(b.controller.getSnapshot()).toMatchObject({ phase: 'authorizing', busy: true,
        account: { email: credentials.email, expiresAt: Date.parse(b.expires) } })
      expect(b.store.records(b.http.origin)).toMatchObject([{ phase: 'pending', metadata: { credential: { id: b.credential } } }])
      expect(() => b.controller.withCredential(new AbortController().signal, async () => {})).toThrow('signed out')
      release.resolve(Response.json(b.active))
      await login
    } finally { release.resolve(Response.json(b.active)); await login }
    expect(b.controller.getSnapshot()).toMatchObject({ phase: 'signed-in', busy: false, pendingRevocations: 0 })
    expect(JSON.stringify(b.controller.getSnapshot())).not.toContain(credentials.password)
    const bytes = await readFile(join(b.root, 'native-account/account.sqlite'))
    expect(bytes.includes(credentials.password)).toBe(false)
    expect(b.transport).toHaveBeenCalledTimes(3)
  })

  it('authorizes no network call when OS encryption fails', async () => {
    const b = await bench()
    b.cipher.isAsyncEncryptionAvailable.mockResolvedValueOnce(false)
    await expect(b.controller.password(credentials)).rejects.toMatchObject({ kind: 'local' })
    expect(b.transport).not.toHaveBeenCalled()
    expect(b.store.records(b.http.origin)).toEqual([])
    expect(b.controller.getSnapshot()).toMatchObject({ phase: 'failed', failure: { kind: 'local' } })
  })

  it('recovers a lost create response with the original request and then polls without replaying a password', async () => {
    const b = await bench()
    b.transport.mockRejectedValueOnce(new Error('isolated lost create response'))
    await expect(b.controller.password(credentials)).rejects.toMatchObject({ kind: 'network' })
    const id = b.store.records(b.http.origin)[0]?.requestId
    b.queue(b.receipt, { status: 'ready', next_action: 'activate', credential_id: b.credential,
      credential_expires_at: b.expires, account: b.account }, b.active)
    await b.controller.refresh()
    expect(b.transport.mock.calls[0]?.[1]?.body).toBe(b.transport.mock.calls[1]?.[1]?.body)
    expect(b.store.records(b.http.origin)).toMatchObject([{ requestId: id, phase: 'active' }])
    expect(b.transport.mock.calls.some(([url]) => typeof url === 'string' && url.endsWith('/password'))).toBe(false)
  })

  it('recovers a lost activation response after process restart using the same sealed grant and original expiry', async () => {
    const b = await bench()
    b.queue(b.receipt, b.ready)
    b.transport.mockRejectedValueOnce(new Error('isolated lost activation response'))
    await expect(b.controller.password(credentials)).rejects.toMatchObject({ kind: 'network' })
    expect(b.store.records(b.http.origin)[0]?.phase).toBe('pending')
    const originalBearer = new Headers(b.transport.mock.calls[2]?.[1]?.headers).get('Authorization')
    await b.controller.close()
    const restoredStore = new NativeAccountStore(b.root, b.cipher)
    cleanup.push(() => restoredStore.close())
    const restored = new NativeAccountController(restoredStore, b.http, b.options)
    cleanup.push(() => restored.close())
    b.queue(b.receipt, b.active)
    await restored.refresh()
    expect(restored.getSnapshot()).toMatchObject({ phase: 'signed-in', account: { expiresAt: Date.parse(b.expires) } })
    expect(new Headers(b.transport.mock.calls[4]?.[1]?.headers).get('Authorization')).toBe(originalBearer)
    expect(b.transport.mock.calls.filter(([url]) => typeof url === 'string' && url.endsWith('/password'))).toHaveLength(1)
  })

  it('persists Skip while encryption is still pending and prevents any later attempt creation', async () => {
    const b = await bench()
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<Buffer>()
    b.cipher.encryptStringAsync.mockImplementationOnce(() => { entered.resolve(undefined); return release.promise })
    const start = b.controller.startBrowser()
    const rejected = expect(start).rejects.toMatchObject({ kind: 'cancelled' })
    try {
      await entered.promise
      const skip = b.controller.skip()
      expect(b.store.skipped()).toBe(true)
      release.resolve(Buffer.from('never committed after cancellation'))
      await skip
    } finally { release.resolve(Buffer.from('never committed')); await rejected }
    expect(b.store.records(b.http.origin)).toEqual([])
    expect(b.transport).not.toHaveBeenCalled()
    expect(b.options.openBrowser).not.toHaveBeenCalled()
    expect(b.controller.getSnapshot()).toMatchObject({ phase: 'signed-out', skipped: true, busy: false })
  })

  it('cancels a racing activation locally and keeps the full encrypted grant lifetime when remote cancellation is offline', async () => {
    const b = await bench()
    b.queue(b.receipt, b.ready)
    const entered = Promise.withResolvers<undefined>()
    b.transport.mockImplementationOnce(async (_url, init) => new Promise((_resolve, reject) => {
      const signal = init?.signal
      if (signal === undefined || signal === null) throw new Error('Expected cancellation signal')
      signal.addEventListener('abort', () => { reject(new Error('isolated abort')) }, { once: true })
      entered.resolve(undefined)
    })).mockRejectedValueOnce(new Error('isolated offline cancellation'))
    const login = b.controller.password(credentials)
    const rejected = expect(login).rejects.toMatchObject({ kind: 'cancelled' })
    try { await entered.promise; await b.controller.signOut() }
    finally { await b.controller.close(); await rejected }
    const restored = new NativeAccountStore(b.root, b.cipher)
    cleanup.push(() => restored.close())
    expect(restored.records(b.http.origin)).toMatchObject([{ phase: 'pending-cancel',
      metadata: { credential: { expiresAt: Date.parse(b.expires) } } }])
    expect(b.transport.mock.calls[3]?.[0]).toBe(`${b.http.origin}/api/v1/native/auth/attempts/${b.attempt}/cancel`)
  })

  it.each([
    ['pending', 'authorizing'], ['ready', 'signed-in'], ['active', 'signed-in'],
    ['pending_activation', 'pending-activation'], ['link_required', 'link-required'],
    ['denied', 'failed'], ['cancelled', 'failed'],
  ] as const)('projects the %s server state without guessing activation', async (status, phase) => {
    const b = await bench()
    b.queue(b.receipt)
    await b.controller.startBrowser()
    const progress = status === 'ready' || status === 'active'
      ? { status, next_action: status === 'ready' ? 'activate' : 'none', credential_id: b.credential,
        credential_expires_at: b.expires, account: b.account }
      : status === 'pending' ? { status, next_action: 'wait_for_user', expires_in: 590 }
        : status === 'pending_activation' ? { status, next_action: 'wait_for_activation' }
          : status === 'link_required' ? { status, next_action: 'verify_existing_account_in_browser' }
            : { status, next_action: 'none', reason: 'ATTEMPT_CANCELLED' }
    b.queue(b.receipt, progress)
    if (status === 'ready' || status === 'active') b.queue(b.active)
    if (status === 'denied' || status === 'cancelled') await expect(b.controller.poll()).rejects.toThrow()
    else await b.controller.poll()
    expect(b.controller.getSnapshot().phase).toBe(phase)
    expect(b.options.openBrowser).toHaveBeenCalledOnce()
    expect(b.options.openBrowser).toHaveBeenCalledWith(b.receipt.verification_uri_complete)
  })

  it('rejects a changed receipt on recovery instead of accepting a renewed attempt deadline', async () => {
    const b = await bench()
    b.queue(b.receipt)
    await b.controller.startBrowser()
    b.queue({ ...b.receipt, attempt_expires_at: new Date(Date.parse(b.receipt.attempt_expires_at) + 1_000).toISOString() })
    await expect(b.controller.refresh()).rejects.toMatchObject({ kind: 'protocol' })
    expect(b.store.records(b.http.origin)[0]?.metadata.attempt?.expiresAt).toBe(Date.parse(b.receipt.attempt_expires_at))
  })

  it('distinguishes offline validation from a revoked device and blocks local use after an authoritative rejection', async () => {
    const b = await bench()
    b.queue(b.receipt, b.ready, b.active)
    await b.controller.password(credentials)
    b.transport.mockRejectedValueOnce(new Error('isolated offline validation'))
    await expect(b.controller.refresh()).rejects.toMatchObject({ kind: 'network' })
    expect(b.store.records(b.http.origin)[0]?.phase).toBe('active')
    expect(b.controller.getSnapshot()).toMatchObject({ phase: 'failed', failure: { kind: 'network' } })
    b.transport.mockResolvedValueOnce(Response.json({ error: 'CREDENTIAL_REVOKED', message: 'never displayed' }, { status: 401 }))
    await expect(b.controller.refresh()).rejects.toMatchObject({ kind: 'remote' })
    expect(b.store.records(b.http.origin)[0]?.phase).toBe('pending-revoke')
    expect(() => b.controller.withCredential(new AbortController().signal, async () => {})).toThrow('signed out')
  })

  it('keeps code delivery and pending registration independent of device login', async () => {
    const b = await bench()
    b.queue({ ok: true, expiresInSec: 600 })
    expect(await b.controller.sendCode(credentials.email)).toEqual({ ok: true, expiresInSec: 600 })
    b.transport.mockResolvedValueOnce(Response.json({ ok: true, status: 'pending', tenantId: b.account.id }, { status: 201 }))
    await b.controller.register({ email: credentials.email, password: credentials.password, code: '123456' })
    expect(b.controller.getSnapshot()).toMatchObject({ phase: 'pending-activation' })
    expect(b.store.records(b.http.origin)).toEqual([])
    expect(b.cipher.encryptStringAsync).not.toHaveBeenCalled()
  })

  it('closes before an OS operation finishes without late state delivery, a leaked handle or a first network request', async () => {
    const b = await bench()
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<Buffer>()
    b.cipher.encryptStringAsync.mockImplementationOnce(() => { entered.resolve(undefined); return release.promise })
    const listener = vi.fn()
    b.controller.subscribe(listener)
    const start = b.controller.startBrowser()
    const rejected = expect(start).rejects.toMatchObject({ kind: 'cancelled' })
    try {
      await entered.promise
      const closed = vi.fn()
      const closing = b.controller.close().then(closed)
      const calls = listener.mock.calls.length
      await Promise.resolve()
      expect(closed).not.toHaveBeenCalled()
      release.resolve(Buffer.from('never committed'))
      await closing
      expect(listener).toHaveBeenCalledTimes(calls)
      expect(closed).toHaveBeenCalledOnce()
      expect(() => b.controller.getSnapshot()).toThrow('closing')
    } finally { release.resolve(Buffer.from('never committed')); await rejected }
    expect(b.transport).not.toHaveBeenCalled()
  })
})
