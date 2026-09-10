/** Native desktop menu placement and user-visible update-state expectations. */

import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { desktopCopy } from '../src/locales.ts'
import { buildApplicationMenu, type BuildApplicationMenuOptions } from '../src/update-menu.ts'
import type { DesktopUpdateState } from '../src/updater.ts'

const updateItemIds = new Set([
  'desktop-current-version',
  'desktop-update-status',
  'desktop-check-update',
  'desktop-install-update',
  'desktop-download-update',
])

function menuFor(platform: NodeJS.Platform, state: DesktopUpdateState, overrides = {}) {
  return buildApplicationMenu({
    appName: '漫途Agent',
    version: '1.2.3',
    platform,
    updatesEnabled: true,
    state,
    copy: desktopCopy('zh-CN'),
    onCheck: vi.fn(),
    onDownload: vi.fn(),
    onInstall: vi.fn(),
    ...overrides,
  })
}

function submenu(item: MenuItemConstructorOptions): MenuItemConstructorOptions[] {
  return Array.isArray(item.submenu) ? item.submenu : []
}

function updatePresentation(platform: NodeJS.Platform, state: DesktopUpdateState) {
  const menu = menuFor(platform, state)
  const parent = menu.find(item => submenu(item).some(child => child.id === 'desktop-check-update'))
  if (parent === undefined) throw new Error('update menu parent is missing')
  return {
    platform,
    topLevel: menu.map(item => item.label),
    updateParent: parent.label,
    items: submenu(parent)
      .filter(item => item.id !== undefined && updateItemIds.has(item.id))
      .map(item => ({
        id: item.id,
        label: item.label,
        enabled: item.enabled ?? true,
        visible: item.visible ?? true,
      })),
  }
}

function findItem(menu: MenuItemConstructorOptions[], id: string): MenuItemConstructorOptions | undefined {
  for (const item of menu) {
    if (item.id === id) return item
    const nested = findItem(submenu(item), id)
    if (nested !== undefined) return nested
  }
  return undefined
}

describe('desktop update menu', () => {
  it('places update controls in the macOS app menu and Windows help menu', () => {
    expect([
      updatePresentation('darwin', { kind: 'idle' }),
      updatePresentation('win32', { kind: 'idle' }),
      updatePresentation('darwin', { kind: 'checking' }),
      updatePresentation('darwin', { kind: 'available', version: '1.3.0', prompting: false }),
      updatePresentation('darwin', { kind: 'available', version: '1.3.0', prompting: true }),
      updatePresentation('darwin', { kind: 'downloading', version: '1.3.0', percent: 42, transferred: 420, total: 1000 }),
      updatePresentation('darwin', { kind: 'ready', version: '1.3.0', prompting: false }),
      updatePresentation('darwin', { kind: 'ready', version: '1.3.0', prompting: true }),
      updatePresentation('darwin', { kind: 'up-to-date', requestedByUser: true }),
      updatePresentation('darwin', { kind: 'error', detail: 'network', requestedByUser: true }),
    ]).toMatchSnapshot()
  })

  it('connects enabled menu actions to the controller callbacks', () => {
    const onCheck = vi.fn()
    const onInstall = vi.fn()
    const checkingMenu = menuFor('darwin', { kind: 'idle' }, { onCheck, onInstall })
    const readyMenu = menuFor(
      'win32',
      { kind: 'ready', version: '1.3.0', prompting: false },
      { onCheck, onInstall },
    )

    const check = findItem(checkingMenu, 'desktop-check-update')
    const install = findItem(readyMenu, 'desktop-install-update')
    expect(check?.enabled).toBe(true)
    expect(install?.enabled).toBe(true)
    ;(check?.click as BuildApplicationMenuOptions['onCheck'])()
    ;(install?.click as BuildApplicationMenuOptions['onInstall'])()
    expect(onCheck).toHaveBeenCalledOnce()
    expect(onInstall).toHaveBeenCalledOnce()
  })

  it('keeps release checks disabled until a packaged updater is ready', () => {
    const menu = menuFor('darwin', { kind: 'idle' }, { updatesEnabled: false })
    expect(findItem(menu, 'desktop-check-update')?.enabled).toBe(false)
  })
})
