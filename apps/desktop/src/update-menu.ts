/** Native application-menu projection of desktop update state. */

import type { MenuItemConstructorOptions } from 'electron'
import type { DesktopUpdateState } from './updater.ts'

/** Localized copy required by the desktop update menu. */
export interface UpdateMenuCopy {
  aboutMenu: string
  editMenu: string
  viewMenu: string
  windowMenu: string
  helpMenu: string
  currentVersion: (version: string) => string
  checkForUpdates: string
  checkingForUpdates: string
  updateAvailableStatus: (version: string) => string
  downloadUpdate: (version: string) => string
  downloadProgress: (version: string, percent: number | null) => string
  updateReadyStatus: (version: string) => string
  installUpdate: (version: string) => string
  upToDateStatus: string
  updateErrorStatus: string
}

/** Inputs for one native application-menu projection. */
export interface BuildApplicationMenuOptions {
  appName: string
  version: string
  platform: NodeJS.Platform
  updatesEnabled: boolean
  state: DesktopUpdateState
  copy: UpdateMenuCopy
  onDownload: () => void
  onCheck: () => void
  onInstall: () => void
}

function statusLabel(state: DesktopUpdateState, copy: UpdateMenuCopy): string | undefined {
  switch (state.kind) {
    case 'idle': return undefined
    case 'checking': return copy.checkingForUpdates
    case 'available': return copy.updateAvailableStatus(state.version)
    case 'downloading': return copy.downloadProgress(state.version, state.percent)
    case 'ready': return copy.updateReadyStatus(state.version)
    case 'up-to-date': return copy.upToDateStatus
    case 'error': return copy.updateErrorStatus
    /* v8 ignore next -- DesktopUpdateState is closed and every variant is handled above. */
    default: return state satisfies never
  }
}

function updateItems(options: BuildApplicationMenuOptions): MenuItemConstructorOptions[] {
  const { copy, state } = options
  const label = statusLabel(state, copy)
  const busy = state.kind === 'checking'
    || state.kind === 'downloading'
    || (state.kind === 'available' && state.prompting)
    || (state.kind === 'ready' && state.prompting)
  return [
    { id: 'desktop-current-version', label: copy.currentVersion(options.version), enabled: false },
    {
      id: 'desktop-update-status',
      label: label ?? '',
      enabled: false,
      visible: label !== undefined,
    },
    {
      id: 'desktop-check-update',
      label: copy.checkForUpdates,
      enabled: options.updatesEnabled && !busy && state.kind !== 'ready',
      click: options.onCheck,
    },
    {
      id: 'desktop-download-update',
      label: state.kind === 'available' ? copy.downloadUpdate(state.version) : '',
      enabled: options.updatesEnabled && state.kind === 'available',
      visible: state.kind === 'available',
      click: options.onDownload,
    },
    {
      id: 'desktop-install-update',
      label: state.kind === 'ready' ? copy.installUpdate(state.version) : '',
      enabled: state.kind === 'ready' && !state.prompting,
      visible: state.kind === 'ready',
      click: options.onInstall,
    },
  ]
}

/** Build the cross-platform native application menu with update controls. */
export function buildApplicationMenu(options: BuildApplicationMenuOptions): MenuItemConstructorOptions[] {
  const updates = updateItems(options)
  const standardMenus: MenuItemConstructorOptions[] = [
    { label: options.copy.editMenu, role: 'editMenu' },
    { label: options.copy.viewMenu, role: 'viewMenu' },
    { label: options.copy.windowMenu, role: 'windowMenu' },
  ]
  if (options.platform === 'darwin') {
    return [
      {
        label: options.appName,
        submenu: [
          { label: options.copy.aboutMenu, role: 'about' },
          { type: 'separator' },
          ...updates,
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      ...standardMenus,
    ]
  }
  return [
    ...standardMenus,
    {
      label: options.copy.helpMenu,
      submenu: [
        { label: options.copy.aboutMenu, role: 'about' },
        { type: 'separator' },
        ...updates,
      ],
    },
  ]
}
