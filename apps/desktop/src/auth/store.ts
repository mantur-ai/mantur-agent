/** OS-sealed credentials and transactionally disabled local grants, independent of model keys and drafts. */
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import {
  nativeMetadataSchema, parseNativeSecrets,
  type NativeActiveMetadata, type NativeDeviceId, type NativeMetadata, type NativeRequestId, type NativeSecrets,
} from './protocol.ts'

/** Electron's asynchronous OS encryption face, supplied only by the main process. */
export interface NativeCipher {
  isAsyncEncryptionAvailable(): Promise<boolean>
  encryptStringAsync(text: string): Promise<Buffer>
  decryptStringAsync(bytes: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>
}

const phases = ['pending', 'active', 'pending-cancel', 'pending-revoke'] as const
/** Local use is forbidden in both pending revocation phases, including after restart. */
export type NativeRecordPhase = typeof phases[number]
/** Public state associated with immutable OS-sealed secrets. */
export interface NativeRecord {
  readonly requestId: NativeRequestId
  readonly origin: string
  readonly phase: NativeRecordPhase
  readonly metadata: NativeMetadata
}

const rowSchema = z.strictObject({ request_id: z.uuid(), origin: z.url(), phase: z.enum(phases), metadata: z.string() })

function parseRecord(value: unknown): NativeRecord {
  try {
    const row = rowSchema.parse(value)
    const metadata = nativeMetadataSchema.parse(JSON.parse(row.metadata) as unknown)
    if (row.phase === 'active' && (metadata.attempt === undefined || metadata.credential === undefined)) throw new Error('Missing active metadata')
    return { requestId: row.request_id as NativeRequestId, origin: row.origin, phase: row.phase, metadata }
  } catch {
    // Disk metadata is not trusted and is not included in the diagnostic.
    throw new Error('Native account metadata is invalid')
  }
}

/** SQLite commits state changes without decrypting or rewriting already-sealed revoke material. */
export class NativeAccountStore {
  private readonly db: DatabaseSync
  private readonly pending = new Set<Promise<unknown>>()
  private closing = false
  private closeResult: Promise<void> | undefined
  readonly deviceInstanceId: NativeDeviceId

  /**
   * @param userData - Electron profile's private data directory, never a workspace or model credential path.
   * @param cipher - Electron safeStorage after app readiness; there is no plaintext storage mode.
   */
  constructor(userData: string, private readonly cipher: NativeCipher) {
    const directory = join(userData, 'native-account')
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    this.db = new DatabaseSync(join(directory, 'account.sqlite'))
    try {
      const version = this.db.prepare('PRAGMA user_version').get()?.user_version
      if (version !== 0 && version !== 1) throw new Error('Unsupported native account storage version')
      this.db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=EXTRA; PRAGMA fullfsync=ON; PRAGMA secure_delete=ON;')
      if (version === 0) {
        this.db.exec(`BEGIN IMMEDIATE;
          CREATE TABLE profile (id INTEGER PRIMARY KEY CHECK(id=1), device_id TEXT NOT NULL, skipped INTEGER NOT NULL CHECK(skipped IN (0,1))) STRICT;
          CREATE TABLE grants (request_id TEXT PRIMARY KEY, origin TEXT NOT NULL, phase TEXT NOT NULL,
            sealed BLOB NOT NULL, metadata TEXT NOT NULL) STRICT;
          CREATE UNIQUE INDEX current_origin ON grants(origin) WHERE phase IN ('pending','active');
          PRAGMA user_version=1;`)
        this.db.prepare('INSERT INTO profile VALUES (1, ?, 0)').run(randomUUID())
        this.db.exec('COMMIT')
      }
      this.deviceInstanceId = z.uuid().parse(this.db.prepare('SELECT device_id FROM profile WHERE id=1').get()?.device_id) as NativeDeviceId
    } catch (error) {
      this.db.close()
      throw error
    }
  }

  /** Read all public states for one exact deployment origin. */
  records(origin: string): NativeRecord[] {
    this.assertOpen()
    return this.db.prepare('SELECT request_id, origin, phase, metadata FROM grants WHERE origin=? ORDER BY rowid').all(origin).map(parseRecord)
  }

  /** Read the user's independent, persistent onboarding choice. */
  skipped(): boolean {
    this.assertOpen()
    return z.union([z.literal(0), z.literal(1)]).parse(this.db.prepare('SELECT skipped FROM profile WHERE id=1').get()?.skipped) === 1
  }

  /** Persist the onboarding choice without deleting accounts, model credentials or drafts. */
  setSkipped(skipped: boolean): void {
    this.assertOpen()
    this.db.prepare('UPDATE profile SET skipped=? WHERE id=1').run(skipped ? 1 : 0)
  }

  /**
   * Seal and commit an attempt before its first network request.
   * @param secrets - fresh Host-generated material, including the complete idempotent create request fields.
   * @param beforeCommit - originating operation's final cancellation check after OS encryption.
   * @returns completion of the encrypted transaction; failure authorizes no network request.
   */
  savePending(secrets: NativeSecrets, beforeCommit: () => void): Promise<void> {
    return this.track(async () => {
      if (!await this.cipher.isAsyncEncryptionAvailable()) throw new Error('OS account encryption is unavailable')
      const sealed = await this.cipher.encryptStringAsync(JSON.stringify(secrets))
      this.assertOpen()
      beforeCommit()
      this.db.prepare("INSERT INTO grants VALUES (?, ?, 'pending', ?, '{}')").run(secrets.requestId, secrets.origin, sealed)
    })
  }

  /**
   * Read secrets only for the stated operation and recheck revocation after asynchronous decryption.
   * @param requestId - exact attempt or credential, never a public device-id lookup.
   * @param purpose - normal account requests cannot read pending revocation material.
   * @returns material for this operation; callers must not expose it through renderer or CLI responses.
   */
  secrets(requestId: NativeRequestId, purpose: 'authorize' | 'request' | 'revoke'): Promise<NativeSecrets> {
    return this.track(async () => {
      const permitted: readonly NativeRecordPhase[] = purpose === 'authorize' ? ['pending']
        : purpose === 'request' ? ['active'] : ['pending-cancel', 'pending-revoke']
      const record = this.requireRecord(requestId, permitted)
      if (!await this.cipher.isAsyncEncryptionAvailable()) throw new Error('OS account encryption is unavailable')
      const bytes = this.db.prepare('SELECT sealed FROM grants WHERE request_id=?').get(requestId)?.sealed
      if (!(bytes instanceof Uint8Array)) throw new Error('Native account ciphertext is invalid')
      const decrypted = await this.cipher.decryptStringAsync(Buffer.from(bytes))
      const secrets = parseNativeSecrets(decrypted.result)
      if (secrets.requestId !== requestId || secrets.origin !== record.origin || secrets.deviceInstanceId !== this.deviceInstanceId) {
        throw new Error('Native account ciphertext belongs to a different record')
      }
      this.requireRecord(requestId, permitted)
      if (decrypted.shouldReEncrypt) {
        const rotated = await this.cipher.encryptStringAsync(decrypted.result)
        this.requireRecord(requestId, permitted)
        this.db.prepare('UPDATE grants SET sealed=? WHERE request_id=?').run(rotated, requestId)
      }
      return secrets
    })
  }

  /** Store public server metadata without reviving a locally cancelled attempt. */
  saveMetadata(requestId: NativeRequestId, metadata: NativeMetadata): void {
    this.requireRecord(requestId, ['pending', 'pending-cancel'])
    this.db.prepare('UPDATE grants SET metadata=? WHERE request_id=?').run(JSON.stringify(metadata), requestId)
  }

  /** Publish local sign-in only with confirmed attempt and credential metadata. */
  activate(requestId: NativeRequestId, metadata: NativeActiveMetadata): void {
    this.requireRecord(requestId, ['pending'])
    this.db.prepare("UPDATE grants SET phase='active', metadata=? WHERE request_id=?").run(JSON.stringify(metadata), requestId)
  }

  /** Atomically stop local use; existing OS-sealed material remains available only for exact cancellation/revoke. */
  disable(requestId: NativeRequestId): void {
    this.assertOpen()
    this.db.prepare(`UPDATE grants SET phase=CASE phase WHEN 'pending' THEN 'pending-cancel' WHEN 'active' THEN 'pending-revoke' ELSE phase END
      WHERE request_id=?`).run(requestId)
  }

  /** Remove one locally disabled credential only after the caller confirms server revocation or original expiry. */
  removeDisabled(requestId: NativeRequestId): void {
    this.requireRecord(requestId, ['pending-cancel', 'pending-revoke'])
    this.db.prepare('DELETE FROM grants WHERE request_id=?').run(requestId)
  }

  /** Reject new work, await accepted OS operations and then release SQLite handles. */
  close(): Promise<void> {
    this.closing = true
    this.closeResult ??= Promise.allSettled([...this.pending]).then(() => { this.db.close() })
    return this.closeResult
  }

  private requireRecord(requestId: NativeRequestId, permitted: readonly NativeRecordPhase[]): NativeRecord {
    this.assertOpen()
    const row = this.db.prepare('SELECT request_id, origin, phase, metadata FROM grants WHERE request_id=?').get(requestId)
    if (row === undefined) throw new Error('Native account record is absent')
    const record = parseRecord(row)
    if (!permitted.includes(record.phase)) throw new Error('Native account is disabled for this operation')
    return record
  }

  private track<T>(run: () => Promise<T>): Promise<T> {
    this.assertOpen()
    const operation = run()
    this.pending.add(operation)
    void operation.finally(() => { this.pending.delete(operation) }).catch(() => {
      // The returned operation owns its error; tracking only releases the shutdown wait.
    })
    return operation
  }

  private assertOpen(): void {
    if (this.closing) throw new Error('Native account storage is closing')
  }
}
