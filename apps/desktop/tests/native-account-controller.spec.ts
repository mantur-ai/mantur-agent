/** Real loopback callback and encrypted SQLite with a controlled v2 issuer; no real website or account. */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NativeAccountController } from '../src/auth/controller.ts'
import { NativeHttpClient } from '../src/auth/http.ts'
import { NativeAccountStore } from '../src/auth/store.ts'
import { nativeTestCipher } from './native-account-test-support.ts'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); vi.restoreAllMocks() })

async function bench() {
  const root = await mkdtemp(join(tmpdir(), 'mantur-auth-controller-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const cipher = nativeTestCipher()
  const store = new NativeAccountStore(root, cipher)
  cleanup.push(() => store.close())
  const origin = 'https://auth.example'
  const attempt = randomUUID()
  const expiry = new Date(Date.now() + 90 * 86_400_000).toISOString()
  let createBody: { redirect_uri: string; state: string; device_instance_id: string } | undefined
  const controls = { failCreate: false, failCancel: false, failExchange: false,
    sessionCode: '', exchangeCode: '', attemptExpiry: Date.now() + 600_000 }
  const active = () => ({ status: 'active', grant_id: attempt, grant_generation: 1,
    device_instance_id: createBody?.device_instance_id, issuer: origin, environment: 'test',
    credential_expires_at: expiry, account: { id: attempt, display_name: 'Test creator' },
    authority: 'non_admin_api_key', policy_key: { id: attempt, prefix: 'test', expires_at: null } })
  const transport = vi.fn<typeof fetch>(async (url, init) => {
    const path = new URL(z.string().parse(url)).pathname
    if (path === '/api/v1/client-auth/attempts') {
      expect(store.records(origin)[0]?.phase).toMatch(/pending/u)
      expect(cipher.encryptStringAsync).toHaveBeenCalled()
      createBody = JSON.parse(z.string().parse(init?.body)) as typeof createBody
      if (controls.failCreate) throw new Error('Private lost create response')
      return Response.json({ status: 'pending', attempt_id: attempt, issuer: origin, environment: 'test',
        authorization_uri: origin + '/auth/client?' + new URLSearchParams({
          attempt_id: attempt, state: createBody!.state, iss: origin }).toString(),
        attempt_expires_at: new Date(controls.attemptExpiry).toISOString(), expires_in: 600 })
    }
    if (path === '/api/v1/client-auth/token') {
      expect(cipher.encryptStringAsync.mock.calls.length).toBeGreaterThanOrEqual(2)
      if (controls.failExchange) throw new Error('Private lost exchange response')
      if (controls.exchangeCode) return Response.json({ error: controls.exchangeCode }, { status: 409 })
      return Response.json(active())
    }
    if (path === '/api/v1/client-auth/session') {
      if (controls.sessionCode === 'network') throw new Error('Private offline')
      if (controls.sessionCode) return Response.json({ error: controls.sessionCode }, { status: 401 })
      return Response.json({ ...active(), last_verified_at: new Date().toISOString() })
    }
    if (path.endsWith('/cancel') || path.endsWith('/revoke')) {
      if (controls.failCancel) throw new Error('Private offline cancel')
      return new Response(null, { status: 204 })
    }
    throw new Error('Unexpected fixture request')
  })
  const http = new NativeHttpClient({ origin, environment: 'test', timeoutMs: 10_000, maxResponseBytes: 16_384 }, transport)
  const options = { environment: 'test' as const, deviceName: 'Isolated test device', platform: 'macos' as const,
    requestTimeoutMs: 10_000, now: () => Date.now(), openBrowser: vi.fn(async (_url: string) => {}), onAuthorized: vi.fn() }
  const controller = new NativeAccountController(store, http, options)
  cleanup.push(() => controller.close())
  const callbackUrl = (denied = false) => {
    if (createBody === undefined) throw new Error('Fixture attempt not created')
    return createBody.redirect_uri + '?' + new URLSearchParams({
      ...(denied ? { error: 'access_denied' } : { code: 'c'.repeat(43) }), state: createBody.state, iss: origin }).toString()
  }
  const callback = async (denied = false) => { expect((await fetch(callbackUrl(denied))).status).toBe(204) }
  const login = async () => {
    await controller.startBrowser()
    await callback()
    await expect.poll(() => controller.getSnapshot().authenticated).toBe(true)
    await expect.poll(() => controller.getSnapshot().busy).toBe(false)
  }
  return { root, store, cipher, origin, http, controls, options, controller, callback, callbackUrl, login, transport, expiry }
}

describe('browser account controller', () => {
  it('opens the browser before sign-in, seals the code before exchange, then focuses only after confirmation', async () => {
    const b = await bench()
    await b.controller.startBrowser()
    expect(b.controller.getSnapshot()).toMatchObject({ authenticated: false, phase: 'authorizing' })
    expect(b.options.onAuthorized).not.toHaveBeenCalled()
    const before = await b.store.secrets(b.store.records(b.origin)[0]!.requestId, 'authorize')
    expect(JSON.stringify(b.controller.getSnapshot())).not.toContain(before.state)
    await b.callback()
    await expect.poll(() => b.controller.getSnapshot().authenticated).toBe(true)
    expect(b.options.onAuthorized).toHaveBeenCalledOnce()
    expect(b.controller.getSnapshot().account?.displayName).toBe('Test creator')
    const bytes = await readFile(join(b.root, 'native-account/account.sqlite'))
    for (const secret of [before.state, before.codeVerifier, before.credential, 'c'.repeat(43)]) expect(bytes.includes(secret)).toBe(false)
  })

  it('keeps a live listener for reopening the same browser URL without a second create', async () => {
    const b = await bench()
    await expect(b.controller.reopenBrowser()).rejects.toMatchObject({ kind: 'resume-required' })
    await b.controller.startBrowser()
    await b.controller.reopenBrowser()
    expect(b.options.openBrowser.mock.calls[0]).toEqual(b.options.openBrowser.mock.calls[1])
    expect(b.transport).toHaveBeenCalledOnce()
    await b.controller.signOut()
    await expect(fetch(b.callbackUrl())).rejects.toThrow()
    expect(b.controller.getSnapshot()).toMatchObject({ authenticated: false, pendingRevocations: 0 })
  })

  it('recovers lost create with the original request and original listener without browser or identity fallback', async () => {
    const b = await bench()
    b.controls.failCreate = true
    await expect(b.controller.startBrowser()).rejects.toMatchObject({ kind: 'network' })
    const original = b.transport.mock.calls[0]?.[1]?.body
    await expect(b.controller.refresh()).rejects.toMatchObject({ kind: 'resume-required' })
    expect(b.transport).toHaveBeenCalledOnce()
    expect(b.options.openBrowser).not.toHaveBeenCalled()
    b.controls.failCreate = false
    await b.controller.startBrowser()
    expect(b.transport.mock.calls[1]?.[1]?.body).toBe(original)
    expect(b.options.openBrowser).toHaveBeenCalledOnce()
    await b.callback()
    await expect.poll(() => b.controller.getSnapshot().authenticated).toBe(true)
  })

  it('retries an exact encrypted exchange after response loss and process restart', async () => {
    const b = await bench()
    b.controls.failExchange = true
    await b.controller.startBrowser()
    await b.callback()
    await expect.poll(() => b.controller.getSnapshot().failure?.kind).toBe('network')
    expect(b.controller.getSnapshot().authenticated).toBe(false)
    const request = b.transport.mock.calls.find(([url]) => z.string().parse(url).endsWith('/token'))?.[1]
    await b.controller.close()
    const store = new NativeAccountStore(b.root, b.cipher)
    cleanup.push(() => store.close())
    const restored = new NativeAccountController(store, b.http, b.options)
    cleanup.push(() => restored.close())
    b.controls.failExchange = false
    await restored.refresh()
    const recovery = b.transport.mock.calls.filter(([url]) => z.string().parse(url).endsWith('/token')).at(-1)?.[1]
    expect(recovery?.body).toBe(request?.body)
    expect(recovery?.headers).toEqual(request?.headers)
    expect(restored.getSnapshot().authenticated).toBe(true)
    expect(b.options.openBrowser).toHaveBeenCalledOnce()
  })

  it('cancels an interrupted no-code attempt after restart instead of silently registering another port', async () => {
    const b = await bench()
    await b.controller.startBrowser()
    const original = b.store.records(b.origin)[0]!.requestId
    await b.controller.close()
    const store = new NativeAccountStore(b.root, b.cipher)
    cleanup.push(() => store.close())
    const restored = new NativeAccountController(store, b.http, b.options)
    cleanup.push(() => restored.close())
    await expect(restored.refresh()).rejects.toMatchObject({ kind: 'resume-required' })
    expect(store.records(b.origin)).toEqual([])
    expect(b.transport.mock.calls.filter(([url]) => z.string().parse(url).endsWith('/attempts'))).toHaveLength(1)
    const cancellation = b.transport.mock.calls.find(([url]) => z.string().parse(url).endsWith('/cancel'))?.[1]
    expect(JSON.parse(z.string().parse(cancellation?.body))).toMatchObject({ request_id: original })
    expect(b.options.openBrowser).toHaveBeenCalledOnce()
  })

  it('keeps an uncertain exchange cancellation encrypted beyond attempt expiry and rejects late callbacks', async () => {
    const b = await bench()
    b.controls.failExchange = true
    await b.controller.startBrowser()
    await b.callback()
    await expect.poll(() => b.controller.getSnapshot().failure?.kind).toBe('network')
    b.controls.failCancel = true
    await b.controller.signOut()
    const record = b.store.records(b.origin)[0]!
    expect(record).toMatchObject({ phase: 'pending-cancel', metadata: { exchangeStarted: true } })
    b.options.now = () => b.controls.attemptExpiry + 86_400_000
    await b.controller.retryRevocations()
    expect(b.store.records(b.origin)).toHaveLength(1)
    expect(b.controller.getSnapshot().authenticated).toBe(false)
    await expect(fetch(b.callbackUrl())).rejects.toThrow()
    b.controls.failCancel = false
    await b.controller.retryRevocations()
    expect(b.store.records(b.origin)).toEqual([])
  })

  it.each(['GRANT_SUPERSEDED', 'GRANT_REVOKED', 'GRANT_EXPIRED'])('does not activate an old receipt rejected with %s', async (code) => {
    const b = await bench()
    b.controls.exchangeCode = code
    await b.controller.startBrowser()
    await b.callback()
    await expect.poll(() => b.controller.getSnapshot().failure?.code).toBe(code)
    expect(b.controller.getSnapshot().authenticated).toBe(false)
    expect(b.options.onAuthorized).not.toHaveBeenCalled()
  })

  it('handles denial without exchange and prevents later callback authority', async () => {
    const b = await bench()
    await b.controller.startBrowser()
    await b.callback(true)
    await expect.poll(() => b.controller.getSnapshot().failure?.kind).toBe('denied')
    expect(b.store.records(b.origin)[0]?.phase).toBe('pending-cancel')
    expect(b.controller.getSnapshot().authenticated).toBe(false)
    expect(b.transport.mock.calls.some(([url]) => z.string().parse(url).endsWith('/token'))).toBe(false)
  })

  it('expires the owned listener without requiring a renderer timer', async () => {
    const b = await bench()
    b.controls.attemptExpiry = Date.now() + 120
    await b.controller.startBrowser()
    await expect.poll(() => b.controller.getSnapshot().failure?.kind).toBe('expired')
    expect(b.controller.getSnapshot().authenticated).toBe(false)
    await expect(fetch(b.callbackUrl())).rejects.toThrow()
  })

  it('distinguishes offline validation from authoritative revocation and absolute grant expiry', async () => {
    const b = await bench()
    await b.login()
    b.controls.sessionCode = 'network'
    await expect(b.controller.refresh()).rejects.toMatchObject({ kind: 'network' })
    expect(b.controller.getSnapshot().authenticated).toBe(true)
    b.controls.sessionCode = 'GRANT_REVOKED'
    await expect(b.controller.refresh()).rejects.toMatchObject({ kind: 'remote' })
    expect(b.controller.getSnapshot().authenticated).toBe(false)
    expect(() => b.controller.withCredential(new AbortController().signal, async () => {})).toThrow('signed out')
  })

  it('blocks local authority even when logout persistence fails, then retries the same revoke', async () => {
    const b = await bench()
    await b.login()
    vi.spyOn(b.store, 'disable').mockImplementationOnce(() => { throw new Error('Private disk failure') })
    expect(() => b.controller.signOut()).toThrow('logout-storage')
    expect(b.controller.getSnapshot()).toMatchObject({ authenticated: false, failure: { kind: 'logout-storage' } })
    await b.controller.signOut()
    expect(b.store.records(b.origin)).toEqual([])
  })

  it('joins a cancelled token request and never activates its late success', async () => {
    const b = await bench()
    const original = b.transport.getMockImplementation()!
    const entered = Promise.withResolvers<AbortSignal>()
    const release = Promise.withResolvers<Response>()
    b.transport.mockImplementation(async (url, init) => {
      if (z.string().parse(url).endsWith('/token')) {
        entered.resolve(init!.signal!)
        return release.promise
      }
      return original(url, init)
    })
    await b.controller.startBrowser()
    await b.callback()
    const signal = await entered.promise
    const complete = vi.fn()
    const logout = b.controller.signOut().then(complete)
    expect(signal.aborted).toBe(true)
    await Promise.resolve()
    expect(complete).not.toHaveBeenCalled()
    release.resolve(Response.json({ status: 'ignored after cancellation' }))
    await logout
    expect(b.controller.getSnapshot().authenticated).toBe(false)
    expect(b.options.onAuthorized).not.toHaveBeenCalled()
    expect(b.store.records(b.origin)).toEqual([])
  })

  it('waits for old command cleanup before opening a switched account authorization', async () => {
    const b = await bench()
    await b.login()
    const entered = Promise.withResolvers<AbortSignal>()
    const release = Promise.withResolvers<undefined>()
    const using = b.controller.withCredential(new AbortController().signal, async (_secrets, signal) => {
      entered.resolve(signal)
      await release.promise
    })
    const rejected = expect(using).rejects.toMatchObject({ name: 'AbortError' })
    const signal = await entered.promise
    const changing = b.controller.switchAccount()
    expect(signal.aborted).toBe(true)
    expect(b.controller.getSnapshot().authenticated).toBe(false)
    expect(b.options.openBrowser).toHaveBeenCalledOnce()
    release.resolve(undefined)
    await rejected
    await changing
    expect(b.options.openBrowser).toHaveBeenCalledTimes(2)
    expect(b.controller.getSnapshot()).toMatchObject({ authenticated: false, phase: 'authorizing' })
  })

  it('persists Skip during OS encryption and prevents the first network request after cancellation', async () => {
    const b = await bench()
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<Buffer>()
    b.cipher.encryptStringAsync.mockImplementationOnce(() => { entered.resolve(undefined); return release.promise })
    const start = b.controller.startBrowser()
    const rejected = expect(start).rejects.toMatchObject({ kind: 'cancelled' })
    await entered.promise
    const skip = b.controller.skip()
    release.resolve(Buffer.from('not committed'))
    await skip
    await rejected
    expect(b.store.skipped()).toBe(true)
    expect(b.store.records(b.origin)).toEqual([])
    expect(b.transport).not.toHaveBeenCalled()
  })
})
