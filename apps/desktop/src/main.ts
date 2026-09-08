/** Thin native window over the shipped Mantur profile. */

import { appendFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, shell } from 'electron'
import electronUpdater from 'electron-updater'
import { DesktopDraftStorage } from './draft-storage.ts'
import { installDraftBridge } from './draft-bridge.ts'
import { installUpdateBridge } from './update-bridge.ts'
import { NativeAccountHost } from './auth/host.ts'
import type { NativeAccountController } from './auth/controller.ts'
import { installNativeAccountBridge } from './auth/ipc.ts'
import {
  canResetProjectionCache,
  initializeDesktopPaths,
  prepareDesktopPaths,
  resetProjectionCache,
} from './desktop-state.ts'
import { desktopCopy } from './locales.ts'
import { startDesktopService, type DesktopService } from './runtime.ts'
import { buildApplicationMenu } from './update-menu.ts'
import { startAutoUpdates, type DesktopUpdateController, type DesktopUpdateState } from './updater.ts'

const APP_NAME = '漫途Agent'
const APP_ICON = fileURLToPath(new URL('../resources/mantur-app-icon.png', import.meta.url))
const STARTUP_PAGE = fileURLToPath(new URL('../resources/startup.html', import.meta.url))

let mainWindow: BrowserWindow | undefined
let service: DesktopService | undefined
let serviceUrl: string | undefined
let quitting = false
let updates: DesktopUpdateController | undefined
let updateState: DesktopUpdateState = { kind: 'idle' }
let accountHost: NativeAccountHost | undefined
let nativeAccount: NativeAccountController | undefined

app.setName(APP_NAME)
const paths = initializeDesktopPaths(app, app.commandLine.hasSwitch('user-data-dir')
  ? app.commandLine.getSwitchValue('user-data-dir')
  : undefined)
const accountBridge = installNativeAccountBridge({ ipc: ipcMain, window: () => mainWindow,
  origin: () => serviceUrl === undefined ? undefined : new URL(serviceUrl).origin,
  controller: () => nativeAccount,
})
const drafts = installDraftBridge({ ipc: ipcMain, window: () => mainWindow,
  origin: () => serviceUrl === undefined ? undefined : new URL(serviceUrl).origin,
  storage: new DesktopDraftStorage(paths.userData),
})

const updateBridge = installUpdateBridge({ ipc: ipcMain, window: () => mainWindow,
  origin: () => serviceUrl === undefined ? undefined : new URL(serviceUrl).origin,
  controller: () => updates, version: app.getVersion(),
})

function writeDesktopLog(message: string): void {
  void appendFile(paths.logPath, `${new Date().toISOString()} ${message}\n`).catch((error: unknown) => {
    console.error(error)
  })
}

function isQuitting(): boolean {
  return quitting
}

function openExternal(url: string): void {
  if (!/^https?:\/\//u.test(url)) return
  void shell.openExternal(url).catch((error: unknown) => { console.error(error) })
}

function renderApplicationMenu(): void {
  const copy = desktopCopy(app.getLocale())
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildApplicationMenu({
    appName: APP_NAME,
    version: app.getVersion(),
    platform: process.platform,
    updatesEnabled: app.isPackaged && updates !== undefined,
    state: updateState,
    copy,
    onCheck: () => { updates?.checkNow() },
    onDownload: () => { updates?.downloadAvailableUpdate() },
    onInstall: () => { updates?.installReadyUpdate() },
  })))
}

function showUpdateFeedback(state: DesktopUpdateState): void {
  const failure = state.kind === 'ready' ? state.error
    : state.kind === 'error' && state.requestedByUser ? state.detail : undefined
  if (failure === undefined && !(state.kind === 'up-to-date' && state.requestedByUser)) return
  const copy = desktopCopy(app.getLocale())
  const error = failure !== undefined
  void dialog.showMessageBox({
    type: error ? 'error' : 'info',
    title: error ? copy.updateErrorTitle : copy.upToDateTitle,
    message: error ? copy.updateErrorMessage(failure) : copy.upToDateMessage(app.getVersion()),
    buttons: [copy.okButton],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  }).catch((dialogError: unknown) => {
    writeDesktopLog(`desktop update: feedback dialog failed: ${String(dialogError)}`)
  })
}

function createWindow(target = STARTUP_PAGE): BrowserWindow {
  const window = new BrowserWindow({
    width: 1_280,
    height: 820,
    minWidth: 880,
    minHeight: 600,
    show: false,
    backgroundColor: '#f7f8fa',
    title: APP_NAME,
    icon: APP_ICON,
    webPreferences: {
      preload: fileURLToPath(new URL('./preload.cjs', import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, target) => {
    if (serviceUrl !== undefined && new URL(target).origin === new URL(serviceUrl).origin) return
    event.preventDefault()
    openExternal(target)
  })
  window.webContents.on('did-start-navigation', (_event, _url, _isInPlace, isMainFrame) => {
    if (isMainFrame) drafts.release()
  })
  window.once('ready-to-show', () => { window.show() })
  window.on('closed', () => { drafts.release(); mainWindow = undefined })
  if (target === STARTUP_PAGE) void window.loadFile(target)
  else void window.loadURL(target)
  mainWindow = window
  return window
}

async function startupRecovery(error: unknown): Promise<'reset-cache' | 'show-log' | 'quit'> {
  const copy = desktopCopy(app.getLocale())
  const detail = error instanceof Error ? error.message : String(error)
  const resettable = canResetProjectionCache(error)
  const buttons = resettable
    ? [copy.resetCacheButton, copy.showLogButton, copy.quitButton]
    : [copy.showLogButton, copy.quitButton]
  const { response } = await dialog.showMessageBox({
    type: 'error',
    title: copy.startupFailedTitle,
    message: copy.startupFailedMessage,
    detail,
    buttons,
    defaultId: buttons.length - 1,
    cancelId: buttons.length - 1,
    noLink: true,
  })
  if (resettable && response === 0) return 'reset-cache'
  return response === buttons.length - 2 ? 'show-log' : 'quit'
}

async function launch(): Promise<void> {
  const window = createWindow()
  await prepareDesktopPaths(paths)
  while (!quitting) {
    serviceUrl = undefined
    service = startDesktopService({
      electronExecutable: process.execPath,
      cwd: paths.launchRoot,
      environment: {
        ...process.env,
        DSH_HOME: paths.dshHome,
        DSH_MANTUR_PROJECTS_ROOT: join(app.getPath('documents'), '漫途项目'),
        DSH_MANTUR_NATIVE_ACCOUNT: '1',
        ...(app.isPackaged ? {
          DSH_MANTUR_EDITOR_ROOT: join(process.resourcesPath, 'mantur-cut'),
          DSH_MANTUR_EDITOR_NODE: process.execPath,
        } : {}),
      },
      logPath: paths.logPath,
      mirrorOutput: !app.isPackaged,
    })
    if (process.platform !== 'darwin' && process.platform !== 'win32') throw new Error('Native account requires macOS or Windows')
    accountHost = new NativeAccountHost({ child: service.child, userData: paths.userData, cipher: safeStorage,
      deviceName: `${APP_NAME} — ${hostname()}`, platform: process.platform === 'darwin' ? 'macos' : 'windows',
      openBrowser: url => shell.openExternal(url), onController: (controller) => { nativeAccount = controller },
      onSnapshot: () => { accountBridge.publish() },
    })
    service.child.once('exit', (code, signal) => {
      if (quitting || serviceUrl === undefined) return
      void startupRecovery(new Error(
        `dsh stopped while the desktop window was running (code ${String(code)}, signal ${String(signal)}).`,
      )).then((action) => {
        if (action === 'show-log') shell.showItemInFolder(paths.logPath)
        app.quit()
      })
    })
    try {
      serviceUrl = await service.ready
      await window.loadURL(serviceUrl)
      startUpdates()
      return
    } catch (error) {
      if (isQuitting()) return
      const action = await startupRecovery(error)
      if (action === 'reset-cache') {
        await accountHost.close()
        accountHost = undefined
        await resetProjectionCache(paths.dshHome)
        writeDesktopLog('desktop recovery: reset session projection cache after user approval')
        continue
      }
      if (action === 'show-log') shell.showItemInFolder(paths.logPath)
      app.quit()
      return
    }
  }
}

async function stopService(): Promise<void> {
  const active = service
  if (active === undefined) return
  await accountHost?.close()
  accountHost = undefined
  active.stop()
  await active.closed
  if (service === active) service = undefined
}

function startUpdates(): void {
  if (!app.isPackaged || updates !== undefined) return
  const copy = desktopCopy(app.getLocale())
  const { autoUpdater } = electronUpdater
  updates = startAutoUpdates({
    updater: autoUpdater,
    currentVersion: app.getVersion(),
    log: writeDesktopLog,
    onStateChange: (state) => {
      updateState = state
      updateBridge.publish(state)
      renderApplicationMenu()
      showUpdateFeedback(state)
    },
    beforeInstall: async () => {
      try {
        await drafts.prepare()
        throw new Error(copy.updateShutdownUnavailable)
      } catch (error) {
        drafts.release()
        throw error
      }
    },
    prompts: {
      confirmInstall: async (version) => {
        const result = await dialog.showMessageBox({
          type: 'info',
          title: copy.updateReadyTitle,
          message: copy.updateReadyMessage(version),
          buttons: [copy.restartButton, copy.laterButton],
          defaultId: 1,
          cancelId: 1,
          noLink: true,
        })
        return result.response === 0
      },
    },
  })
  updateBridge.publish(updateState)
  renderApplicationMenu()
}

const singleInstance = app.requestSingleInstanceLock()
if (!singleInstance) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow?.isMinimized() === true) mainWindow.restore()
    mainWindow?.show()
    mainWindow?.focus()
  })
  void app.whenReady().then(() => {
    if (process.platform === 'darwin') app.dock?.setIcon(APP_ICON)
    app.setAboutPanelOptions({
      applicationName: APP_NAME,
      applicationVersion: app.getVersion(),
      iconPath: APP_ICON,
    })
    renderApplicationMenu()
    return launch()
  }).catch((error: unknown) => {
    writeDesktopLog(`desktop startup: ${String(error)}`)
    void startupRecovery(error).then((action) => {
      if (action === 'show-log') shell.showItemInFolder(paths.logPath)
      app.quit()
    })
  })
}

app.on('activate', () => {
  if (mainWindow === undefined && serviceUrl !== undefined) {
    createWindow(serviceUrl)
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', (event) => {
  quitting = true
  updates?.dispose()
  updates = undefined
  if (service === undefined) return
  event.preventDefault()
  void stopService().then(() => { app.quit() }).catch((error: unknown) => {
    console.error(error)
    app.exit(1)
  })
})

process.once('SIGINT', () => { app.quit() })
process.once('SIGTERM', () => { app.quit() })

process.on('uncaughtException', (error) => {
  console.error(error)
  if (!quitting) app.quit()
})
