/** OS-encrypted client-session storage, isolated from the retired device-grant database. */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { NativeCipher } from './store.ts'

const account = z.object({
  origin: z.url(), userId: z.string().min(1), displayName: z.string(),
  accessToken: z.string().min(1), refreshToken: z.string().min(1), expiresAt: z.number().positive(),
  key: z.object({ id: z.string().min(1), secret: z.string().min(1), expiresAt: z.number().positive() }).optional(),
  keyPending: z.boolean().optional(),
})
/** Decrypted data remains exclusively inside Electron Main. */
export type ClientSession = z.infer<typeof account>

/** Single Main owner serializes encrypted writes and checks cancellation before atomic replacement. */
export class ClientSessionStore {
  private readonly directory: string
  private readonly file: string
  private tail: Promise<unknown> = Promise.resolve()
  /** @param root - desktop profile. @param origin - selected deployment. @param cipher - operating-system encryption. */
  constructor(root: string, private readonly origin: string, private readonly cipher: NativeCipher) {
    this.directory = join(root, 'client-session')
    this.file = join(this.directory, createHash('sha256').update(origin).digest('hex') + '.sealed')
  }
  /** @returns the profile's persistent onboarding choice. */
  async readSkipped(): Promise<boolean> {
    try { return (await readFile(join(this.directory, 'skipped'), 'utf8')) === 'true' }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
  }
  /** Persist an explicit skip without storing any credential. */
  skip(): Promise<void> {
    const run = this.tail.then(async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 })
      await writeFile(join(this.directory, 'skipped'), 'true', { mode: 0o600 })
    })
    this.tail = run.catch(() => { /* The caller receives the failure; later writes still run. */ })
    return run
  }
  /** @returns validated account or absence; unreadable records never become a signed-out success. */
  async read(): Promise<ClientSession | undefined> {
    let bytes: Buffer
    try { bytes = await readFile(this.file) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw new Error('Cannot read client session')
    }
    if (!await this.cipher.isAsyncEncryptionAvailable()) throw new Error('OS credential encryption unavailable')
    try {
      const data = account.parse(JSON.parse((await this.cipher.decryptStringAsync(bytes)).result) as unknown)
      if (data.origin !== this.origin) throw new Error('Origin mismatch')
      return data
    } catch { throw new Error('Cannot decrypt client session') }
  }
  /** @param value - Main-only account or deletion. @param signal - prevents late commits after cancellation. */
  save(value: ClientSession | undefined, signal?: AbortSignal): Promise<void> {
    const run = this.tail.then(async () => {
      signal?.throwIfAborted()
      if (value === undefined) {
        try { await unlink(this.file) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
        return
      }
      if (value.origin !== this.origin) throw new Error('Client session origin mismatch')
      if (!await this.cipher.isAsyncEncryptionAvailable()) throw new Error('OS credential encryption unavailable')
      const bytes = await this.cipher.encryptStringAsync(JSON.stringify(account.parse(value)))
      signal?.throwIfAborted()
      await mkdir(this.directory, { recursive: true, mode: 0o700 })
      const temporary = this.file + '.' + randomUUID()
      try {
        await writeFile(temporary, bytes, { mode: 0o600, flag: 'wx' })
        signal?.throwIfAborted()
        await rename(temporary, this.file)
      } finally {
        try { await unlink(temporary) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      }
    })
    this.tail = run.catch(() => {})
    return run
  }
  /** @returns completion of accepted encryption and filesystem work. */
  async close(): Promise<void> { await this.tail }
}
