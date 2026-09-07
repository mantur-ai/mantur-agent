// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeAccountBridge, NativeAccountReply } from '@deepseek-ai/dsh-authorization-manturhub/types'
import { NativeAccountClient } from '../src/client/native-account.ts'
import { createNativeAccountDialogStore, NativeAccountDialogController } from '../src/client/native-dialog.ts'

const cleanups: Array<() => void> = []
afterEach(() => { for (const close of cleanups.splice(0).reverse()) close() })
const signedOut = { phase: 'signed-out' as const, busy: false, authenticated: false, skipped: true, pendingRevocations: 0 }
const signedIn = { ...signedOut, phase: 'signed-in' as const, authenticated: true,
  account: { email: 'creator@example.com', expiresAt: 1_999_999_999_999 } }

function bench() {
  const invoke = vi.fn<NativeAccountBridge['invoke']>(async () => ({ ok: true, revision: 1, snapshot: signedOut }))
  const client = new NativeAccountClient({ invoke, subscribe: () => () => {} })
  client.store.set({ online: true, snapshot: signedOut })
  const canOpen = vi.fn(() => true)
  const dialog = new NativeAccountDialogController(client, canOpen)
  const view = createNativeAccountDialogStore().create()
  dialog.attach(view.actions)
  const close = dialog.connect()
  cleanups.push(close)
  return { client, invoke, canOpen, dialog, view, close }
}

describe('requested native account dialog', () => {
  it('coalesces openings and waits for a settled authenticated state, not an earlier persisted Skip', async () => {
    const b = bench()
    const request = b.dialog.open()
    expect(b.dialog.open()).toBe(request)
    expect(b.view.store.getSnapshot().open).toBe(true)
    b.client.store.set({ online: true, snapshot: { ...signedIn, busy: true } })
    b.client.store.set({ online: true, snapshot: signedIn, operation: 'password' })
    expect(b.view.store.getSnapshot().open).toBe(true)
    b.client.store.set({ online: true, snapshot: signedIn })
    expect(await request).toBe('authenticated')
    expect(b.view.store.getSnapshot().open).toBe(false)
    expect(await b.dialog.open()).toBe('authenticated')
    b.dialog.close()
  })

  it.each([false, true])('does not reopen or change the returned outcome after a late password result ok=%s', async (ok) => {
    const b = bench()
    const pending = Promise.withResolvers<NativeAccountReply>()
    b.invoke.mockReturnValueOnce(pending.promise)
    const request = b.dialog.open()
    const login = b.dialog.run({ kind: 'password', email: 'creator@example.com', password: 'transient', consent: true })
    b.dialog.close()
    expect(await request).toBe('closed')
    expect(b.view.store.getSnapshot().open).toBe(false)
    expect(() => b.dialog.open()).toThrow('already running')
    pending.resolve({ ok, revision: 2, snapshot: ok ? signedIn : signedOut, failure: { kind: 'remote', code: 'INVALID_CREDENTIALS' } })
    expect(await login).toEqual({ ok })
    expect(b.view.store.getSnapshot().open).toBe(false)
  })

  it('dismisses after an explicit successful Skip, but retains a failed Skip', async () => {
    const b = bench()
    b.invoke.mockResolvedValueOnce({ ok: false, revision: 1, snapshot: signedOut, failure: { kind: 'logout-storage' } })
      .mockResolvedValueOnce({ ok: true, revision: 2, snapshot: signedOut })
    const request = b.dialog.open()
    expect(await b.dialog.run({ kind: 'skip' })).toEqual({ ok: false })
    expect(b.view.store.getSnapshot().open).toBe(true)
    expect(await b.dialog.run({ kind: 'skip' })).toEqual({ ok: true })
    expect(await request).toBe('skipped')
    expect(b.view.store.getSnapshot().open).toBe(false)
  })

  it('keeps a dismissed Skip result from completing a different request', async () => {
    const b = bench()
    const pending = Promise.withResolvers<NativeAccountReply>()
    b.invoke.mockReturnValueOnce(pending.promise)
    const request = b.dialog.open()
    const skip = b.dialog.run({ kind: 'skip' })
    b.dialog.close()
    expect(await request).toBe('closed')
    pending.resolve({ ok: true, revision: 2, snapshot: signedOut })
    await skip
    expect(b.view.store.getSnapshot().open).toBe(false)
  })

  it('rejects unavailable and busy owners without replacing another modal', async () => {
    const b = bench()
    b.canOpen.mockReturnValue(false)
    expect(() => b.dialog.open()).toThrow('unavailable')
    b.canOpen.mockReturnValue(true)
    b.client.store.set({ online: true, snapshot: { ...signedOut, busy: true } })
    expect(() => b.dialog.open()).toThrow('already running')
    b.client.store.set({ online: true })
    const pending = b.dialog.open()
    const rejected = expect(pending).rejects.toThrow('unavailable')
    b.close()
    await rejected
    expect(() => b.dialog.open()).toThrow('unavailable')
    b.client.store.set({ online: true, snapshot: signedIn })
  })
})
