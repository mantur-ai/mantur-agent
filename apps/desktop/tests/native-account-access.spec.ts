/** Real SQLite and network client with isolated transport barriers; not native Keychain/DPAPI or bundled CLI acceptance. */
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NativeAccountAccess } from '../src/auth/access.ts'
import { NativeHttpClient } from '../src/auth/http.ts'
import { createNativeSecrets, type NativeActiveMetadata, type NativeSecrets } from '../src/auth/protocol.ts'
import { NativeAccountStore } from '../src/auth/store.ts'
import { nativeTestCipher } from './native-account-test-support.ts'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
  vi.useRealTimers()
})
const freshSignal = (): AbortSignal => new AbortController().signal

async function bench() {
  const root = await mkdtemp(join(tmpdir(), 'mantur-auth-access-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const cipher = nativeTestCipher()
  const store = new NativeAccountStore(root, cipher)
  cleanup.push(() => store.close())
  const transport = vi.fn<typeof fetch>()
  const http = new NativeHttpClient({ origin: 'https://auth.example', environment: 'test', timeoutMs: 10_000, maxResponseBytes: 16_384 }, transport)
  const access = new NativeAccountAccess(store, http, () => Date.now())
  cleanup.push(() => access.close())
  const secrets = createNativeSecrets({ origin: http.origin, environment: 'test', deviceInstanceId: store.deviceInstanceId,
    deviceName: 'Isolated test device', platform: 'macos', state: 's'.repeat(43), redirectUri: 'http://127.0.0.1:49152/oauth/mantur/callback' })
  const metadata: NativeActiveMetadata = {
    attempt: { id: randomUUID(), expiresAt: Date.now() + 600_000 },
    credential: { id: randomUUID(), displayName: 'Isolated account', accountId: randomUUID(), policyKeyId: randomUUID(), generation: 1, expiresAt: Date.now() + 90 * 86_400_000 },
  }
  await store.savePending(secrets, () => {})
  return { root, cipher, store, transport, http, access, secrets, metadata }
}

describe('native account request and revocation lifetimes', () => {
  it('keeps logout pending until the accepted response body really stops, while rejecting new local requests immediately', async () => {
    const b = await bench()
    b.store.activate(b.secrets.requestId, b.metadata)
    const entered = Promise.withResolvers<AbortSignal>()
    const release = Promise.withResolvers<undefined>()
    const consuming = b.access.withCredential(freshSignal(), async (secrets, lifetime) => {
      expect(secrets).toEqual(b.secrets)
      entered.resolve(lifetime)
      await release.promise
    })
    const rejected = expect(consuming).rejects.toMatchObject({ name: 'AbortError' })
    try {
      const lifetime = await entered.promise
      const stopped = vi.fn()
      const disabling = b.access.disable(b.secrets.requestId).then(stopped)
      expect(lifetime.aborted).toBe(true)
      expect(b.store.records(b.http.origin)[0]?.phase).toBe('pending-revoke')
      expect(() => b.access.withCredential(freshSignal(), async () => {})).toThrow('signed out')
      await Promise.resolve()
      expect(stopped).not.toHaveBeenCalled()
      release.resolve(undefined)
      await disabling
      expect(stopped).toHaveBeenCalledOnce()
    } finally { release.resolve(undefined); await rejected }
  })

  it('does not expose decrypted credentials when logout interrupts OS decryption', async () => {
    const b = await bench()
    b.store.activate(b.secrets.requestId, b.metadata)
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<{ result: string; shouldReEncrypt: boolean }>()
    b.cipher.decryptStringAsync.mockImplementationOnce(() => { entered.resolve(undefined); return release.promise })
    const consume = vi.fn(async () => {})
    const reading = b.access.withCredential(freshSignal(), consume)
    const rejected = expect(reading).rejects.toThrow('disabled')
    try {
      await entered.promise
      const disabling = b.access.disable(b.secrets.requestId)
      release.resolve({ result: JSON.stringify(b.secrets), shouldReEncrypt: false })
      await disabling
    } finally { release.resolve({ result: JSON.stringify(b.secrets), shouldReEncrypt: false }); await rejected }
    expect(consume).not.toHaveBeenCalled()
  })

  it('retains offline logout across restart beyond seven days, then removes only on exact bearer 204', async () => {
    const b = await bench()
    b.store.activate(b.secrets.requestId, b.metadata)
    await b.access.disable(b.secrets.requestId)
    b.transport.mockRejectedValueOnce(new Error(`offline ${b.secrets.credential}`))
    expect(await b.access.retryRevocations()).toEqual({ revoked: 0, expired: 0, failures: [{ requestId: b.secrets.requestId, kind: 'network' }] })
    await b.access.close()
    await b.store.close()
    const restoredStore = new NativeAccountStore(b.root, b.cipher)
    cleanup.push(() => restoredStore.close())
    const restored = new NativeAccountAccess(restoredStore, b.http, () => b.metadata.attempt.expiresAt + 8 * 86_400_000)
    cleanup.push(() => restored.close())
    expect(() => restored.withCredential(freshSignal(), async () => {})).toThrow('signed out')
    b.transport.mockResolvedValueOnce(new Response(null, { status: 204 }))
    expect(await restored.retryRevocations()).toEqual({ revoked: 1, expired: 0, failures: [] })
    expect(b.transport.mock.calls[1]?.[1]?.headers).toMatchObject({ Authorization: `Bearer ${b.secrets.credential}` })
    expect(restoredStore.records(b.http.origin)).toEqual([])
  })

  it('removes disabled material at original credential expiry without requiring OS decryption or a network response', async () => {
    const b = await bench()
    b.store.activate(b.secrets.requestId, b.metadata)
    await b.access.disable(b.secrets.requestId)
    b.cipher.isAsyncEncryptionAvailable.mockResolvedValue(false)
    const expired = new NativeAccountAccess(b.store, b.http, () => b.metadata.credential.expiresAt)
    cleanup.push(() => expired.close())
    expect(await expired.retryRevocations()).toEqual({ revoked: 0, expired: 1, failures: [] })
    expect(b.transport).not.toHaveBeenCalled()
    expect(b.store.records(b.http.origin)).toEqual([])
  })

  it('retains a possibly active cancelled attempt for the full original grant lifetime, not the ten-minute attempt lifetime', async () => {
    const b = await bench()
    b.store.saveMetadata(b.secrets.requestId, b.metadata)
    await b.access.disable(b.secrets.requestId)
    const later = new NativeAccountAccess(b.store, b.http, () => b.metadata.attempt.expiresAt + 1)
    cleanup.push(() => later.close())
    b.transport.mockRejectedValueOnce(new Error('offline'))
    expect(await later.retryRevocations()).toMatchObject({ revoked: 0, expired: 0, failures: [{ kind: 'network' }] })
    expect(b.store.records(b.http.origin)[0]?.metadata.credential?.expiresAt).toBe(b.metadata.credential.expiresAt)
    expect(b.transport.mock.calls[0]?.[0]).toBe(`${b.http.origin}/api/v1/client-auth/attempts/${b.metadata.attempt.id}/cancel`)
  })

  it('recovers an unknown create response with the original persisted verifier request before cancelling that exact attempt', async () => {
    const b = await bench()
    await b.access.disable(b.secrets.requestId)
    b.transport.mockResolvedValueOnce(Response.json({ status: 'pending', attempt_id: b.metadata.attempt.id, issuer: b.http.origin, environment: 'test',
      authorization_uri: b.http.origin + '/auth/client?' + new URLSearchParams({ attempt_id: b.metadata.attempt.id, state: b.secrets.state, iss: b.http.origin }).toString(),
      attempt_expires_at: new Date(b.metadata.attempt.expiresAt).toISOString(), expires_in: 600 }, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    expect(await b.access.retryRevocations()).toEqual({ revoked: 1, expired: 0, failures: [] })
    const body = b.transport.mock.calls[0]?.[1]?.body
    if (typeof body !== 'string') throw new Error('Expected persisted create request')
    expect(JSON.parse(body)).toMatchObject({ request_id: b.secrets.requestId, device_instance_id: b.store.deviceInstanceId })
    expect(body).not.toContain(b.secrets.credential)
    expect(b.transport.mock.calls[1]?.[1]?.headers).toMatchObject({ Authorization: `Bearer ${b.secrets.credential}` })
  })

  it('never revokes a newer login while cleaning up an old record, and does not sweep another environment', async () => {
    const b = await bench()
    b.store.activate(b.secrets.requestId, b.metadata)
    await b.access.disable(b.secrets.requestId)
    const next = createNativeSecrets(b.secrets)
    await b.store.savePending(next, () => {})
    b.store.activate(next.requestId, { ...b.metadata, credential: { ...b.metadata.credential, id: randomUUID() } })
    const other = createNativeSecrets({ ...b.secrets, origin: 'https://other.example' })
    await b.store.savePending(other, () => {})
    b.store.disable(other.requestId)
    b.transport.mockResolvedValueOnce(new Response(null, { status: 204 }))
    expect(await b.access.retryRevocations()).toMatchObject({ revoked: 1 })
    const used = vi.fn(async (secrets: NativeSecrets) => { expect(secrets).toEqual(next) })
    await b.access.withCredential(freshSignal(), used)
    expect(used).toHaveBeenCalledOnce()
    expect(b.transport).toHaveBeenCalledTimes(1)
    expect(b.store.records(other.origin)).toMatchObject([{ phase: 'pending-cancel' }])
  })

  it('retains records and reports storage or protocol failures without treating them as revocation', async () => {
    const b = await bench()
    b.store.activate(b.secrets.requestId, b.metadata)
    await b.access.disable(b.secrets.requestId)
    b.cipher.isAsyncEncryptionAvailable.mockResolvedValueOnce(false)
    expect(await b.access.retryRevocations()).toMatchObject({ revoked: 0, failures: [{ kind: 'storage' }] })
    b.transport.mockResolvedValueOnce(Response.json({ ok: true }))
    expect(await b.access.retryRevocations()).toMatchObject({ revoked: 0, failures: [{ kind: 'protocol' }] })
    expect(b.store.records(b.http.origin)).toHaveLength(1)
  })

  it('aborts an in-flight request exactly at original expiry and forbids subsequent use', async () => {
    const b = await bench()
    vi.useFakeTimers()
    b.store.activate(b.secrets.requestId, { ...b.metadata, credential: { ...b.metadata.credential, expiresAt: Date.now() + 1_000 } })
    const entered = Promise.withResolvers<AbortSignal>()
    const release = Promise.withResolvers<undefined>()
    const consuming = b.access.withCredential(freshSignal(), async (_secrets, lifetime) => {
      entered.resolve(lifetime)
      await release.promise
    })
    const rejected = expect(consuming).rejects.toMatchObject({ name: 'AbortError' })
    try {
      const lifetime = await entered.promise
      await vi.advanceTimersByTimeAsync(999)
      expect(lifetime.aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(lifetime.aborted).toBe(true)
      expect(() => b.access.withCredential(freshSignal(), async () => {})).toThrow('expired')
    } finally { release.resolve(undefined); await rejected }
    expect(vi.getTimerCount()).toBe(0)
  })

  it('closes revocation ownership to quiescence without losing pending material', async () => {
    const b = await bench()
    b.store.activate(b.secrets.requestId, b.metadata)
    await b.access.disable(b.secrets.requestId)
    const entered = Promise.withResolvers<undefined>()
    b.transport.mockImplementationOnce(async (_url, init) => new Promise((_resolve, reject) => {
      const signal = init?.signal
      if (signal === undefined || signal === null) throw new Error('Expected owned signal')
      signal.addEventListener('abort', () => { reject(new Error('aborted isolated transport')) }, { once: true })
      entered.resolve(undefined)
    }))
    const sweep = b.access.retryRevocations()
    expect(b.access.retryRevocations()).toBe(sweep)
    await entered.promise
    const closed = b.access.close()
    expect(b.access.close()).toBe(closed)
    expect(() => b.access.retryRevocations()).toThrow('closing')
    expect(() => b.access.withCredential(freshSignal(), async () => {})).toThrow('closing')
    await closed
    expect(await sweep).toMatchObject({ revoked: 0, failures: [{ kind: 'cancelled' }] })
    expect(b.store.records(b.http.origin)).toHaveLength(1)
  })

  it('waits for response consumption during Host close, not merely for abort dispatch', async () => {
    const b = await bench()
    b.store.activate(b.secrets.requestId, b.metadata)
    const entered = Promise.withResolvers<AbortSignal>()
    const release = Promise.withResolvers<undefined>()
    const consuming = b.access.withCredential(freshSignal(), async (_secrets, lifetime) => {
      entered.resolve(lifetime)
      await release.promise
    })
    const rejected = expect(consuming).rejects.toMatchObject({ name: 'AbortError' })
    try {
      const lifetime = await entered.promise
      const settled = vi.fn()
      const closing = b.access.close().then(settled)
      expect(lifetime.aborted).toBe(true)
      await Promise.resolve()
      expect(settled).not.toHaveBeenCalled()
      release.resolve(undefined)
      await closing
      expect(settled).toHaveBeenCalledOnce()
      expect(b.store.records(b.http.origin)[0]?.phase).toBe('active')
    } finally { release.resolve(undefined); await rejected }
  })

  it('honors command cancellation without signing out the account or retaining its expiry timer', async () => {
    const b = await bench()
    vi.useFakeTimers()
    b.store.activate(b.secrets.requestId, b.metadata)
    const command = new AbortController()
    const entered = Promise.withResolvers<AbortSignal>()
    const release = Promise.withResolvers<undefined>()
    const consuming = b.access.withCredential(command.signal, async (_secrets, lifetime) => {
      entered.resolve(lifetime)
      await release.promise
    })
    const rejected = expect(consuming).rejects.toMatchObject({ name: 'AbortError' })
    try {
      const lifetime = await entered.promise
      command.abort()
      expect(lifetime.aborted).toBe(true)
    } finally { release.resolve(undefined); await rejected }
    expect(vi.getTimerCount()).toBe(0)
    expect(b.store.records(b.http.origin)[0]?.phase).toBe('active')
    expect(() => b.access.withCredential(command.signal, async () => {})).toThrow()
  })

  it('does not renew or expire a ninety-day credential when a Node timer reaches its maximum delay', async () => {
    const b = await bench()
    vi.useFakeTimers()
    b.store.activate(b.secrets.requestId, b.metadata)
    const started = Date.now()
    const entered = Promise.withResolvers<AbortSignal>()
    const release = Promise.withResolvers<undefined>()
    const consuming = b.access.withCredential(freshSignal(), async (_secrets, lifetime) => {
      entered.resolve(lifetime)
      await release.promise
    })
    const rejected = expect(consuming).rejects.toMatchObject({ name: 'AbortError' })
    try {
      const lifetime = await entered.promise
      await vi.advanceTimersByTimeAsync(2_147_483_647)
      expect(lifetime.aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(b.metadata.credential.expiresAt - started - 2_147_483_647)
      expect(lifetime.aborted).toBe(true)
      expect(b.store.records(b.http.origin)[0]?.metadata.credential?.expiresAt).toBe(b.metadata.credential.expiresAt)
    } finally { release.resolve(undefined); await rejected }
    expect(vi.getTimerCount()).toBe(0)
  })

  it('blocks local requests even if the logout transaction fails, while reporting that persistence failure', async () => {
    const b = await bench()
    b.store.activate(b.secrets.requestId, b.metadata)
    const disable = vi.spyOn(b.store, 'disable').mockImplementationOnce(() => { throw new Error('Isolated disk write failure') })
    try {
      expect(() => b.access.disable(b.secrets.requestId)).toThrow('disk write failure')
      expect(() => b.access.withCredential(freshSignal(), async () => {})).toThrow('signed out')
      expect(b.store.records(b.http.origin)[0]?.phase).toBe('active')
    } finally { disable.mockRestore() }
    await b.access.disable(b.secrets.requestId)
    expect(b.store.records(b.http.origin)[0]?.phase).toBe('pending-revoke')
  })
})
