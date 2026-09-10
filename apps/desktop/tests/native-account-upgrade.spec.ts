/** Private v1 fixtures exercise user consent and atomic account-only replacement; no OS cipher or server is contacted. */
import * as fs from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { prepareNativeAccountUpgrade } from '../src/auth/upgrade.ts'
import { NativeAccountStore } from '../src/auth/store.ts'
import { nativeTestCipher } from './native-account-test-support.ts'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, open: vi.fn(actual.open), rename: vi.fn(actual.rename) }
})
const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
const roots: string[] = []
afterEach(async () => {
  vi.mocked(fs.open).mockImplementation(actual.open)
  vi.mocked(fs.rename).mockImplementation(actual.rename)
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })))
})

async function fixture(version = 1) {
  const root = await fs.mkdtemp(join(tmpdir(), 'mantur-account-upgrade-'))
  roots.push(root)
  const directory = join(root, 'native-account')
  await fs.mkdir(directory, { mode: 0o700 })
  const path = join(directory, 'account.sqlite')
  const db = new DatabaseSync(path)
  db.exec(`CREATE TABLE grants (sealed BLOB NOT NULL); PRAGMA user_version=${version}`)
  db.prepare('INSERT INTO grants VALUES (?)').run(Buffer.from('isolated-sealed-fixture'))
  db.close()
  const original = await fs.readFile(path)
  const untouched = ['projects/story.txt', 'drafts/checkpoint.json', 'harness/credentials/model.json']
  for (const name of untouched) {
    await fs.mkdir(join(root, name, '..'), { recursive: true })
    await fs.writeFile(join(root, name), name)
  }
  return { root, directory, path, original, untouched, cipher: nativeTestCipher() }
}

async function unchanged(b: Awaited<ReturnType<typeof fixture>>) {
  for (const name of b.untouched) expect(await fs.readFile(join(b.root, name), 'utf8')).toBe(name)
}

describe.skipIf(process.platform === 'win32')('explicit native account upgrade on POSIX', () => {
  it('keeps every account byte on cancel and does not access the cipher', async () => {
    const b = await fixture()
    const confirm = vi.fn(async () => false)
    expect(await prepareNativeAccountUpgrade(b.root, b.cipher, confirm)).toBe(false)
    expect(confirm).toHaveBeenCalledOnce()
    expect(await fs.readFile(b.path)).toEqual(b.original)
    expect((await fs.readdir(b.root)).filter(name => name.startsWith('native-account-backup-'))).toEqual([])
    expect(b.cipher.decryptStringAsync).not.toHaveBeenCalled()
    await unchanged(b)
  })

  it('retains a private exact backup and starts with no grant after explicit confirmation', async () => {
    const b = await fixture()
    expect(await prepareNativeAccountUpgrade(b.root, b.cipher, async () => true)).toBe(true)
    const names = (await fs.readdir(b.root)).filter(name => name.startsWith('native-account-backup-v1-'))
    expect(names).toHaveLength(1)
    const backup = join(b.root, names[0]!)
    expect(await fs.readFile(join(backup, 'account.sqlite'))).toEqual(b.original)
    expect((await fs.stat(backup)).mode & 0o077).toBe(0)
    expect((await fs.stat(join(backup, 'account.sqlite'))).mode & 0o077).toBe(0)
    expect((await fs.stat(b.path)).mode & 0o077).toBe(0)
    const store = new NativeAccountStore(b.root, b.cipher)
    try {
      expect(store.records('https://hub.mantur.ai')).toEqual([])
      expect(store.skipped()).toBe(false)
    } finally { await store.close() }
    const confirm = vi.fn(async () => true)
    expect(await prepareNativeAccountUpgrade(b.root, b.cipher, confirm)).toBe(true)
    expect(confirm).not.toHaveBeenCalled()
    expect(b.cipher.decryptStringAsync).not.toHaveBeenCalled()
    expect(b.cipher.encryptStringAsync).not.toHaveBeenCalled()
    await unchanged(b)
  })

  it('leaves the old database usable when replacement publication fails', async () => {
    const b = await fixture()
    const rename = actual.rename
    vi.mocked(fs.rename).mockImplementation(async (from, to) => {
      if (to === b.path) throw new Error('isolated rename failure')
      return rename(from, to)
    })
    await expect(prepareNativeAccountUpgrade(b.root, b.cipher, async () => true)).rejects.toThrow('isolated rename failure')
    expect(await fs.readFile(b.path)).toEqual(b.original)
    await unchanged(b)
  })

  it('restores the original database if the committed directory cannot be synced', async () => {
    const b = await fixture()
    const open = actual.open
    let failed = false
    vi.mocked(fs.open).mockImplementation(async (...args) => {
      if (args[0] === b.directory && !failed) { failed = true; throw new Error('isolated sync failure') }
      return open(...args)
    })
    await expect(prepareNativeAccountUpgrade(b.root, b.cipher, async () => true)).rejects.toThrow('original database restored')
    expect(failed).toBe(true)
    expect(await fs.readFile(b.path)).toEqual(b.original)
    await unchanged(b)
  })

  it('leaves original data unchanged if backup creation fails', async () => {
    const b = await fixture()
    const open = actual.open
    vi.mocked(fs.open).mockImplementation(async (...args) => {
      if (args[1] === 'wx') throw new Error('isolated backup failure')
      return open(...args)
    })
    await expect(prepareNativeAccountUpgrade(b.root, b.cipher, async () => true)).rejects.toThrow('isolated backup failure')
    expect(await fs.readFile(b.path)).toEqual(b.original)
    await unchanged(b)
  })

  it('rejects changed or unfinished SQLite work after confirmation without replacing it', async () => {
    const b = await fixture()
    await expect(prepareNativeAccountUpgrade(b.root, b.cipher, async () => {
      await fs.writeFile(join(b.directory, 'account.sqlite-journal'), 'isolated unfinished work')
      return true
    })).rejects.toThrow('unfinished SQLite work')
    expect(await fs.readFile(b.path)).toEqual(b.original)
    await unchanged(b)
  })


  it('retains the original private backup if rollback cannot be published', async () => {
    const b = await fixture()
    vi.mocked(fs.open).mockImplementation(async (...args) => {
      if (args[0] === b.directory) throw new Error('isolated sync failure')
      return actual.open(...args)
    })
    vi.mocked(fs.rename).mockImplementation(async (from, to) => {
      if (String(from).endsWith('rollback.sqlite')) throw new Error('isolated rollback failure')
      return actual.rename(from, to)
    })
    await expect(prepareNativeAccountUpgrade(b.root, b.cipher, async () => true)).rejects.toThrow('original backup retained')
    const backup = (await fs.readdir(b.root)).find(name => name.startsWith('native-account-backup-v1-'))!
    expect(await fs.readFile(join(b.root, backup, 'account.sqlite'))).toEqual(b.original)
    await unchanged(b)
  })

  it('refuses a shared account directory without changing the original database', async () => {
    const b = await fixture()
    await fs.chmod(b.directory, 0o755)
    await expect(prepareNativeAccountUpgrade(b.root, b.cipher, async () => true)).rejects.toThrow('private owned directory')
    expect(await fs.readFile(b.path)).toEqual(b.original)
    expect((await fs.readdir(b.root)).filter(name => name.startsWith('native-account-backup-'))).toEqual([])
    await unchanged(b)
  })

  it('leaves unknown versions to the store refusal instead of offering a reset', async () => {
    const b = await fixture(9)
    const confirm = vi.fn(async () => true)
    expect(await prepareNativeAccountUpgrade(b.root, b.cipher, confirm)).toBe(true)
    expect(confirm).not.toHaveBeenCalled()
    expect(() => new NativeAccountStore(b.root, b.cipher)).toThrow('Unsupported native account storage version')
    expect(await fs.readFile(b.path)).toEqual(b.original)
  })

  it('does not prompt or write account storage on a fresh installation', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'mantur-account-upgrade-'))
    roots.push(root)
    const confirm = vi.fn(async () => true)
    expect(await prepareNativeAccountUpgrade(root, nativeTestCipher(), confirm)).toBe(true)
    expect(confirm).not.toHaveBeenCalled()
    expect(await fs.readdir(root)).toEqual([])
  })
})
