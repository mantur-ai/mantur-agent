/** Main-frame-only update state and explicit actions backed by the native updater controller. */
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import type { DesktopUpdateController, DesktopUpdateState } from './updater.ts'

/** Dependencies owned by the native application lifetime. */
export interface UpdateBridgeOptions {
  ipc: IpcMain
  window: () => BrowserWindow | undefined
  origin: () => string | undefined
  controller: () => DesktopUpdateController | undefined
  version: string
}

/** Install fixed update operations; every installation action uses the controller's confirmation. */
export function installUpdateBridge(options: UpdateBridgeOptions): { publish: (state: DesktopUpdateState) => void } {
  let revision = 0
  let state: DesktopUpdateState = { kind: 'idle' }
  const snapshot = () => ({ revision, state, enabled: options.controller() !== undefined, currentVersion: options.version })
  const authorize = (event: IpcMainInvokeEvent): void => {
    const window = options.window()
    const origin = options.origin()
    if (window === undefined || origin === undefined || event.sender !== window.webContents
      || event.senderFrame === null || event.senderFrame !== window.webContents.mainFrame
      || new URL(event.senderFrame.url).origin !== origin) throw new Error('Update IPC is restricted to the desktop main frame')
  }
  options.ipc.handle('mantur:updates:snapshot', (event) => { authorize(event); return snapshot() })
  for (const [name, action] of [
    ['check', 'checkNow'], ['download', 'downloadAvailableUpdate'], ['install', 'installReadyUpdate'],
  ] as const) {
    options.ipc.handle(`mantur:updates:${name}`, (event) => {
      authorize(event)
      const controller = options.controller()
      if (controller === undefined) throw new Error('Updates are unavailable in this build')
      controller[action]()
    })
  }
  return { publish: (next) => {
    state = next
    revision += 1
    const window = options.window()
    if (window === undefined || window.isDestroyed() || window.webContents.isDestroyed()) return
    const url = window.webContents.mainFrame.url
    if (url === '' || new URL(url).origin !== options.origin()) return
    window.webContents.send('mantur:updates:changed', snapshot())
  } }
}
