/** The shipped Main and preload wire directory selection into window and update lifetimes. */
import { resolve } from 'node:path'
import type { IpcMainInvokeEvent, OpenDialogReturnValue } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { desktopCopy } from '../src/locales.ts'
import type { StartAutoUpdatesOptions } from '../src/updater.ts'

const native = vi.hoisted(() => ({
  app: {
    setName: vi.fn(), getVersion: () => '1.0.0', getLocale: () => 'en', isPackaged: true,
    commandLine: { hasSwitch: () => false }, requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(), on: vi.fn<(name: string, handler: unknown) => void>(), setAboutPanelOptions: vi.fn(),
    getPath: () => '/desktop-documents', dock: { setIcon: vi.fn() }, quit: vi.fn(), exit: vi.fn(),
  },
  window: {
    webContents: { mainFrame: { url: 'http://127.0.0.1:40001/' },
      setWindowOpenHandler: vi.fn(), on: vi.fn<(name: string, handler: unknown) => void>(), isDestroyed: () => false },
    once: vi.fn(), on: vi.fn<(name: string, handler: unknown) => void>(),
    loadFile: vi.fn(async () => {}), loadURL: vi.fn(async () => {}), isDestroyed: () => false,
  },
  ipcMain: { handle: vi.fn<(name: string, handler: unknown) => void>() },
  ipcRenderer: { invoke: vi.fn<(channel: string) => Promise<unknown>>() },
  contextBridge: { exposeInMainWorld: vi.fn<(name: string, value: unknown) => void>() },
  dialog: { showOpenDialog: vi.fn(), showMessageBox: vi.fn() },
  drafts: { prepare: vi.fn(async () => 0), release: vi.fn() },
  account: { close: vi.fn(async () => {}) },
  service: { child: { once: vi.fn() }, ready: Promise.resolve('http://127.0.0.1:40001/'),
    stopAndVerifyExit: vi.fn(async () => {}), stop: vi.fn(), closed: Promise.resolve() },
  requestUpdateSave: vi.fn(async () => []), startAutoUpdates: vi.fn<(options: StartAutoUpdatesOptions) => unknown>(),
  appendFile: vi.fn(async () => {}),
}))

vi.mock('node:fs/promises', async importOriginal => ({
  ...await importOriginal<typeof import('node:fs/promises')>(), appendFile: native.appendFile,
}))
vi.mock('electron', () => ({
  app: native.app, BrowserWindow: vi.fn(function () { return native.window }),
  ipcMain: native.ipcMain, ipcRenderer: native.ipcRenderer, contextBridge: native.contextBridge,
  dialog: native.dialog, Menu: { setApplicationMenu: vi.fn(), buildFromTemplate: vi.fn() },
  safeStorage: {}, shell: { openExternal: vi.fn(), showItemInFolder: vi.fn() },
}))
vi.mock('electron-updater', () => ({ default: { autoUpdater: {} } }))
vi.mock('../src/desktop-state.ts', () => ({
  initializeDesktopPaths: () => ({
    userData: '/desktop-user-data', launchRoot: '/desktop-launch', dshHome: '/desktop-home', logPath: '/desktop-log',
  }),
  prepareDesktopPaths: async () => {}, canResetProjectionCache: () => false, resetProjectionCache: vi.fn(),
}))
vi.mock('../src/draft-storage.ts', () => ({ DesktopDraftStorage: vi.fn(function () {}) }))
vi.mock('../src/draft-bridge.ts', () => ({ installDraftBridge: () => native.drafts }))
vi.mock('../src/auth/host.ts', () => ({ NativeAccountHost: vi.fn(function () { return native.account }) }))
vi.mock('../src/auth/ipc.ts', () => ({ installNativeAccountBridge: () => ({ publish: vi.fn() }) }))
vi.mock('../src/update-bridge.ts', () => ({ installUpdateBridge: () => ({ publish: vi.fn() }) }))
vi.mock('../src/runtime.ts', () => ({ startDesktopService: () => native.service }))
vi.mock('../src/update-save.ts', () => ({ requestUpdateSave: native.requestUpdateSave }))
vi.mock('../src/updater.ts', () => ({ startAutoUpdates: native.startAutoUpdates }))

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
const resourcesPath = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.spyOn(process, 'on').mockReturnValue(process)
  vi.spyOn(process, 'once').mockReturnValue(process)
  // Main runs inside Electron on macOS or Windows; no native platform APIs execute in this fixture.
  Object.defineProperty(process, 'platform', { value: 'darwin' })
  Object.defineProperty(process, 'resourcesPath', { configurable: true, value: '/desktop-resources' })
  native.dialog.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
  native.dialog.showMessageBox.mockResolvedValue({ response: 0 })
  native.startAutoUpdates.mockReturnValue({ dispose: vi.fn() })
})
afterEach(() => {
  vi.restoreAllMocks()
  Object.defineProperty(process, 'platform', platform)
  if (resourcesPath === undefined) Reflect.deleteProperty(process, 'resourcesPath')
  else Object.defineProperty(process, 'resourcesPath', resourcesPath)
})

async function startup() {
  await import('../src/main.ts')
  await vi.waitFor(() => {
    expect(native.appendFile).not.toHaveBeenCalled()
    expect(native.startAutoUpdates).toHaveBeenCalledOnce()
  })
  const registration = native.ipcMain.handle.mock.calls.find(([name]) => name === 'mantur:directory-picker:pick')
  expect(registration, 'Main must register the native directory picker').toBeDefined()
  const handler = registration![1] as (event: IpcMainInvokeEvent) => Promise<string | null>
  const pick = () => handler({
    sender: native.window.webContents, senderFrame: native.window.webContents.mainFrame,
  } as unknown as IpcMainInvokeEvent)
  const beforeInstall = native.startAutoUpdates.mock.calls[0]![0].beforeInstall
  return { pick, beforeInstall }
}

describe('desktop directory picker wiring', () => {
  it('exposes one fixed parameterless preload operation', async () => {
    await import('../src/preload.ts')
    const registration = native.contextBridge.exposeInMainWorld.mock.calls.find(([name]) => name === 'manturDirectoryPicker')
    expect(registration, 'Preload must expose the native directory picker').toBeDefined()
    const bridge = registration![1] as { pick: () => Promise<string | null> }
    expect(Object.keys(bridge)).toEqual(['pick'])
    native.ipcRenderer.invoke.mockResolvedValueOnce(resolve('chosen directory'))
    await expect(bridge.pick()).resolves.toBe(resolve('chosen directory'))
    expect(native.ipcRenderer.invoke).toHaveBeenCalledExactlyOnceWith('mantur:directory-picker:pick')
  })

  it('refuses update preparation before draft or Host saving while a chooser is open', async () => {
    const subject = await startup()
    const result = Promise.withResolvers<OpenDialogReturnValue>()
    native.dialog.showOpenDialog.mockReturnValueOnce(result.promise)
    const pending = subject.pick()
    try {
      await expect(subject.beforeInstall()).rejects.toThrow(desktopCopy('en').updateDirectoryPickerPending)
      expect(native.drafts.prepare).not.toHaveBeenCalled()
      expect(native.requestUpdateSave).not.toHaveBeenCalled()
      expect(native.account.close).not.toHaveBeenCalled()
      expect(native.service.stopAndVerifyExit).not.toHaveBeenCalled()
      expect(native.dialog.showOpenDialog).toHaveBeenCalledExactlyOnceWith(native.window, {
        title: desktopCopy('en').directoryPickerTitle, properties: ['openDirectory'],
      })
    } finally { result.resolve({ canceled: true, filePaths: [] }); await pending }
    await expect(subject.pick()).resolves.toBeNull()
    await subject.beforeInstall()
    expect(native.drafts.prepare).toHaveBeenCalledOnce()
    expect(native.requestUpdateSave).toHaveBeenCalledOnce()
    expect(native.service.stopAndVerifyExit).toHaveBeenCalledOnce()
  })

  it('blocks selection during update preparation and preserves save failure', async () => {
    const subject = await startup()
    const checkpoint = Promise.withResolvers<number>()
    native.drafts.prepare.mockReturnValueOnce(checkpoint.promise)
    const preparing = subject.beforeInstall()
    const error = new Error('draft checkpoint failed')
    const rejected = expect(preparing).rejects.toBe(error)
    try {
      await expect(subject.pick()).rejects.toThrow(desktopCopy('en').directoryPickerUnavailable)
      expect(native.dialog.showOpenDialog).not.toHaveBeenCalled()
    } finally { checkpoint.reject(error); await rejected }
    expect(native.drafts.release).toHaveBeenCalledOnce()
    expect(native.requestUpdateSave).not.toHaveBeenCalled()
    expect(native.service.stopAndVerifyExit).not.toHaveBeenCalled()
    await expect(subject.pick()).resolves.toBeNull()
  })

  it.each(['navigation', 'closed', 'quit'] as const)('invalidates a pending selection on %s', async (event) => {
    const subject = await startup()
    const result = Promise.withResolvers<OpenDialogReturnValue>()
    native.dialog.showOpenDialog.mockReturnValueOnce(result.promise)
    const pending = subject.pick()
    const rejected = expect(pending).rejects.toThrow()
    try {
      if (event === 'navigation') {
        const navigate = native.window.webContents.on.mock.calls.find(([name]) => name === 'did-start-navigation')![1] as
          (...args: unknown[]) => void
        navigate({}, native.window.webContents.mainFrame.url, false, true)
        await expect(subject.beforeInstall()).rejects.toThrow(desktopCopy('en').updateDirectoryPickerPending)
      }
      if (event === 'closed') {
        const closed = native.window.on.mock.calls.find(([name]) => name === 'closed')![1] as () => void
        closed()
      }
      if (event === 'quit') {
        const quitting = native.app.on.mock.calls.find(([name]) => name === 'before-quit')![1] as
          (event: { preventDefault: () => void }) => void
        quitting({ preventDefault: vi.fn() })
        await expect(subject.pick()).rejects.toThrow(desktopCopy('en').directoryPickerUnavailable)
      }
    } finally { result.resolve({ canceled: false, filePaths: [resolve('late directory')] }); await rejected }
  })
})
