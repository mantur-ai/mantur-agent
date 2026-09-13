/** Main-frame-only import of native files and folders. */
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent, OpenDialogOptions, OpenDialogReturnValue } from 'electron'
import { importLocalFiles } from './file-import.ts'

/** Trusted window, dialog and durable attachment directory. */
export interface FileImportBridgeOptions {
  ipc: IpcMain
  window: () => BrowserWindow | undefined
  origin: () => string | undefined
  root: string
  showOpenDialog: (window: BrowserWindow, options: OpenDialogOptions) => Promise<OpenDialogReturnValue>
}

/**
 * Register imports only for the application's authenticated main frame.
 * @param options - Main-owned native services; renderer URLs and path payloads are validated at receipt.
 */
export function installFileImportBridge(options: FileImportBridgeOptions): void {
  const authorize = (event: IpcMainInvokeEvent): BrowserWindow => {
    const window = options.window()
    const origin = options.origin()
    if (window === undefined || origin === undefined || window.isDestroyed() || window.webContents.isDestroyed()
      || event.sender !== window.webContents || event.senderFrame === null
      || event.senderFrame !== window.webContents.mainFrame
      || new URL(event.senderFrame.url).origin !== origin) throw new Error('File import requires the desktop main frame')
    return window
  }
  options.ipc.handle('mantur:files:import', async (event, paths: unknown) => {
    authorize(event)
    if (!Array.isArray(paths) || !paths.every((path: unknown): path is string => typeof path === 'string')) {
      throw new Error('File import requires an array of native paths')
    }
    return importLocalFiles(options.root, paths)
  })
  options.ipc.handle('mantur:files:pick', async (event, kind: unknown) => {
    const window = authorize(event)
    if (kind !== 'file' && kind !== 'directory') throw new Error('Invalid file selection kind')
    const selection = await options.showOpenDialog(window, {
      properties: [kind === 'directory' ? 'openDirectory' : 'openFile', 'multiSelections'],
    })
    authorize(event)
    return selection.canceled ? [] : importLocalFiles(options.root, selection.filePaths)
  })
}
