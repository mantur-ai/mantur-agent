/** User-controlled automatic and manual update checks for installed desktop builds. */

import type { UpdateDownloadedEvent, UpdateInfo } from 'electron-updater'

export const UPDATE_CHECK_DELAY_MS = 15_000
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000

/** State published for native desktop update controls. */
export type DesktopUpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available'; version: string; prompting: boolean }
  | { kind: 'downloading'; version: string; percent: number | null; transferred: number; total: number | null }
  | { kind: 'ready'; version: string; prompting: boolean; error?: string }
  | { kind: 'up-to-date'; requestedByUser: boolean }
  | { kind: 'error'; detail: string; requestedByUser: boolean }

/** The electron-updater operations used by the desktop controller. */
export interface DesktopUpdater {
  /** Whether an available version downloads without application approval. */
  autoDownload: boolean
  /** Whether a downloaded version installs during an unrelated application quit. */
  autoInstallOnAppQuit: boolean
  /** Whether prerelease versions participate in update selection. */
  allowPrerelease: boolean
  /** Check the configured release feed once. */
  checkForUpdates: () => Promise<unknown>
  /** Download the version most recently reported as available. */
  downloadUpdate: () => Promise<unknown>
  /** Quit the application and run the downloaded installer. */
  quitAndInstall: (isSilent?: boolean, isForceRunAfter?: boolean) => void
  /** Register one updater lifecycle listener. */
  on: {
    (event: 'update-available' | 'update-not-available', listener: (info: UpdateInfo) => void): void
    (event: 'download-progress', listener: (info: { percent: number; transferred: number; total: number }) => void): void
    (event: 'update-downloaded', listener: (info: UpdateDownloadedEvent) => void): void
    (event: 'error', listener: (error: Error) => void): void
  }
  /** Remove one updater lifecycle listener. */
  off: {
    (event: 'update-available' | 'update-not-available', listener: (info: UpdateInfo) => void): void
    (event: 'download-progress', listener: (info: { percent: number; transferred: number; total: number }) => void): void
    (event: 'update-downloaded', listener: (info: UpdateDownloadedEvent) => void): void
    (event: 'error', listener: (error: Error) => void): void
  }
}

/** Prompts owned by the native desktop update flow. */
export interface UpdatePrompts {
  /** Ask before stopping Harness and installing a downloaded version. */
  confirmInstall: (version: string) => Promise<boolean>
}

/** Dependencies and lifecycle callbacks for one updater controller. */
export interface StartAutoUpdatesOptions {
  updater: DesktopUpdater
  currentVersion: string
  prompts: UpdatePrompts
  beforeInstall: () => Promise<void>
  onStateChange: (state: DesktopUpdateState) => void
  log: (message: string) => void
  /** Describe updater failures for users; raw details remain in the diagnostic log. */
  describeError: (error: unknown) => string
  checkDelayMs?: number
  checkIntervalMs?: number
}

/** Controls scheduled checks and user-requested update actions. */
export interface DesktopUpdateController {
  /** Return the latest state published to native update controls. */
  getState: () => DesktopUpdateState
  /** Check the configured release feed after an explicit user action. */
  checkNow: () => void
  /** Download the available version after an explicit user action. */
  downloadAvailableUpdate: () => void
  /** Ask again to install the downloaded version represented by the ready state. */
  installReadyUpdate: () => void
  /** Stop scheduled work and ignore pending prompt completions. */
  dispose: () => void
}

const PRERELEASE_CHANNEL = /-(?:alpha|beta|rc)(?:[.-]|$)/iu

/** Return whether a desktop version participates in alpha, beta, or RC releases. */
export function allowsPrerelease(version: string): boolean {
  return PRERELEASE_CHANNEL.test(version)
}

/**
 * Start delayed and periodic update checks and expose manual update actions.
 * @returns a controller that owns schedules, listeners, and pending prompt work.
 */
export function startAutoUpdates(options: StartAutoUpdatesOptions): DesktopUpdateController {
  const { updater } = options
  updater.autoDownload = false
  updater.autoInstallOnAppQuit = false
  updater.allowPrerelease = allowsPrerelease(options.currentVersion)
  let active = true
  let checkingManually = false
  let checkAttempt = 0
  let downloadPending = false
  let installAttempt = 0
  let downloadedVersion: string | undefined
  let state: DesktopUpdateState = { kind: 'idle' }

  const publish = (next: DesktopUpdateState): void => {
    state = next
    options.onStateChange(next)
  }

  const fail = (error: unknown, requestedByUser: boolean): void => {
    if (!active) return
    if (state.kind === 'checking' && error instanceof Error && 'code' in error && error.code === 'ERR_UPDATER_NO_NEWER_RELEASE') {
      publish({ kind: 'up-to-date', requestedByUser })
      return
    }
    options.log(`desktop update: ${error instanceof Error ? error.message : String(error)}`)
    const detail = options.describeError(error)
    if (state.kind === 'ready') {
      installAttempt += 1
      publish({ kind: 'ready', version: state.version, prompting: false, error: detail })
      return
    }
    if (state.kind !== 'error' || state.detail !== detail || state.requestedByUser !== requestedByUser) {
      publish({ kind: 'error', detail, requestedByUser })
    }
  }

  const installReadyUpdate = (): void => {
    if (!active || state.kind !== 'ready' || state.prompting) return
    const version = state.version
    const attempt = ++installAttempt
    publish({ kind: 'ready', version, prompting: true })
    void Promise.resolve().then(() => active && attempt === installAttempt
      ? options.prompts.confirmInstall(version) : false).then(async (confirmed) => {
      if (!active || attempt !== installAttempt) return
      if (!confirmed) {
        publish({ kind: 'ready', version, prompting: false })
        return
      }
      await options.beforeInstall()
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- dispose can run while Harness shutdown awaits.
      if (!active || attempt !== installAttempt) return
      updater.quitAndInstall(false, true)
    }).catch((error: unknown) => {
      if (!active || attempt !== installAttempt) return
      const detail = error instanceof Error ? error.message : String(error)
      options.log(`desktop update: ${detail}`)
      publish({ kind: 'ready', version, prompting: false, error: detail })
    })
  }

  const onAvailable = (info: UpdateInfo): void => {
    checkingManually = false
    if (!active
      || state.kind === 'downloading'
      || state.kind === 'ready'
      || (state.kind === 'available' && state.prompting)) return
    const version = info.version
    publish({ kind: 'available', version, prompting: false })
  }

  const downloadAvailableUpdate = (): void => {
    if (!active || downloadPending || state.kind !== 'available') return
    const version = state.version
    downloadPending = true
    publish({ kind: 'downloading', version, percent: null, transferred: 0, total: null })
    options.log(`desktop update: downloading ${version}`)
    void Promise.resolve().then(() => {
      if (active && state.kind === 'downloading' && state.version === version) return updater.downloadUpdate()
    }).catch((error: unknown) => {
      if (state.kind === 'downloading') fail(error, true)
    }).finally(() => { downloadPending = false })
  }

  const onNotAvailable = (): void => {
    if (!active || state.kind !== 'checking') return
    const requestedByUser = checkingManually
    checkingManually = false
    publish({ kind: 'up-to-date', requestedByUser })
  }

  const onDownloadProgress = (info: { percent: number; transferred: number; total: number }): void => {
    if (!active || state.kind !== 'downloading') return
    if (!Number.isFinite(info.transferred) || info.transferred < 0) { fail(new Error('Invalid download byte count'), true); return }
    const transferred = info.transferred
    const total = Number.isFinite(info.total) && info.total > 0 ? info.total : null
    const percent = total === null || !Number.isFinite(info.percent)
      ? null : Math.max(0, Math.min(100, Math.floor(info.percent)))
    if (percent !== state.percent || transferred !== state.transferred || total !== state.total) {
      publish({ ...state, percent, transferred, total })
    }
  }

  const onDownloaded = (info: UpdateDownloadedEvent): void => {
    if (!active || downloadedVersion === info.version) return
    downloadedVersion = info.version
    publish({ kind: 'ready', version: info.version, prompting: false })
    installReadyUpdate()
  }

  const onError = (error: Error): void => {
    const requestedByUser = checkingManually
      || state.kind === 'downloading'
      || (state.kind === 'available' && state.prompting)
      || (state.kind === 'ready' && state.prompting)
    checkingManually = false
    fail(error, requestedByUser)
  }

  updater.on('update-available', onAvailable)
  updater.on('update-not-available', onNotAvailable)
  updater.on('download-progress', onDownloadProgress)
  updater.on('update-downloaded', onDownloaded)
  updater.on('error', onError)

  const check = (manual: boolean): void => {
    if (!active || downloadPending
      || state.kind === 'checking'
      || state.kind === 'downloading'
      || state.kind === 'ready'
      || (state.kind === 'available' && state.prompting)) return
    if (!manual && state.kind === 'available') return
    const attempt = ++checkAttempt
    checkingManually = manual
    publish({ kind: 'checking' })
    options.log('desktop update: checking')
    void updater.checkForUpdates().catch((error: unknown) => {
      if (attempt !== checkAttempt || state.kind !== 'checking') return
      checkingManually = false
      fail(error, manual)
    })
  }
  const delay = setTimeout(() => { check(false) }, options.checkDelayMs ?? UPDATE_CHECK_DELAY_MS)
  const interval = setInterval(() => { check(false) }, options.checkIntervalMs ?? UPDATE_CHECK_INTERVAL_MS)

  const dispose = (): void => {
    active = false
    clearTimeout(delay)
    clearInterval(interval)
    updater.off('update-available', onAvailable)
    updater.off('update-not-available', onNotAvailable)
    updater.off('download-progress', onDownloadProgress)
    updater.off('update-downloaded', onDownloaded)
    updater.off('error', onError)
  }

  return {
    getState: () => state,
    checkNow: () => { check(true) },
    downloadAvailableUpdate,
    installReadyUpdate,
    dispose,
  }
}
