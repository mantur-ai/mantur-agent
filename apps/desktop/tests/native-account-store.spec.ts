/** Real private SQLite transactions with only the OS cipher substituted; not native Keychain/DPAPI acceptance. */
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { createNativeSecrets, nativeVerifier, parseNativeSecrets, type NativeActiveMetadata } from '../src/auth/protocol.ts'
import { NativeAccountStore, type NativeCipher } from '../src/auth/store.ts'
import { nativeTestCipher } from './native-account-test-support.ts'

const roots: string[] = []
const stores: NativeAccountStore[] = []
afterEach(async () => {
  await Promise.all(stores.splice(0).map(store => store.close()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function open(root: string, cipher: NativeCipher) {
  const store = new NativeAccountStore(root, cipher)
  stores.push(store)
  return store
}

async function bench() {
  const root = await mkdtemp(join(tmpdir(), 'mantur-auth-store-'))
  roots.push(root)
  const cipher = nativeTestCipher()
  const store = open(root, cipher)
  const secrets = createNativeSecrets({ deviceInstanceId: store.deviceInstanceId, origin: 'https://auth.example', environment: 'test',
    deviceName: 'Isolated acceptance device', platform: 'macos', state: 's'.repeat(43), redirectUri: 'http://127.0.0.1:49152/oauth/mantur/callback' })
  const metadata: NativeActiveMetadata = {
    attempt: { id: randomUUID(), expiresAt: 2_000_000_000_000 },
    credential: { id: randomUUID(), displayName: 'Isolated account', accountId: randomUUID(), policyKeyId: randomUUID(), generation: 1, expiresAt: 2_000_000_000_000 },
  }
  return { root, cipher, store, secrets, metadata }
}

describe('native account storage', () => {
  it('persists installation identity and skip choice separately from OS-sealed attempt material', async () => {
    const b = await bench()
    expect(b.store.skipped()).toBe(false)
    b.store.setSkipped(true)
    await b.store.savePending(b.secrets, () => {})
    await b.store.close()
    const restored = open(b.root, b.cipher)
    expect(restored.deviceInstanceId).toBe(b.store.deviceInstanceId)
    expect(restored.skipped()).toBe(true)
    expect(await restored.secrets(b.secrets.requestId, 'authorize')).toEqual(b.secrets)
    const directory = join(b.root, 'native-account')
    for (const name of await readdir(directory)) {
      const bytes = await readFile(join(directory, name))
      expect(bytes.includes(b.secrets.credential)).toBe(false)
      expect(bytes.includes(b.secrets.codeVerifier)).toBe(false)
    }
  })

  it('never saves an attempt when OS encryption is unavailable or fails', async () => {
    const b = await bench()
    b.cipher.isAsyncEncryptionAvailable.mockResolvedValueOnce(false)
    await expect(b.store.savePending(b.secrets, () => {})).rejects.toThrow('unavailable')
    expect(b.cipher.encryptStringAsync).not.toHaveBeenCalled()
    b.cipher.encryptStringAsync.mockRejectedValueOnce(new Error('OS encryption denied'))
    await expect(b.store.savePending(b.secrets, () => {})).rejects.toThrow('denied')
    expect(b.store.records(b.secrets.origin)).toEqual([])
  })

  it('persists local logout even when OS encryption is temporarily unavailable and retains only revoke access', async () => {
    const b = await bench()
    await b.store.savePending(b.secrets, () => {})
    b.store.activate(b.secrets.requestId, b.metadata)
    b.store.setSkipped(true)
    b.cipher.isAsyncEncryptionAvailable.mockResolvedValue(false)
    b.store.disable(b.secrets.requestId)
    await b.store.close()
    const restored = open(b.root, b.cipher)
    expect(restored.records(b.secrets.origin)).toMatchObject([{ phase: 'pending-revoke', metadata: b.metadata }])
    expect(restored.skipped()).toBe(true)
    await expect(restored.secrets(b.secrets.requestId, 'request')).rejects.toThrow('disabled')
    await expect(restored.secrets(b.secrets.requestId, 'revoke')).rejects.toThrow('unavailable')
    b.cipher.isAsyncEncryptionAvailable.mockResolvedValue(true)
    expect(await restored.secrets(b.secrets.requestId, 'revoke')).toEqual(b.secrets)
  })

  it('does not reactivate an abandoned attempt when its server create result arrives late', async () => {
    const b = await bench()
    await b.store.savePending(b.secrets, () => {})
    b.store.disable(b.secrets.requestId)
    b.store.saveMetadata(b.secrets.requestId, { attempt: b.metadata.attempt })
    expect(b.store.records(b.secrets.origin)[0]?.phase).toBe('pending-cancel')
    expect(() => { b.store.activate(b.secrets.requestId, b.metadata) }).toThrow('disabled')
    await expect(b.store.secrets(b.secrets.requestId, 'authorize')).rejects.toThrow('disabled')
    expect(await b.store.secrets(b.secrets.requestId, 'revoke')).toEqual(b.secrets)
  })

  it('cleans up the exact older credential without disabling a newer login', async () => {
    const b = await bench()
    await b.store.savePending(b.secrets, () => {})
    b.store.activate(b.secrets.requestId, b.metadata)
    b.store.disable(b.secrets.requestId)
    const next = createNativeSecrets(b.secrets)
    await b.store.savePending(next, () => {})
    b.store.activate(next.requestId, { ...b.metadata, credential: { ...b.metadata.credential, id: randomUUID() } })
    b.store.removeDisabled(b.secrets.requestId)
    expect(b.store.records(next.origin)).toHaveLength(1)
    expect(await b.store.secrets(next.requestId, 'request')).toEqual(next)
    expect(() => { b.store.removeDisabled(next.requestId) }).toThrow('disabled')
  })

  it('rejects a second current attempt for an origin without replacing the first', async () => {
    const b = await bench()
    await b.store.savePending(b.secrets, () => {})
    const next = createNativeSecrets(b.secrets)
    await expect(b.store.savePending(next, () => {})).rejects.toThrow('UNIQUE')
    expect(await b.store.secrets(b.secrets.requestId, 'authorize')).toEqual(b.secrets)
    expect(b.store.records(b.secrets.origin)).toHaveLength(1)
  })

  it('rejects a draft abandoned while its OS encryption is in flight', async () => {
    const b = await bench()
    const sealed = await b.cipher.encryptStringAsync(JSON.stringify(b.secrets))
    const barrier = Promise.withResolvers<Buffer>()
    const entered = Promise.withResolvers<undefined>()
    b.cipher.encryptStringAsync.mockImplementationOnce(() => { entered.resolve(undefined); return barrier.promise })
    const cancellation = new AbortController()
    const saving = b.store.savePending(b.secrets, () => { cancellation.signal.throwIfAborted() })
    const rejected = expect(saving).rejects.toMatchObject({ name: 'AbortError' })
    try {
      await entered.promise
      cancellation.abort()
    } finally {
      barrier.resolve(sealed)
    }
    await rejected
    expect(b.store.records(b.secrets.origin)).toEqual([])
  })

  it('does not hand a normal request the credential if logout happens during decryption', async () => {
    const b = await bench()
    await b.store.savePending(b.secrets, () => {})
    b.store.activate(b.secrets.requestId, b.metadata)
    const barrier = Promise.withResolvers<{ result: string; shouldReEncrypt: boolean }>()
    const entered = Promise.withResolvers<undefined>()
    b.cipher.decryptStringAsync.mockImplementationOnce(() => { entered.resolve(undefined); return barrier.promise })
    const reading = b.store.secrets(b.secrets.requestId, 'request')
    const rejected = expect(reading).rejects.toThrow('disabled')
    try {
      await entered.promise
      b.store.disable(b.secrets.requestId)
    } finally {
      barrier.resolve({ result: JSON.stringify(b.secrets), shouldReEncrypt: false })
    }
    await rejected
  })

  it('rejects unsupported storage versions instead of overwriting them', async () => {
    const b = await bench()
    await b.store.close()
    const db = new DatabaseSync(join(b.root, 'native-account/account.sqlite'))
    try { db.exec('PRAGMA user_version=3') } finally { db.close() }
    expect(() => open(b.root, b.cipher)).toThrow('Unsupported')
  })

  it('waits for accepted OS work during close but never commits a late encrypted attempt', async () => {
    const b = await bench()
    const sealed = await b.cipher.encryptStringAsync(JSON.stringify(b.secrets))
    const barrier = Promise.withResolvers<Buffer>()
    const entered = Promise.withResolvers<undefined>()
    b.cipher.encryptStringAsync.mockImplementationOnce(() => { entered.resolve(undefined); return barrier.promise })
    const saving = b.store.savePending(b.secrets, () => {})
    const rejected = expect(saving).rejects.toThrow('closing')
    try {
      await entered.promise
      const closing = b.store.close()
      expect(b.store.close()).toBe(closing)
      expect(() => b.store.savePending(b.secrets, () => {})).toThrow('closing')
      expect(() => b.store.records(b.secrets.origin)).toThrow('closing')
    } finally {
      barrier.resolve(sealed)
    }
    await rejected
    await b.store.close()
    const restored = open(b.root, b.cipher)
    expect(restored.records(b.secrets.origin)).toEqual([])
  })

  it('reseals readable material when the OS requests rotation and persists the replacement', async () => {
    const b = await bench()
    await b.store.savePending(b.secrets, () => {})
    b.cipher.decryptStringAsync.mockResolvedValueOnce({ result: JSON.stringify(b.secrets), shouldReEncrypt: true })
    expect(await b.store.secrets(b.secrets.requestId, 'authorize')).toEqual(b.secrets)
    expect(b.cipher.encryptStringAsync).toHaveBeenCalledTimes(2)
    await b.store.close()
    const restored = open(b.root, b.cipher)
    expect(await restored.secrets(b.secrets.requestId, 'authorize')).toEqual(b.secrets)
  })

  it('keeps the original sealed revoke material if logout interrupts OS key rotation', async () => {
    const b = await bench()
    await b.store.savePending(b.secrets, () => {})
    b.store.activate(b.secrets.requestId, b.metadata)
    const sealed = await b.cipher.encryptStringAsync(JSON.stringify(b.secrets))
    const barrier = Promise.withResolvers<Buffer>()
    const entered = Promise.withResolvers<undefined>()
    b.cipher.decryptStringAsync.mockResolvedValueOnce({ result: JSON.stringify(b.secrets), shouldReEncrypt: true })
    b.cipher.encryptStringAsync.mockImplementationOnce(() => { entered.resolve(undefined); return barrier.promise })
    const reading = b.store.secrets(b.secrets.requestId, 'request')
    const rejected = expect(reading).rejects.toThrow('disabled')
    try {
      await entered.promise
      b.store.disable(b.secrets.requestId)
    } finally {
      barrier.resolve(sealed)
    }
    await rejected
    expect(await b.store.secrets(b.secrets.requestId, 'revoke')).toEqual(b.secrets)
  })

  it.each(['request', 'origin', 'installation'] as const)('rejects ciphertext copied from another %s', async (field) => {
    const b = await bench()
    const other = await bench()
    await b.store.savePending(b.secrets, () => {})
    const copied = field === 'request' ? createNativeSecrets(b.secrets)
      : field === 'origin' ? { ...b.secrets, origin: 'https://other.example' }
        : { ...b.secrets, deviceInstanceId: other.store.deviceInstanceId }
    b.cipher.decryptStringAsync.mockResolvedValueOnce({ result: JSON.stringify(copied), shouldReEncrypt: false })
    await expect(b.store.secrets(b.secrets.requestId, 'authorize')).rejects.toThrow('different record')
  })

  it('isolates grants from two configured origins in the same desktop profile', async () => {
    const b = await bench()
    const other = createNativeSecrets({ ...b.secrets, origin: 'https://other.example' })
    await b.store.savePending(b.secrets, () => {})
    await b.store.savePending(other, () => {})
    b.store.disable(b.secrets.requestId)
    expect(b.store.records(b.secrets.origin)).toMatchObject([{ requestId: b.secrets.requestId, phase: 'pending-cancel' }])
    expect(b.store.records(other.origin)).toMatchObject([{ requestId: other.requestId, phase: 'pending' }])
    expect(await b.store.secrets(other.requestId, 'authorize')).toEqual(other)
  })

  it('rejects invalid disk metadata without echoing its contents', async () => {
    const b = await bench()
    await b.store.savePending(b.secrets, () => {})
    await b.store.close()
    const db = new DatabaseSync(join(b.root, 'native-account/account.sqlite'))
    try {
      db.prepare('UPDATE grants SET metadata=? WHERE request_id=?').run(b.secrets.credential, b.secrets.requestId)
    } finally {
      db.close()
    }
    const restored = open(b.root, b.cipher)
    expect(() => restored.records(b.secrets.origin)).toThrow(/^Native account metadata is invalid$/u)
    await expect(restored.secrets(b.secrets.requestId, 'authorize')).rejects.toThrow(/^Native account metadata is invalid$/u)
  })

  it('never includes malformed decrypted input in its diagnostic', async () => {
    const b = await bench()
    await b.store.savePending(b.secrets, () => {})
    b.cipher.decryptStringAsync.mockResolvedValueOnce({ result: b.secrets.credential, shouldReEncrypt: false })
    await expect(b.store.secrets(b.secrets.requestId, 'authorize')).rejects.toThrow(/^Native account secret record is invalid$/u)
    const malformed = JSON.stringify({ credential: b.secrets.credential })
    expect(() => parseNativeSecrets(malformed)).toThrow(/^Native account secret record is invalid$/u)
  })

  it('uses full prefixed UTF-8 verifiers and independent unpadded 32-byte secrets', async () => {
    const { secrets } = await bench()
    expect(secrets.credential).toMatch(/^mtd_v2_[A-Za-z0-9_-]{43}$/u)
    expect(secrets.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(secrets.credential.slice(7)).not.toBe(secrets.codeVerifier.slice(7))
    expect(nativeVerifier(secrets.credential)).toBe(createHash('sha256').update(secrets.credential, 'utf8').digest('base64url'))
    const decodedVerifier = createHash('sha256').update(Buffer.from(secrets.credential.slice(7), 'base64url')).digest('base64url')
    expect(nativeVerifier(secrets.credential)).not.toBe(decodedVerifier)
  })
})
