/** Window-owned file selection and bounded writes for the embedded Cut editor. */
import { renameSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { open, realpath, unlink, type FileHandle } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join } from 'node:path'
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent, SaveDialogOptions, SaveDialogReturnValue } from 'electron'

/** Native services remain in Main; only opaque grants cross IPC. */
export interface CutExportBridgeOptions {
  ipc: IpcMain
  window: () => BrowserWindow | undefined
  origin: () => string | undefined
  unavailable: () => boolean
  showSaveDialog: (window: BrowserWindow, options: SaveDialogOptions) => Promise<SaveDialogReturnValue>
}

interface Grant {
  path: string
  directory: string
  file: FileHandle | undefined
  temporary: string | undefined
  offset: number
  busy: boolean
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Cut export request')
  return value as Record<string, unknown>
}

function filename(value: unknown): string {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > 240
    || /[/\\:*?"<>|\x00-\x1f\x7f]/.test(value) || /[. ]$/.test(value)
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)) throw new Error('Invalid Cut export filename')
  return value
}

/**
 * Restrict writes to a native-selected file in the current editor document.
 * @param options - Main-owned window, IPC, picker and shutdown state.
 * @returns Pending status and asynchronous cleanup for navigation, replacement and shutdown.
 */
export function installCutExportBridge(options: CutExportBridgeOptions): { isPending: () => boolean; invalidate: () => Promise<void> } {
  let owner: string | undefined
  let generation = 0
  let pending = false
  const grants = new Map<string, Grant>()
  const operations = new Set<Promise<unknown>>()
  const retired = new Set<Grant>()
  let cleanup: Promise<void> = Promise.resolve()
  const authorize = (event: IpcMainInvokeEvent): BrowserWindow => {
    const window = options.window()
    const origin = options.origin()
    if (!window || !origin || window.isDestroyed() || window.webContents.isDestroyed()
      || event.sender !== window.webContents || event.senderFrame === null
      || event.senderFrame !== window.webContents.mainFrame || new URL(event.senderFrame.url).origin !== origin) throw new Error('Cut export requires the desktop main frame')
    if (options.unavailable()) throw new Error('Cut export is unavailable during shutdown')
    return window
  }
  const clean = async (grant: Grant): Promise<void> => {
    if (grant.file) { await grant.file.close(); grant.file = undefined }
    if (grant.temporary) {
      await unlink(grant.temporary).catch((error: unknown) => {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      })
      grant.temporary = undefined
    }
  }
  const invalidate = (): Promise<void> => {
    owner = undefined
    generation += 1
    for (const grant of grants.values()) retired.add(grant)
    grants.clear()
    cleanup = cleanup.catch(() => undefined).then(async () => {
      await Promise.allSettled([...operations])
      for (const grant of retired) {
        await clean(grant)
        retired.delete(grant)
      }
    })
    return cleanup
  }
  options.ipc.handle('mantur:cut-export:attach', async (event, value: unknown) => {
    authorize(event)
    if (typeof value !== 'string' || !/^[a-f0-9-]{36}$/.test(value)) throw new Error('Invalid Cut editor owner')
    if (owner === value) return
    const cleanup = invalidate()
    const revision = generation
    await cleanup
    authorize(event)
    if (revision !== generation) throw new Error('Cut editor was replaced')
    owner = value
  })
  options.ipc.handle('mantur:cut-export:release', async (event, value: unknown) => {
    authorize(event)
    if (owner === value) await invalidate()
  })
  options.ipc.handle('mantur:cut-export:invoke', async (event, value: unknown) => {
    const window = authorize(event)
    const request = record(value)
    if (!owner || request.owner !== owner) throw new Error('Cut editor was replaced')
    const revision = generation
    const current = (): void => {
      authorize(event)
      if (revision !== generation || request.owner !== owner) throw new Error('Cut editor was replaced')
    }
    if (request.op === 'pick') {
      if (pending) throw new Error('Cut export selection is already pending')
      if ([...grants.values()].some(grant => grant.busy || grant.file || grant.temporary)) throw new Error('Cut export write is active')
      const name = filename(request.name)
      const directory = request.directory
      if (typeof directory !== 'string' || !isAbsolute(directory)) throw new Error('Invalid default export directory')
      pending = true
      try {
        const result = await options.showSaveDialog(window, { defaultPath: join(directory, name) })
        current()
        if (result.canceled) return null
        if (!result.filePath || !isAbsolute(result.filePath)) throw new Error('Invalid selected export path')
        const selectedName = filename(basename(result.filePath))
        const parent = await realpath(dirname(result.filePath))
        current()
        const id = randomUUID()
        // One retained selection per editor; choosing another file revokes the old grant.
        for (const grant of grants.values()) {
          if (grant.busy || grant.file || grant.temporary) throw new Error('Cut export write is active')
        }
        grants.clear()
        grants.set(id, { path: join(parent, selectedName), directory: parent,
          offset: 0, busy: false, file: undefined, temporary: undefined })
        return { id, name: selectedName }
      } finally { pending = false }
    }
    const grant = typeof request.id === 'string' ? grants.get(request.id) : undefined
    if (!grant) throw new Error('Cut export selection expired')
    if (grant.busy) throw new Error('Cut export writes must be sequential')
    grant.busy = true
    const operation = (async () => {
      try {
        if (request.op === 'start') {
          if (grant.file || grant.temporary) throw new Error('Cut export write is already open')
          grant.temporary = join(grant.directory, `.mantur-export-${randomUUID()}.part`)
          grant.file = await open(grant.temporary, 'wx', 0o600)
          current()
          grant.offset = 0
        } else if (request.op === 'write') {
          if (!grant.file || !(request.bytes instanceof Uint8Array) || request.bytes.byteLength === 0
            || request.bytes.byteLength > 1024 * 1024 || request.offset !== grant.offset
            || grant.offset + request.bytes.byteLength > 100 * 1024 * 1024 * 1024) throw new Error('Invalid Cut export chunk')
          await grant.file.writeFile(request.bytes)
          current()
          grant.offset += request.bytes.byteLength
        } else if (request.op === 'finish') {
          if (!grant.file || !grant.temporary || grant.offset === 0) throw new Error('Cut export file is empty')
          await grant.file.sync()
          await grant.file.close()
          grant.file = undefined
          current()
          if (await realpath(grant.directory) !== grant.directory) throw new Error('Cut export directory changed')
          current()
          renameSync(grant.temporary, grant.path)
          grant.temporary = undefined
        } else if (request.op === 'abort') {
          await clean(grant)
        } else throw new Error('Invalid Cut export operation')
      } catch (error) {
        await clean(grant)
        throw error
      } finally { grant.busy = false }
    })()
    operations.add(operation)
    try { await operation } finally { operations.delete(operation) }
  })
  return { isPending: () => pending || operations.size > 0 || retired.size > 0
    || [...grants.values()].some(grant => grant.file !== undefined || grant.temporary !== undefined), invalidate }
}
