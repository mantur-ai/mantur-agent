/** Application-owned draft checkpoint with compare-and-swap revisions and verified image bytes. */

import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'

/** Serialized image selected by the user; paths and browser object URLs are never accepted. */
export interface SavedDraftImage {
  id: string
  name: string
  type: string
  lastModified: number
  data: string
  size: number
  sha256: string
}

/** One editor document associated with a real Session or the unassigned composer. */
export interface SavedDraft {
  owner: string
  editor: string
  occurrenceIds: number[]
  nextOccurrenceId: number
  images: SavedDraftImage[]
  prepareId?: string
}

/** Entire application draft checkpoint; both sides of a transfer commit together. */
export interface DraftCheckpoint {
  format: 1
  revision: number
  drafts: SavedDraft[]
}

const MAX_CHECKPOINT_BYTES = 256 * 1024 * 1024
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid draft record')
  return value as Record<string, unknown>
}

function integer(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/** Validate the durable/IPC payload, including every attachment size and SHA-256 digest. */
export function parseDraftCheckpoint(value: unknown): DraftCheckpoint {
  const root = record(value)
  if (root.format !== 1 || !integer(root.revision) || !Array.isArray(root.drafts)) throw new Error('Unsupported draft checkpoint')
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_CHECKPOINT_BYTES) throw new Error('Draft checkpoint exceeds storage limit')
  const owners = new Set<string>()
  const drafts = root.drafts.map((value: unknown): SavedDraft => {
    const draft = record(value)
    if (typeof draft.owner !== 'string' || (draft.owner !== 'unassigned' && !/^session:.+$/u.test(draft.owner))
      || owners.has(draft.owner) || typeof draft.editor !== 'string'
      || !Array.isArray(draft.occurrenceIds) || !draft.occurrenceIds.every(integer)
      || !integer(draft.nextOccurrenceId) || !Array.isArray(draft.images)) throw new Error('Invalid draft owner or editor')
    owners.add(draft.owner)
    const editor = record(JSON.parse(draft.editor) as unknown)
    if (!('root' in editor)) throw new Error('Missing draft editor root')
    const nextOccurrenceId = draft.nextOccurrenceId
    if (new Set(draft.occurrenceIds).size !== draft.occurrenceIds.length
      || draft.occurrenceIds.some(id => id > nextOccurrenceId)) throw new Error('Invalid draft occurrence identities')
    if (draft.prepareId !== undefined && (draft.owner !== 'unassigned' || typeof draft.prepareId !== 'string' || !UUID.test(draft.prepareId))) {
      throw new Error('Invalid draft preparation identity')
    }
    const ids = new Set<string>()
    const images = draft.images.map((value: unknown): SavedDraftImage => {
      const image = record(value)
      if (typeof image.id !== 'string' || !UUID.test(image.id) || ids.has(image.id)
        || typeof image.name !== 'string' || typeof image.type !== 'string'
        || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(image.type)
        || !integer(image.lastModified) || !integer(image.size) || typeof image.data !== 'string'
        || typeof image.sha256 !== 'string') throw new Error('Invalid draft attachment')
      ids.add(image.id)
      const bytes = Buffer.from(image.data, 'base64')
      if (bytes.toString('base64') !== image.data || bytes.length !== image.size
        || createHash('sha256').update(bytes).digest('hex') !== image.sha256) throw new Error('Draft attachment checksum mismatch')
      return {
        id: image.id, name: image.name, type: image.type, lastModified: image.lastModified,
        data: image.data, size: image.size, sha256: image.sha256,
      }
    })
    return { owner: draft.owner, editor: draft.editor, occurrenceIds: draft.occurrenceIds, nextOccurrenceId: draft.nextOccurrenceId, images,
      ...(draft.prepareId === undefined ? {} : { prepareId: draft.prepareId }) }
  })
  return { format: 1, revision: root.revision, drafts }
}

/** Own one stable draft file below Electron userData, independent of the loopback origin. */
export class DesktopDraftStorage {
  private queue: Promise<unknown> = Promise.resolve()
  private readonly userData: string
  private readonly directory: string
  private readonly filename: string

  /** @param userData - Application-owned data root selected before desktop launch. */
  constructor(userData: string) {
    this.userData = userData
    this.directory = join(userData, 'drafts')
    this.filename = join(this.directory, 'checkpoint.json')
  }

  /** Read and validate the last committed checkpoint; only absence represents an empty store. */
  async read(): Promise<DraftCheckpoint> {
    let raw: string
    try { raw = await readFile(this.filename, 'utf8') }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { format: 1, revision: 0, drafts: [] }
      throw error
    }
    return parseDraftCheckpoint(JSON.parse(raw) as unknown)
  }

  /** Wait for all accepted writes before reading the committed checkpoint. */
  async committed(): Promise<DraftCheckpoint> {
    await this.queue
    const checkpoint = await this.read()
    if (checkpoint.revision !== 0) {
      const file = await open(this.filename, 'r+')
      try { await file.sync() } finally { await file.close() }
      await this.syncDirectory()
    }
    return checkpoint
  }

  private async syncDirectory(): Promise<void> {
    // Windows directory fsync is not exposed by Node; native write-through publication remains unverified there.
    if (process.platform === 'win32') throw new Error('Verified draft durability is not yet available on Windows')
    for (const path of [this.directory, this.userData]) {
      const directory = await open(path, 'r')
      try { await directory.sync() } finally { await directory.close() }
    }
  }

  /**
   * Commit one exact successor revision after verifying every attachment; readback resolves an uncertain publication.
   * @param value - Complete candidate checkpoint from the current renderer.
   * @returns the committed revision, only after the file has synced and the atomic rename succeeds.
   */
  save(value: unknown): Promise<number> {
    if (process.platform === 'win32') throw new Error('Verified draft durability is not yet available on Windows')
    const candidate = parseDraftCheckpoint(value)
    const operation = this.queue.then(async () => {
      const current = await this.read()
      if (candidate.revision !== current.revision + 1) throw new Error('Draft revision conflict; reload before saving')
      await mkdir(this.directory, { recursive: true, mode: 0o700 })
      const temporary = join(this.directory, `${randomUUID()}.tmp`)
      const file = await open(temporary, 'wx', 0o600)
      let renamed = false
      try {
        await file.writeFile(`${JSON.stringify(candidate)}\n`)
        await file.sync()
        await file.close()
        await rename(temporary, this.filename)
        renamed = true
        await this.syncDirectory()
      } finally {
        await file.close()
        if (!renamed) await unlink(temporary)
      }
      return candidate.revision
    })
    this.queue = operation.catch(() => { /* The caller receives the write failure; subsequent explicit retries may proceed. */ })
    return operation
  }
}
