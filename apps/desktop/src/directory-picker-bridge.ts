/** Main-frame-only directory selection owned by the current native window. */
import { isAbsolute } from 'node:path'
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent, OpenDialogOptions, OpenDialogReturnValue } from 'electron'
import type { desktopCopy } from './locales.ts'

/** Main owns the trusted window, application state, and native dialog implementation. */
export interface DirectoryPickerBridgeOptions {
  ipc: IpcMain
  window: () => BrowserWindow | undefined
  origin: () => string | undefined
  showOpenDialog: (window: BrowserWindow, options: OpenDialogOptions) => Promise<OpenDialogReturnValue>
  unavailable: () => boolean
  copy: () => ReturnType<typeof desktopCopy>
}

/**
 * Install one parameterless picker returning an absolute directory or null on cancellation.
 * Main invalidates on main-frame navigation, window close, and quitting; repeated requests reject while a dialog remains pending.
 * @param options - Main-owned IPC, window, dialog, application state, and localized copy.
 * @returns Pending-state and invalidation operations. Invalidation rejects late results; pending ends when the native dialog settles.
 */
export function installDirectoryPickerBridge(options: DirectoryPickerBridgeOptions): { isPending: () => boolean; invalidate: () => void } {
  let pending = false
  let generation = 0
  const authorize = (event: IpcMainInvokeEvent): BrowserWindow => {
    const window = options.window()
    const origin = options.origin()
    if (window === undefined || origin === undefined || window.isDestroyed() || window.webContents.isDestroyed()
      || event.sender !== window.webContents || event.senderFrame === null
      || event.senderFrame !== window.webContents.mainFrame
      || new URL(event.senderFrame.url).origin !== origin) throw new Error('Directory picker IPC is restricted to the desktop main frame')
    return window
  }
  options.ipc.handle('mantur:directory-picker:pick', async (event): Promise<string | null> => {
    const window = authorize(event)
    const copy = options.copy()
    if (options.unavailable()) throw new Error(copy.directoryPickerUnavailable)
    if (pending) throw new Error(copy.directoryPickerBusy)
    const documentGeneration = generation
    pending = true
    try {
      const result = await options.showOpenDialog(window, { title: copy.directoryPickerTitle, properties: ['openDirectory'] })
      if (generation !== documentGeneration || options.unavailable()) throw new Error(copy.directoryPickerInvalidated)
      authorize(event)
      if (result.canceled) return null
      const path = result.filePaths[0]
      if (result.filePaths.length !== 1 || path === undefined || !isAbsolute(path)) throw new Error(copy.directoryPickerInvalidResult)
      return path
    } finally { pending = false }
  })
  return { isPending: () => pending, invalidate: () => { generation += 1 } }
}
