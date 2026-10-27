/** Real builder configuration, generic-provider routing, and version selection without network or native packaging. */
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { load, dump } from 'js-yaml'
import type { AppUpdater } from 'electron-updater'
import type { GenericProvider as Provider } from 'electron-updater/out/providers/GenericProvider'
import type { ProviderRuntimeOptions } from 'electron-updater/out/providers/Provider'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startAutoUpdates, type DesktopUpdater } from '../src/updater.ts'
import { verifyDesktopUpdateRoute } from '../scripts/update-route-smoke.ts'

const requireDesktop = createRequire(import.meta.url)
const requireBuilder = createRequire(requireDesktop.resolve('electron-builder'))
const requireUpdater = createRequire(requireDesktop.resolve('electron-updater'))
const { HttpError } = requireUpdater('builder-util-runtime') as { HttpError: new (statusCode: number) => Error }
const { GenericProvider } = requireDesktop('electron-updater/out/providers/GenericProvider') as { GenericProvider: typeof Provider }
interface VersionSelectionContext {
  currentVersion: string
  allowDowngrade: boolean
  isUpdateSupported: () => boolean
  isUserWithinRollout: () => boolean
}
const { AppUpdater: Updater } = requireDesktop('electron-updater/out/AppUpdater') as {
  AppUpdater: { prototype: { isUpdateAvailable: (this: VersionSelectionContext, info: { version: string }) => Promise<boolean> } }
}
type Config = ConstructorParameters<typeof Provider>[0]
interface BuilderPlatform { name: string; nodeName: string; buildConfigurationKey: string }
interface BuilderPackager { appInfo: { version: string; channel: string | null }; platform: BuilderPlatform }
interface MetadataTask { file: string; info: { version: string }; publishConfiguration: Config }
const { Platform } = requireBuilder('app-builder-lib') as { Platform: { MAC: BuilderPlatform; WINDOWS: BuilderPlatform } }
const { PlatformPackager } = requireBuilder('app-builder-lib/out/platformPackager') as {
  PlatformPackager: new (info: object, platform: BuilderPlatform) => BuilderPackager
}
const { getAppUpdatePublishConfiguration } = requireBuilder('app-builder-lib/out/publish/PublishManager') as {
  getAppUpdatePublishConfiguration: (packager: BuilderPackager, target: null, arch: number, required: boolean) => Promise<Config>
}
const { createUpdateInfoTasks, writeUpdateInfoFiles } = requireBuilder('app-builder-lib/out/publish/updateInfoBuilder') as {
  createUpdateInfoTasks: (event: object, configs: Config[]) => Promise<MetadataTask[]>
  writeUpdateInfoFiles: (tasks: MetadataTask[], packager: object) => Promise<void>
}
const { Arch } = requireBuilder('builder-util') as { Arch: { arm64: number; x64: number } }
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string
  build: { publish: Config[] }
}
const roots: string[] = []
afterEach(async () => { vi.useRealTimers(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

async function builderConfiguration(version: string, platform: 'darwin' | 'win32', arch: 'arm64' | 'x64') {
  const root = await mkdtemp(join(tmpdir(), 'desktop-update-route-'))
  roots.push(root)
  const info = {
    metadata: { ...manifest, version }, config: manifest.build,
    projectDir: root, buildResourcesDir: join(root, 'resources'),
    emitArtifactCreated: vi.fn(async () => {}),
  }
  const packager = new PlatformPackager(info, platform === 'darwin' ? Platform.MAC : Platform.WINDOWS)
  Object.assign(info, { appInfo: packager.appInfo })
  const config = await getAppUpdatePublishConfiguration(packager, null, Arch[arch], true)
  const file = join(root, `candidate-${arch}.${platform === 'darwin' ? 'zip' : 'exe'}`)
  const bytes = Buffer.from(`metadata fixture ${version} ${platform} ${arch}`)
  await writeFile(file, bytes)
  const tasks = await createUpdateInfoTasks({ file, packager, arch: Arch[arch], target: { outDir: root } }, [config])
  await writeUpdateInfoFiles(tasks, info)
  const channel = version.includes('-rc.') ? 'rc' : 'latest'
  const name = `${channel}${platform === 'darwin' ? '-mac' : ''}.yml`
  expect(tasks.map(task => basename(task.file))).toEqual([name])
  expect((await readdir(root)).filter(name => name.endsWith('.yml'))).toEqual([name])
  expect(load(await readFile(join(root, name), 'utf8'))).toMatchObject({
    version, files: [{ url: basename(file), sha512: createHash('sha512').update(bytes).digest('base64') }],
  })
  expect(config.channel).toBe(channel === 'rc' ? 'rc' : undefined)
  return config
}

describe('TOS update distribution', () => {
  it.each([
    [manifest.version, 'darwin', 'arm64'],
    ['0.1.22', 'darwin', 'arm64'], ['0.1.22', 'darwin', 'x64'], ['0.1.22', 'win32', 'x64'],
    ['0.1.22-rc.2', 'darwin', 'arm64'], ['0.1.22-rc.2', 'darwin', 'x64'], ['0.1.22-rc.2', 'win32', 'x64'],
  ] as const)('uses builder %s / %s / %s config with the stable runtime route (offline platform model)', async (version, platform, arch) => {
    const config = await builderConfiguration(version, platform, arch)
    expect(await verifyDesktopUpdateRoute({
      requireFromApp: requireDesktop, configText: dump(config), currentVersion: version, platform, startUpdates: startAutoUpdates,
    }))
      .toBe(`https://mantur-pro.tos-accelerate.volces.com/mantur-agent/stable/latest${platform === 'darwin' ? '-mac' : ''}.yml`)
  })

  it.each([false, true])('retains real generic-provider 404 and network failures (manual=%s)', async (manual) => {
    const config = await builderConfiguration('0.1.22-rc.2', 'darwin', 'arm64')
    vi.useFakeTimers()
    for (const failure of [new HttpError(404), Object.assign(new Error('network unreachable'), { code: 'ENETUNREACH' })]) {
      const request = vi.fn(async () => { throw failure })
      const updater: DesktopUpdater = Object.assign(new EventEmitter(), {
        channel: null, allowDowngrade: false, allowPrerelease: true, autoDownload: true, autoInstallOnAppQuit: true,
        checkForUpdates: () => provider.getLatestVersion(),
        downloadUpdate: vi.fn(async () => []), quitAndInstall: vi.fn(),
      })
      Object.defineProperty(updater, 'channel', Object.getOwnPropertyDescriptor(Updater.prototype, 'channel')!)
      const provider = new GenericProvider(config, updater as AppUpdater, {
        platform: 'darwin', isUseMultipleRangeRequest: false,
        executor: { request } as unknown as ProviderRuntimeOptions['executor'],
      })
      const describeError = vi.fn((error: unknown) => error instanceof Error ? error.message : String(error))
      const controller = startAutoUpdates({ updater, currentVersion: '0.1.22-rc.2', checkDelayMs: 10,
        prompts: { confirmInstall: async () => false }, beforeInstall: async () => {},
        onStateChange: () => {}, log: () => {}, describeError,
      })
      try {
        if (manual) controller.checkNow()
        await vi.advanceTimersByTimeAsync(manual ? 0 : 10)
        expect(controller.getState()).toMatchObject({ kind: 'error', requestedByUser: manual })
        expect(describeError).toHaveBeenCalledWith(expect.objectContaining({
          code: failure instanceof HttpError ? 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND' : 'ENETUNREACH',
        }))
        expect(request).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
          protocol: 'https:', hostname: 'mantur-pro.tos-accelerate.volces.com', path: '/mantur-agent/stable/latest-mac.yml',
        }), undefined)
        expect(updater.downloadUpdate).not.toHaveBeenCalled()
        expect(updater.quitAndInstall).not.toHaveBeenCalled()
      } finally { controller.dispose() }
    }
  })

  it('resolves the immutable ZIP from stable metadata', async () => {
    const config = await builderConfiguration('0.1.22-rc.2', 'darwin', 'arm64')
    const url = 'https://mantur-pro.tos-accelerate.volces.com/mantur-agent/releases/0.1.22/Mantur-Agent-macOS-arm64.zip'
    const request = vi.fn(async () => dump({ version: '0.1.22', files: [{ url, sha512: 'digest', size: 42 }] }))
    const provider = new GenericProvider(config, { channel: 'latest' } as AppUpdater, {
      platform: 'darwin', isUseMultipleRangeRequest: false,
      executor: { request } as unknown as ProviderRuntimeOptions['executor'],
    })
    expect(provider.resolveFiles(await provider.getLatestVersion())[0]?.url.href).toBe(url)
    expect(request).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      protocol: 'https:', hostname: 'mantur-pro.tos-accelerate.volces.com', path: '/mantur-agent/stable/latest-mac.yml',
    }), undefined)
  })

  it.each([false, true])('uses real version selection; generic metadata is not filtered by allowPrerelease=%s', async (allowPrerelease) => {
    const context = {
      currentVersion: '0.1.22-rc.2', allowPrerelease, allowDowngrade: false,
      isUpdateSupported: () => true, isUserWithinRollout: () => true,
    }
    for (const [version, expected] of [['0.1.21', false], ['0.1.22-rc.1', false], ['0.1.22-rc.2', false], ['0.1.22-rc.3', true], ['0.1.22', true], ['0.1.23', true]] as const) {
      expect(await Updater.prototype.isUpdateAvailable.call(context, { version }), version).toBe(expected)
    }
  })

  it.each([
    ['0.1.21', '1.0.0', true],
    ['0.1.22-rc.3', '1.0.0', true],
    ['1.0.0', '1.0.0', false],
    ['1.0.0', '0.1.22', false],
    ['1.0.0', '0.1.21', false],
  ] as const)('selects %s to %s with downgrades disabled', async (currentVersion, version, expected) => {
    const context = {
      currentVersion, allowPrerelease: false, allowDowngrade: false,
      isUpdateSupported: () => true, isUserWithinRollout: () => true,
    }
    expect(await Updater.prototype.isUpdateAvailable.call(context, { version })).toBe(expected)
  })

  it('proves the real channel setter enables a forbidden downgrade unless reset afterward', async () => {
    const context = {
      currentVersion: '0.1.22-rc.2', allowDowngrade: false, _channel: null,
      isUpdateSupported: () => true, isUserWithinRollout: () => true,
    }
    Object.getOwnPropertyDescriptor(Updater.prototype, 'channel')!.set!.call(context, 'latest')
    expect(context.allowDowngrade).toBe(true)
    expect(await Updater.prototype.isUpdateAvailable.call(context, { version: '0.1.21' })).toBe(true)
    context.allowDowngrade = false
    expect(await Updater.prototype.isUpdateAvailable.call(context, { version: '0.1.21' })).toBe(false)
  })

  it.each(['old-initialization', 'prerelease-flag-only', 'downgrade-before-channel'] as const)('smoke rejects %s using the real provider and setter', async (mutation) => {
    const config = await builderConfiguration('0.1.22-rc.2', 'darwin', 'arm64')
    const initialize: typeof startAutoUpdates = (options) => {
      const controller = startAutoUpdates(options)
      // Replay the old initializer or wrong setter order before the first request.
      if (mutation === 'downgrade-before-channel') options.updater.channel = 'latest'
      else {
        Object.defineProperty(options.updater, 'channel', { value: null })
        options.updater.allowPrerelease = mutation === 'old-initialization'
      }
      return controller
    }
    await expect(verifyDesktopUpdateRoute({ requireFromApp: requireDesktop, configText: dump(config), currentVersion: '0.1.22-rc.2', platform: 'darwin', startUpdates: initialize }))
      .rejects.toThrow(mutation === 'downgrade-before-channel' ? 'policy is unsafe' : 'stable/rc-mac.yml; expected https://mantur-pro.tos-accelerate.volces.com/mantur-agent/stable/latest-mac.yml')
  })

  it.each([
    'provider: github\n',
    'provider: generic\nurl: https://mantur-pro.tos-accelerate.volces.com/mantur-agent/rc/\nuseMultipleRangeRequest: false\n',
    'provider: generic\nurl: https://mantur-pro.tos-accelerate.volces.com/mantur-agent/stable/\nuseMultipleRangeRequest: true\n',
  ])('smoke rejects invalid packaged configuration %s', async (configText) => {
    await expect(verifyDesktopUpdateRoute({ requireFromApp: requireDesktop, configText, currentVersion: '0.1.22-rc.2', platform: 'darwin', startUpdates: startAutoUpdates }))
      .rejects.toThrow('stable TOS generic configuration')
  })
})
