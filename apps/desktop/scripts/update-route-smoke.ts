/** Offline route verification using the packaged controller and updater dependency. */
import { EventEmitter } from 'node:events'
import type { createRequire } from 'node:module'
import type { RequestOptions } from 'node:https'
import { load } from 'js-yaml'
import type { AppUpdater } from 'electron-updater'
import type { GenericProvider as Provider } from 'electron-updater/out/providers/GenericProvider'
import type { ProviderRuntimeOptions } from 'electron-updater/out/providers/Provider'
import type { DesktopUpdater, startAutoUpdates } from '../src/updater.ts'

interface RouteSmokeOptions {
  requireFromApp: ReturnType<typeof createRequire>
  configText: string
  currentVersion: string
  platform: 'darwin' | 'win32'
  startUpdates: typeof startAutoUpdates
}

/**
 * Verify the effective stable URL before any network access or download can occur.
 * @param options Packaged modules, configuration, and controller entry.
 * @returns The full metadata URL requested by the installed generic provider.
 */
export async function verifyDesktopUpdateRoute(options: RouteSmokeOptions): Promise<string> {
  const config: unknown = load(options.configText)
  const stableBase = 'https://mantur-pro.tos-accelerate.volces.com/mantur-agent/stable/'
  if (typeof config !== 'object' || config === null
    || !('provider' in config) || config.provider !== 'generic'
    || !('url' in config) || config.url !== stableBase
    || !('useMultipleRangeRequest' in config) || config.useMultipleRangeRequest !== false
    || ('channel' in config && typeof config.channel !== 'string')) {
    throw new Error('Packaged updater must use the stable TOS generic configuration')
  }
  const { GenericProvider } = options.requireFromApp('electron-updater/out/providers/GenericProvider') as { GenericProvider: typeof Provider }
  const { AppUpdater: Updater } = options.requireFromApp('electron-updater/out/AppUpdater') as { AppUpdater: { prototype: AppUpdater } }
  const channel = Object.getOwnPropertyDescriptor(Updater.prototype, 'channel')
  if (channel === undefined) throw new Error('Packaged updater channel accessor is missing')
  let requestedUrl: string | undefined
  let pendingCheck: Promise<unknown> | undefined
  const updater: DesktopUpdater = Object.assign(new EventEmitter(), {
    channel: null,
    allowDowngrade: false,
    allowPrerelease: true,
    autoDownload: true,
    autoInstallOnAppQuit: true,
    checkForUpdates: (): Promise<unknown> => {
      pendingCheck = provider.getLatestVersion()
      return pendingCheck
    },
    downloadUpdate: async (): Promise<never> => { throw new Error('Route smoke must not download') },
    quitAndInstall: (): never => { throw new Error('Route smoke must not install') },
  })
  Object.defineProperty(updater, 'channel', channel)
  const provider = new GenericProvider(config as ConstructorParameters<typeof Provider>[0], updater as AppUpdater, {
    platform: options.platform,
    isUseMultipleRangeRequest: false,
    executor: {
      request: async (request: RequestOptions): Promise<string> => {
        requestedUrl = `${request.protocol}//${request.hostname}${request.path}`
        const expected = `${stableBase}latest${options.platform === 'darwin' ? '-mac' : ''}.yml`
        if (requestedUrl !== expected) throw new Error(`Packaged updater requested ${requestedUrl}; expected ${expected}`)
        if (updater.channel !== 'latest' || updater.allowDowngrade || updater.allowPrerelease
          || updater.autoDownload || updater.autoInstallOnAppQuit) {
          throw new Error('Packaged updater policy is unsafe before its first request')
        }
        return `version: ${options.currentVersion}\nfiles:\n  - url: fixture.zip\n    sha512: fixture\n    size: 1\n`
      },
    } as ProviderRuntimeOptions['executor'],
  })
  const controller = options.startUpdates({
    updater, currentVersion: options.currentVersion,
    prompts: { confirmInstall: async () => { throw new Error('Route smoke must not prompt') } },
    beforeInstall: async () => { throw new Error('Route smoke must not stop the application') },
    onStateChange: () => {}, log: () => {}, describeError: String,
  })
  try {
    controller.checkNow()
    if (pendingCheck === undefined) throw new Error('Packaged updater did not check its feed')
    await pendingCheck
    if (requestedUrl === undefined) throw new Error('Packaged updater did not request metadata')
    return requestedUrl
  } finally {
    controller.dispose()
  }
}
