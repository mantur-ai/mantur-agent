/** Explicit local replacement of v1 account storage before Main starts an account owner. */
import { chmod, copyFile, lstat, mkdtemp, open, readdir, rename, rmdir } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { NativeAccountStore, type NativeCipher } from './store.ts'

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function version(path: string): number {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    const value = db.prepare('PRAGMA user_version').get()?.user_version
    if (typeof value !== 'number') throw new Error('Account storage version is unavailable')
    return value
  } finally { db.close() }
}

async function sync(path: string): Promise<void> {
  const handle = await open(path, 'r')
  try { await handle.sync() }
  finally { await handle.close() }
}

async function ownedDirectory(path: string): Promise<void> {
  const entry = await lstat(path)
  if (!entry.isDirectory() || entry.isSymbolicLink() || entry.uid !== process.getuid?.()
    || (entry.mode & 0o077) !== 0) throw new Error('Account recovery requires a private owned directory')
}

async function replace(userData: string, cipher: NativeCipher): Promise<void> {
  // Node cannot supply the durable directory publication required on Windows.
  if (process.platform === 'win32') throw new Error('Account recovery requires native Windows durable publication')
  const directory = join(userData, 'native-account')
  const current = join(directory, 'account.sqlite')
  await ownedDirectory(userData)
  await ownedDirectory(directory)
  const entry = await lstat(current)
  if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1 || entry.uid !== process.getuid?.()) {
    throw new Error('Account recovery requires an owned regular database')
  }
  if ((await readdir(directory)).some(name => name !== 'account.sqlite') || version(current) !== 1) {
    throw new Error('Account storage changed or has unfinished SQLite work')
  }
  const backup = await mkdtemp(join(userData, 'native-account-backup-v1-'))
  await ownedDirectory(backup)
  const saved = join(backup, 'account.sqlite')
  // The original contains OS-sealed bytes; no decryption or remote account operation occurs here.
  const source = await open(current, 'r')
  try {
    const target = await open(saved, 'wx', 0o600)
    try { await target.writeFile(await source.readFile()); await target.sync() }
    finally { await target.close() }
  } finally { await source.close() }
  const store = new NativeAccountStore(backup, cipher)
  await store.close()
  const fresh = join(backup, 'replacement.sqlite')
  await rename(join(backup, 'native-account', 'account.sqlite'), fresh)
  await rmdir(join(backup, 'native-account'))
  await chmod(fresh, 0o600)
  const rollback = join(backup, 'rollback.sqlite')
  await copyFile(saved, rollback)
  await sync(fresh)
  await sync(rollback)
  await sync(backup)
  await sync(userData)
  // Publication changes only the account database; the retained copy never becomes a live identity.
  await rename(fresh, current)
  try { await sync(directory) }
  catch {
    try { await rename(rollback, current); await sync(directory) }
    catch { throw new Error('Account replacement failed; original backup retained for recovery') }
    throw new Error('Account replacement failed; original database restored')
  }
}

/**
 * Ask before replacing a known v1 database with an empty v2 database; other versions remain Store-owned errors.
 * @param userData - Private application data root, with no running account owner or other application instance.
 * @param cipher - Main's OS cipher; creating empty storage does not request encryption or decrypt old records.
 * @param confirm - Native user confirmation; false leaves every account byte untouched.
 * @returns false when the user cancels; true when normal startup may proceed.
 */
export async function prepareNativeAccountUpgrade(userData: string, cipher: NativeCipher,
  confirm: () => Promise<boolean>): Promise<boolean> {
  const path = join(userData, 'native-account', 'account.sqlite')
  if (!await exists(path) || version(path) !== 1) return true
  if (!await confirm()) return false
  await replace(userData, cipher)
  return true
}
