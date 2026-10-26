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
    webContents: { session: { cookies: { get: vi.fn(async () => []), remove: vi.fn(async () => {}) } }, mainFrame: { url: 'http://127.0.0.1:40001/' },
      setWindowOpenHandler: vi.fn(), on: vi.fn<(name: string, handler: unknown) => void>(), isDestroyed: () => false },
    once: vi.fn(), on: vi.fn<(name: string, handler: unknown) => void>(),
    loadFile: vi.fn(async () => {}), loadURL: vi.fn(async () => {}), isDestroyed: () => false,
  },
  ipcMain: { handle: vi.fn<(name: string, handler: unknown) => void>() },
  ipcRenderer: { invoke: vi.fn<(channel: string, ...args: unknown[]) => Promise<unknown>>(), on: vi.fn(), removeListener: vi.fn() },
  contextBridge: { exposeInMainWorld: vi.fn<(name: string, value: unknown) => void>() },
  dialog: { showOpenDialog: vi.fn(), showMessageBox: vi.fn() },
  drafts: { prepare: vi.fn(async () => 0), release: vi.fn() },
  cutExport: { isPending: () => false, invalidate: vi.fn(async () => {}) },
  account: { close: vi.fn(async () => {}) },
  service: { child: { once: vi.fn() }, ready: Promise.resolve('http://127.0.0.1:40001/'),
    stopAndVerifyExit: vi.fn(async () => {}), stop: vi.fn(), closed: Promise.resolve() },
  requestUpdateSave: vi.fn(async () => []), startAutoUpdates: vi.fn<(options: StartAutoUpdatesOptions) => unknown>(),
  appendFile: vi.fn(async () => {}),
  upgrade: vi.fn<(root: string, cipher: unknown, confirm: () => Promise<boolean>) => Promise<boolean>>(),
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
vi.mock('../src/cut-export-bridge.ts', () => ({ installCutExportBridge: () => native.cutExport }))
vi.mock('../src/auth/host.ts', () => ({ NativeAccountHost: vi.fn(function () { return native.account }) }))
vi.mock('../src/auth/ipc.ts', () => ({ installNativeAccountBridge: () => ({ publish: vi.fn() }) }))
vi.mock('../src/update-bridge.ts', () => ({ installUpdateBridge: () => ({ publish: vi.fn() }) }))
vi.mock('../src/auth/upgrade.ts', () => ({ prepareNativeAccountUpgrade: native.upgrade }))
vi.mock('../src/embedded-cli.ts', () => ({
  prepareEmbeddedCli: async () => '/desktop-user-data/managed-cli-bin',
  embeddedCliEnvironment: (_bin: string, environment: NodeJS.ProcessEnv) => environment,
}))
vi.mock('../src/runtime.ts', () => ({ startDesktopService: () => native.service }))
vi.mock('../src/update-save.ts', () => ({ requestUpdateSave: native.requestUpdateSave }))
vi.mock('../src/updater.ts', () => ({ startAutoUpdates: native.startAutoUpdates }))

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
const resourcesPath = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  native.service.closed = Promise.resolve()
  vi.spyOn(process, 'on').mockReturnValue(process)
  vi.spyOn(process, 'once').mockReturnValue(process)
  // Main runs inside Electron on macOS or Windows; no native platform APIs execute in this fixture.
  Object.defineProperty(process, 'platform', { value: 'darwin' })
  Object.defineProperty(process, 'resourcesPath', { configurable: true, value: '/desktop-resources' })
  native.dialog.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
  native.dialog.showMessageBox.mockImplementation((_window: unknown, options?: { signal?: AbortSignal }) => {
    const signal = options?.signal
    if (signal === undefined) return Promise.resolve({ response: 0 })
    return new Promise<{ response: number }>((resolve) => {
      if (signal.aborted) resolve({ response: 0 })
      else signal.addEventListener('abort', () => { resolve({ response: 0 }) }, { once: true })
    })
  })
  native.startAutoUpdates.mockReturnValue({ dispose: vi.fn() })
  native.upgrade.mockResolvedValue(true)
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
  it('rechecks export cleanup after a renderer retry before preparing an update', async () => {
    const subject = await startup()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    native.cutExport.invalidate.mockRejectedValueOnce(new Error('temporary unlink failure'))
    const navigate = native.window.webContents.on.mock.calls.find(([name]) => name === 'did-start-navigation')![1] as
      (event: unknown, url: string, inPlace: boolean, mainFrame: boolean) => void
    navigate({}, 'http://127.0.0.1:40001/', false, true)
    await vi.waitFor(() => { expect(console.error).toHaveBeenCalled() })
    await native.cutExport.invalidate()
    await subject.beforeInstall()
    expect(native.cutExport.invalidate).toHaveBeenCalledTimes(3)
    expect(native.service.stopAndVerifyExit).toHaveBeenCalledOnce()
  })

  it('waits for old connection cookies to be removed before loading the new Host', async () => {
    const cleared = Promise.withResolvers<never[]>()
    native.window.webContents.session.cookies.get.mockReturnValueOnce(cleared.promise)
    await import('../src/main.ts')
    await vi.waitFor(() => { expect(native.window.webContents.session.cookies.get).toHaveBeenCalledOnce() })
    expect(native.window.loadURL).not.toHaveBeenCalled()
    cleared.resolve([])
    await vi.waitFor(() => { expect(native.window.loadURL).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1:40001/') })
  })

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

  it('refuses update preparation before Host saving while a chooser is open', async () => {
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
    const checkpoint = Promise.withResolvers<never[]>()
    native.requestUpdateSave.mockReturnValueOnce(checkpoint.promise)
    const preparing = subject.beforeInstall()
    const error = new Error('Host checkpoint failed')
    const rejected = expect(preparing).rejects.toBe(error)
    try {
      await expect(subject.pick()).rejects.toThrow(desktopCopy('en').directoryPickerUnavailable)
      expect(native.dialog.showOpenDialog).not.toHaveBeenCalled()
      expect(native.dialog.showMessageBox).not.toHaveBeenCalled()
      expect(native.drafts.release).not.toHaveBeenCalled()
    } finally { checkpoint.reject(error); await rejected }
    expect(native.drafts.release).toHaveBeenCalledOnce()
    expect(native.requestUpdateSave).toHaveBeenCalledOnce()
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

describe('client-session startup', () => {
  it('retains the Keychain identity while displaying the current brand', async () => {
    await startup()
    expect(native.app.setName).toHaveBeenCalledExactlyOnceWith('漫途Agent')
    expect(native.app.setAboutPanelOptions).toHaveBeenCalledWith(expect.objectContaining({ applicationName: 'ManTur Agent' }))
  })

  it('opens the Host without migrating or prompting to replace retired device-grant storage', async () => {
    await startup()
    expect(native.upgrade).not.toHaveBeenCalled()
    expect(native.dialog.showMessageBox).not.toHaveBeenCalled()
    expect(native.window.loadURL).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1:40001/')
    expect(native.app.quit).not.toHaveBeenCalled()
  })
})

describe('native draft wiring', () => {
  it('exposes fixed draft operations on macOS and omits them on Windows', async () => {
    await import('../src/preload.ts')
    const registration = native.contextBridge.exposeInMainWorld.mock.calls.find(([name]) => name === 'manturDrafts')
    expect(registration).toBeDefined()
    const bridge = registration![1] as { load(): Promise<unknown>; save(value: unknown): Promise<unknown> }
    await bridge.load()
    const checkpoint = { format: 1, revision: 1, drafts: [] }
    await bridge.save(checkpoint)
    expect(native.ipcRenderer.invoke.mock.calls).toEqual([
      ['mantur:drafts:load'], ['mantur:drafts:save', checkpoint],
    ])
    vi.resetModules()
    native.contextBridge.exposeInMainWorld.mockClear()
    Object.defineProperty(process, 'platform', { value: 'win32' })
    await import('../src/preload.ts')
    expect(native.contextBridge.exposeInMainWorld.mock.calls.some(([name]) => name === 'manturDrafts')).toBe(false)
  })

  it('waits for the draft receipt before stopping the Host and ignores repeated quit requests', async () => {
    await startup()
    const receipt = Promise.withResolvers<number>()
    const closed = Promise.withResolvers<undefined>()
    native.service.closed = closed.promise
    native.drafts.prepare.mockReturnValueOnce(receipt.promise)
    const quit = native.app.on.mock.calls.find(([name]) => name === 'before-quit')![1] as
      (event: { preventDefault(): void }) => void
    const preventDefault = vi.fn()
    quit({ preventDefault })
    quit({ preventDefault })
    await vi.waitFor(() => { expect(native.drafts.prepare).toHaveBeenCalledOnce() })
    expect(native.service.stop).not.toHaveBeenCalled()
    expect(native.app.quit).not.toHaveBeenCalled()
    receipt.resolve(7)
    await vi.waitFor(() => { expect(native.service.stop).toHaveBeenCalledOnce() })
    quit({ preventDefault })
    expect(native.app.quit).not.toHaveBeenCalled()
    expect(preventDefault).toHaveBeenCalledTimes(3)
    closed.resolve(undefined)
    await vi.waitFor(() => { expect(native.app.quit).toHaveBeenCalledOnce() })
    expect(native.service.stop).toHaveBeenCalledOnce()
    quit({ preventDefault })
    expect(preventDefault).toHaveBeenCalledTimes(3)
  })

  it('keeps the Host and editor available after a failed quit save, then permits retry', async () => {
    const subject = await startup()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    native.drafts.prepare.mockRejectedValueOnce(new Error('checkpoint write failed'))
    const quit = native.app.on.mock.calls.find(([name]) => name === 'before-quit')![1] as
      (event: { preventDefault(): void }) => void
    quit({ preventDefault: vi.fn() })
    await vi.waitFor(() => { expect(native.drafts.release).toHaveBeenCalledOnce() })
    expect(native.service.stop).not.toHaveBeenCalled()
    expect(native.app.quit).not.toHaveBeenCalled()
    expect(native.app.exit).not.toHaveBeenCalled()
    expect(native.dialog.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({ message: desktopCopy('en').draftQuitFailed }))
    await expect(subject.pick()).resolves.toBeNull()
    quit({ preventDefault: vi.fn() })
    await vi.waitFor(() => { expect(native.app.quit).toHaveBeenCalledOnce() })
  })

  it('does not overlap a quit checkpoint with update preparation', async () => {
    const subject = await startup()
    const receipt = Promise.withResolvers<number>()
    native.drafts.prepare.mockReturnValueOnce(receipt.promise)
    const installation = subject.beforeInstall()
    const quit = native.app.on.mock.calls.find(([name]) => name === 'before-quit')![1] as
      (event: { preventDefault(): void }) => void
    quit({ preventDefault: vi.fn() })
    await vi.waitFor(() => { expect(native.drafts.prepare).toHaveBeenCalledOnce() })
    receipt.resolve(1)
    await installation
    expect(native.service.stopAndVerifyExit).toHaveBeenCalledOnce()
    expect(native.app.quit).not.toHaveBeenCalled()
  })
})

it('records the localized refusal to quit without saved drafts', () => {
  expect([desktopCopy('en').draftQuitFailed, desktopCopy('zh-CN').draftQuitFailed]).toMatchInlineSnapshot(`
    [
      "Drafts could not be saved safely. The app remains open; keep this window and try again.",
      "草稿尚未安全保存，应用未退出。请保留窗口并重试。",
    ]
  `)
})

it.each(['en', 'zh-CN'])('records account recovery dialog copy for %s', (locale) => {
  const copy = desktopCopy(locale)
  expect({
    title: copy.accountUpgradeTitle, message: copy.accountUpgradeMessage, detail: copy.accountUpgradeDetail,
    confirm: copy.accountUpgradeButton, cancel: copy.quitButton,
    failure: copy.accountUpgradeFailed, failureDetail: copy.accountUpgradeFailedDetail,
  }).toMatchSnapshot()
})
