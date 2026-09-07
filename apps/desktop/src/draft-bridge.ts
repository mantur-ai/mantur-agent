/** Narrow, frame-bound native draft storage and restart-save handshake. */
import { randomUUID } from 'node:crypto'
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent, WebFrameMain } from 'electron'
import type { DesktopDraftStorage } from './draft-storage.ts'

/** Dependencies owned by the desktop main process. */
export interface DraftBridgeOptions {
  ipc: IpcMain
  window: () => BrowserWindow | undefined
  origin: () => string | undefined
  storage: DesktopDraftStorage
  timeoutMs?: number
}

/** Install only named draft operations; no renderer path, channel, or process access is exposed. */
export function installDraftBridge(options: DraftBridgeOptions): { prepare: () => Promise<number>; release: () => void } {
  let pending: {
    id: string
    frame: WebFrameMain
    resolve: (revision: number) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  } | undefined
  let sealed = false
  const authorize = (event: IpcMainInvokeEvent): void => {
    const window = options.window()
    const origin = options.origin()
    if (window === undefined || origin === undefined || event.sender !== window.webContents
      || event.senderFrame === null || event.senderFrame !== window.webContents.mainFrame
      || new URL(event.senderFrame.url).origin !== origin) throw new Error('Draft IPC is restricted to the desktop main frame')
  }
  options.ipc.handle('mantur:drafts:load', async (event) => {
    authorize(event)
    return options.storage.committed()
  })
  options.ipc.handle('mantur:drafts:save', async (event, candidate: unknown) => {
    authorize(event)
    if (sealed) throw new Error('Draft checkpoint is sealed for restart')
    return options.storage.save(candidate)
  })
  options.ipc.handle('mantur:drafts:prepared', async (event, value: unknown) => {
    authorize(event)
    if (typeof value !== 'object' || value === null) throw new Error('Invalid save receipt')
    const receipt = value as Record<string, unknown>
    const operation = pending
    if (operation === undefined || receipt.id !== operation.id || event.senderFrame !== operation.frame) throw new Error('Stale save receipt')
    if (sealed) throw new Error('Save receipt is already being verified')
    if (receipt.ok !== true || !Number.isSafeInteger(receipt.revision)) {
      clearTimeout(operation.timer)
      pending = undefined
      operation.reject(new Error(typeof receipt.error === 'string' ? receipt.error : 'The renderer could not save its drafts'))
      return
    }
    sealed = true
    try {
      const checkpoint = await options.storage.committed()
      if (pending !== operation) return
      if (checkpoint.revision !== receipt.revision) throw new Error('Save receipt does not match the durable checkpoint')
      clearTimeout(operation.timer)
      pending = undefined
      operation.resolve(checkpoint.revision)
    } catch (error) {
      if (pending !== operation) return
      clearTimeout(operation.timer)
      pending = undefined
      sealed = false
      operation.reject(error instanceof Error ? error : new Error(String(error)))
    }
  })
  const release = (): void => {
    sealed = false
    if (pending !== undefined) {
      clearTimeout(pending.timer)
      pending.reject(new Error('Restart save cancelled'))
      pending = undefined
    }
    const window = options.window()
    if (window !== undefined && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('mantur:drafts:release')
  }
  return {
    prepare: () => {
      if (pending !== undefined || sealed) return Promise.reject(new Error('Restart save is already in progress'))
      const window = options.window()
      if (window === undefined || window.isDestroyed() || window.webContents.isDestroyed()) return Promise.reject(new Error('The renderer is unavailable; restart installation was cancelled'))
      return new Promise<number>((resolve, reject) => {
        const id = randomUUID()
        const timer = setTimeout(() => {
          pending = undefined
          sealed = false
          if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('mantur:drafts:release')
          reject(new Error('The renderer did not confirm that drafts were saved'))
        }, options.timeoutMs ?? 30_000)
        pending = { id, frame: window.webContents.mainFrame, resolve, reject, timer }
        window.webContents.send('mantur:drafts:prepare', id)
      })
    },
    release,
  }
}
