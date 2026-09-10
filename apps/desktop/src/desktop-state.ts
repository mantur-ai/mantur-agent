/** Application-owned paths and explicit recovery for disposable desktop state. */

import { mkdir, rm } from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import type { App } from 'electron'

/** Stable directory name below Electron's per-user application-data root. */
export const DESKTOP_USER_DATA_NAME = 'mantur-agent'

/** Development directory name kept separate from installed application data. */
export const DESKTOP_DEVELOPMENT_USER_DATA_NAME = 'mantur-agent-dev'

/** Desktop execution mode that selects the owned user-data directory. */
export type DesktopMode = 'development' | 'release'

/** Files and directories owned by one installed desktop application. */
export interface DesktopPaths {
  /** Stable Electron user-data directory across application upgrades. */
  userData: string
  /** Harness home isolated from ambient CLI and development installations. */
  dshHome: string
  /** Neutral child-process working directory. */
  launchRoot: string
  /** Persistent desktop and Harness diagnostic log. */
  logPath: string
}

/**
 * Resolve an explicit desktop directory or the unchanged mode-specific default.
 * @param appData - Operating-system application-data root.
 * @param mode - Default directory selection when no override is supplied.
 * @param configured - Explicit --user-data-dir value; empty, relative, NUL-containing, and filesystem-root paths are rejected.
 * @returns The selected absolute override or mode-specific default path.
 */
export function desktopUserDataPath(appData: string, mode: DesktopMode = 'release', configured?: string): string {
  if (configured !== undefined) {
    if (!isAbsolute(configured) || configured.includes('\0')) {
      throw new Error('--user-data-dir requires an absolute non-root directory')
    }
    const directory = resolve(configured)
    if (dirname(directory) === directory) throw new Error('--user-data-dir requires an absolute non-root directory')
    return directory
  }
  const name = mode === 'development' ? DESKTOP_DEVELOPMENT_USER_DATA_NAME : DESKTOP_USER_DATA_NAME
  return join(appData, name)
}

/**
 * Select desktop and browser-session storage before account, draft, or Harness startup.
 * @param application - Electron path configuration before readiness.
 * @param configured - Explicit --user-data-dir value, if present.
 * @returns Paths derived from the selected Electron userData directory.
 */
export function initializeDesktopPaths(application: Pick<App, 'getPath' | 'setPath' | 'isPackaged'>, configured?: string): DesktopPaths {
  const userData = desktopUserDataPath(application.getPath('appData'), application.isPackaged ? 'release' : 'development', configured)
  if (configured !== undefined) mkdirSync(userData, { recursive: true, mode: 0o700 })
  application.setPath('userData', userData)
  if (configured !== undefined) application.setPath('sessionData', userData)
  return desktopPaths(application.getPath('userData'))
}

/** Resolve every desktop-owned path from Electron's configured user-data directory. */
export function desktopPaths(userData: string): DesktopPaths {
  return {
    userData,
    dshHome: join(userData, 'harness'),
    launchRoot: join(userData, 'launch-root'),
    logPath: join(userData, 'logs', 'harness.log'),
  }
}

/** Materialize the directories required before the Harness process starts. */
export async function prepareDesktopPaths(paths: DesktopPaths): Promise<void> {
  await Promise.all([
    mkdir(paths.dshHome, { recursive: true }),
    mkdir(paths.launchRoot, { recursive: true }),
    mkdir(dirname(paths.logPath), { recursive: true }),
  ])
}

/** Whether one startup failure names the disposable session-projection cache. */
export function canResetProjectionCache(error: unknown): boolean {
  const detail = error instanceof Error ? error.message : String(error)
  return detail.includes("domain 'session_projcache'")
    && detail.includes('does not match its schema')
}

/**
 * Remove only the application-owned projection cache after explicit user approval.
 * Session logs, settings, credentials, profiles, and workspaces stay untouched.
 */
export async function resetProjectionCache(dshHome: string): Promise<void> {
  const root = resolve(dshHome)
  if (basename(root) !== 'harness') {
    throw new Error(`refusing to reset projection cache outside a desktop Harness home: ${root}`)
  }
  const storageRoot = join(root, 'storages')
  await Promise.all([
    rm(join(storageRoot, 'session_projcache'), { recursive: true, force: true }),
    rm(join(storageRoot, 'session_projcache.json'), { force: true }),
  ])
}
