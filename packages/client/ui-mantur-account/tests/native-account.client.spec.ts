// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeAccountBridge, NativeAccountReply, NativeAccountSnapshot } from '@deepseek-ai/dsh-authorization-manturhub/types'
import { NativeAccountClient } from '../src/client/native-account.ts'

const cleanups: Array<() => void> = []
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })
const signedOut: NativeAccountSnapshot = { phase: 'signed-out', authenticated: false, busy: false, skipped: false, pendingRevocations: 0 }
const signedIn: NativeAccountSnapshot = { ...signedOut, phase: 'signed-in', authenticated: true,
  account: { displayName: 'Test creator', expiresAt: 1_999_999_999_999 } }
const authorizing = (): NativeAccountSnapshot => ({ ...signedOut, phase: 'authorizing',
  attempt: { expiresAt: Date.now() + 600_000 } })

function bench() {
  let listener: (value: unknown) => void = () => {}
  let revision = 0
  const unsubscribe = vi.fn()
  const invoke = vi.fn<NativeAccountBridge['invoke']>(async () => ({ ok: true, revision: ++revision, snapshot: signedOut }))
  const bridge: NativeAccountBridge = { invoke, subscribe: (value) => { listener = value; return unsubscribe } }
  const client = new NativeAccountClient(bridge)
  function connect() { const dispose = client.connect(); cleanups.push(dispose); return dispose }
  return { client, invoke, connect, unsubscribe, publish: (value: unknown) => { listener(value) } }
}

async function settle(): Promise<void> { await Promise.resolve(); await Promise.resolve() }

describe('native account renderer state', () => {
  it('suppresses a superseded failure reply after a newer signed-in publication', async () => {
    const b = bench()
    const first = Promise.withResolvers<NativeAccountReply>()
    b.invoke.mockReturnValueOnce(first.promise)
    b.connect()
    b.publish({ revision: 3, snapshot: signedIn })
    first.resolve({ ok: false, revision: 1, snapshot: { ...signedOut, failure: { kind: 'remote', code: 'INVALID_CREDENTIALS' } } })
    await settle()
    expect(b.client.store.getSnapshot()).toEqual({ online: true, snapshot: signedIn, operation: undefined, failure: undefined })
  })

  it.each([2, 3])('accepts an action result only for a reply not superseded by revision 3: %s', async (revision) => {
    const b = bench()
    b.connect()
    await settle()
    const reply = Promise.withResolvers<NativeAccountReply>()
    b.invoke.mockReturnValueOnce(reply.promise)
    const request = b.client.run({ kind: 'refresh' })
    b.publish({ revision: 3, snapshot: signedOut })
    reply.resolve({ ok: true, revision, snapshot: signedOut })
    expect(await request).toEqual(revision === 3 ? { ok: true } : { ok: false })
    expect(b.client.store.getSnapshot().failure).toBeUndefined()
  })

  it.each([false, true])('keeps a replacement account when the previous account reply arrives with ok=%s', async (ok) => {
    const b = bench()
    b.connect()
    await settle()
    b.publish({ revision: 2, snapshot: signedIn })
    const pending = Promise.withResolvers<NativeAccountReply>()
    b.invoke.mockReturnValueOnce(pending.promise)
    const request = b.client.run({ kind: 'refresh' })
    const replacement = { ...signedIn, account: { ...signedIn.account!, displayName: 'Replacement creator' } }
    b.publish({ revision: 4, snapshot: replacement })
    pending.resolve({ ok, revision: 3, snapshot: signedIn, failure: { kind: 'remote', code: 'INVALID_CREDENTIALS' } })
    expect(await request).toEqual({ ok: false })
    expect(b.client.store.getSnapshot()).toEqual({ online: true, snapshot: replacement, operation: undefined, failure: undefined })
  })

  it.each([false, true])('gives sign-out ownership over a late browser reply with ok=%s regardless of its revision', async (ok) => {
    const b = bench()
    const browser = Promise.withResolvers<NativeAccountReply>()
    const logout = Promise.withResolvers<NativeAccountReply>()
    b.invoke.mockReturnValueOnce(browser.promise).mockReturnValueOnce(logout.promise)
    const login = b.client.run({ kind: 'browser' })
    const signOut = b.client.run({ kind: 'sign-out' })
    browser.resolve({ ok, revision: 10, snapshot: signedIn, failure: { kind: 'remote', code: 'INVALID_CREDENTIALS' } })
    expect(await login).toEqual({ ok: false })
    expect(b.client.store.getSnapshot()).toEqual({ online: true, operation: 'sign-out', failure: undefined })
    logout.resolve({ ok: true, revision: 3, snapshot: signedOut })
    expect(await signOut).toEqual({ ok: true })
    expect(b.client.store.getSnapshot()).toEqual({ online: true, snapshot: signedOut, operation: undefined, failure: undefined })
  })

  it.each([2, 3])('preserves a current request failure at revision %s after publication revision 2', async (revision) => {
    const b = bench()
    b.connect()
    await settle()
    const pending = Promise.withResolvers<NativeAccountReply>()
    b.invoke.mockReturnValueOnce(pending.promise)
    const request = b.client.run({ kind: 'browser' })
    b.publish({ revision: 2, snapshot: signedOut })
    const failure = { kind: 'remote', code: 'INVALID_CREDENTIALS' }
    pending.resolve({ ok: false, revision, failure })
    expect(await request).toEqual({ ok: false })
    expect(b.client.store.getSnapshot()).toEqual({ online: true, snapshot: signedOut, operation: undefined, failure })
  })

  it('subscribes before the first check and rejects stale replies and duplicate publications', async () => {
    const b = bench()
    const first = Promise.withResolvers<NativeAccountReply>()
    b.invoke.mockReturnValueOnce(first.promise)
    b.connect()
    expect(b.invoke).toHaveBeenCalledWith({ kind: 'refresh' })
    b.publish({ revision: 3, snapshot: signedIn })
    b.publish({ revision: 2, snapshot: signedOut })
    b.publish({ revision: 3, snapshot: signedOut })
    first.resolve({ ok: true, revision: 1, snapshot: signedOut })
    await settle()
    expect(b.client.store.getSnapshot()).toEqual({ online: true, snapshot: signedIn, operation: undefined, failure: undefined })
  })

  it('does not expose a password and supersedes its late settlement with persisted Skip', async () => {
    const b = bench()
    const browser = Promise.withResolvers<NativeAccountReply>()
    b.invoke.mockReturnValueOnce(browser.promise)
      .mockResolvedValueOnce({ ok: true, revision: 3, snapshot: { ...signedOut, skipped: true } })
    const login = b.client.run({ kind: 'browser' })
    expect(JSON.stringify(b.client.store.getSnapshot())).not.toContain('private-canary')
    expect(await b.client.run({ kind: 'browser' })).toEqual({ ok: false })
    await b.client.run({ kind: 'skip' })
    browser.resolve({ ok: true, revision: 1, snapshot: signedIn })
    expect(await login).toEqual({ ok: false })
    expect(b.client.store.getSnapshot().snapshot).toEqual({ ...signedOut, skipped: true })
    expect(b.invoke).toHaveBeenCalledTimes(2)
  })

  it('retains the account during an offline failure and uses the precise Main error instead of a generic reply classification', async () => {
    const b = bench()
    b.invoke.mockResolvedValue({ ok: false, revision: 1, snapshot: { ...signedIn, phase: 'failed', failure: { kind: 'network' } }, failure: { kind: 'local' } })
    expect(await b.client.run({ kind: 'refresh' })).toEqual({ ok: false })
    expect(b.client.store.getSnapshot()).toMatchObject({ snapshot: { authenticated: true }, failure: { kind: 'network' } })
  })

  it('reports unavailable capability without using a legacy account source', async () => {
    const client = new NativeAccountClient(undefined)
    const dispose = client.connect()
    expect(client.store.getSnapshot().failure).toEqual({ kind: 'unavailable' })
    expect(await client.run({ kind: 'browser' })).toEqual({ ok: false })
    dispose()
    expect(await client.run({ kind: 'skip' })).toEqual({ ok: false })
  })

  it.each([
    null,
    { ok: true, revision: 1 },
    { ok: true, revision: 1, snapshot: { ...signedIn, account: undefined } },
    { ok: true, revision: 1, snapshot: { ...signedIn, account: { displayName: 'Test creator', expiresAt: 1e20 } } },
    { ok: true, revision: 1, snapshot: signedIn, credential: 'private-canary' },
  ])('rejects an invalid or secret-bearing IPC reply %#', async (value) => {
    const b = bench()
    b.invoke.mockResolvedValue(value)
    expect(await b.client.run({ kind: 'snapshot' })).toEqual({ ok: false })
    expect(b.client.store.getSnapshot()).toMatchObject({ failure: { kind: 'protocol' } })
    expect(b.client.store.getSnapshot().snapshot).toBeUndefined()
    expect(JSON.stringify(b.client.store.getSnapshot())).not.toContain('private-canary')
  })

  it('keeps only the fixed IPC failure classification and ignores errors after disposal', async () => {
    const b = bench()
    b.invoke.mockRejectedValueOnce(new Error('private transport detail'))
    expect(await b.client.run({ kind: 'refresh' })).toEqual({ ok: false })
    expect(b.client.store.getSnapshot().failure).toEqual({ kind: 'transport' })
    const pending = Promise.withResolvers<unknown>()
    b.invoke.mockReturnValueOnce(pending.promise)
    const dispose = b.connect()
    dispose()
    const state = b.client.store.getSnapshot()
    pending.reject(new Error('late private detail'))
    b.publish({ revision: 5, snapshot: signedIn })
    b.publish({ invalid: true })
    await settle()
    expect(b.client.store.getSnapshot()).toBe(state)
    expect(b.unsubscribe).toHaveBeenCalledOnce()
  })

  it('does not let a rejected older action replace a newer cancellation', async () => {
    const b = bench()
    const pending = Promise.withResolvers<unknown>()
    b.invoke.mockReturnValueOnce(pending.promise)
    const start = b.client.run({ kind: 'browser' })
    await b.client.run({ kind: 'sign-out' })
    pending.reject(new Error('late rejection'))
    await start
    expect(b.client.store.getSnapshot().failure).toBeUndefined()
  })

  it('maps a snapshot-less action rejection and rejects a missing error classification', async () => {
    const b = bench()
    b.invoke.mockResolvedValueOnce({ ok: false, revision: 0, failure: { kind: 'unavailable' } })
      .mockResolvedValueOnce({ ok: false, revision: 0 })
    await b.client.run({ kind: 'refresh' })
    expect(b.client.store.getSnapshot().failure).toEqual({ kind: 'unavailable' })
    await b.client.run({ kind: 'refresh' })
    expect(b.client.store.getSnapshot().failure).toEqual({ kind: 'protocol' })
  })

  it('leaves callback, expiry and exchange to Main without a renderer poll timer', async () => {
    vi.useFakeTimers()
    const b = bench()
    b.invoke.mockResolvedValueOnce({ ok: true, revision: 1, snapshot: authorizing() })
    const dispose = b.connect()
    await settle()
    await vi.advanceTimersByTimeAsync(610_000)
    expect(b.invoke).toHaveBeenCalledTimes(1)
    b.publish({ revision: 2, snapshot: { ...signedOut, phase: 'failed', failure: { kind: 'expired' } } })
    expect(b.client.store.getSnapshot().failure).toEqual({ kind: 'expired' })
    dispose()
    b.publish({ revision: 3, snapshot: signedIn })
    expect(b.client.store.getSnapshot().snapshot?.authenticated).toBe(false)
  })

  it('retries only retained revocations after reconnect, without submitting a login', async () => {
    const b = bench()
    b.invoke.mockResolvedValueOnce({ ok: true, revision: 1, snapshot: { ...signedOut, pendingRevocations: 1 } })
      .mockResolvedValueOnce({ ok: true, revision: 2, snapshot: signedOut })
    const dispose = b.connect()
    await settle()
    const online = vi.spyOn(navigator, 'onLine', 'get')
    online.mockReturnValue(false)
    window.dispatchEvent(new Event('offline'))
    expect(b.client.store.getSnapshot().online).toBe(false)
    online.mockReturnValue(true)
    window.dispatchEvent(new Event('online'))
    expect(b.invoke).toHaveBeenLastCalledWith({ kind: 'retry-revocations' })
    await settle()
    window.dispatchEvent(new Event('online'))
    expect(b.invoke).toHaveBeenCalledTimes(2)
    dispose()
    window.dispatchEvent(new Event('offline'))
    expect(b.client.store.getSnapshot().online).toBe(true)
  })
})
