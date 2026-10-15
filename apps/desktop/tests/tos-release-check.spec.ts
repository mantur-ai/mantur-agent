/** Exercise the shipped public TOS feed with the installed generic update provider. */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import type { AppUpdater } from 'electron-updater'
import type { GenericProvider as Provider } from 'electron-updater/out/providers/GenericProvider'
import type { ProviderRuntimeOptions } from 'electron-updater/out/providers/Provider'
import { describe, expect, it, vi } from 'vitest'

const requireDesktop = createRequire(import.meta.url)
const { GenericProvider } = requireDesktop('electron-updater/out/providers/GenericProvider') as { GenericProvider: typeof Provider }
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  build: { publish: Array<{ provider: 'generic'; url: string; useMultipleRangeRequest: boolean }> }
}

describe('TOS update distribution', () => {
  it('uses the public HTTPS channel and immutable versioned ZIP without GitHub requests', async () => {
    const config = manifest.build.publish[0]!
    expect(config).toEqual({ provider: 'generic', url: 'https://resource.mantur.ai/mantur-agent/stable/', useMultipleRangeRequest: false })
    const request = vi.fn(async () => 'version: 0.1.19\nfiles:\n  - url: https://resource.mantur.ai/mantur-agent/releases/0.1.19/Mantur-Agent-macOS-arm64.zip\n    sha512: digest\n    size: 42\n')
    const provider = new GenericProvider(config, { channel: null } as unknown as AppUpdater, {
      platform: 'darwin', isUseMultipleRangeRequest: false,
      executor: { request } as unknown as ProviderRuntimeOptions['executor'],
    })
    const info = await provider.getLatestVersion()
    expect(provider.resolveFiles(info)[0]?.url.href).toBe('https://resource.mantur.ai/mantur-agent/releases/0.1.19/Mantur-Agent-macOS-arm64.zip')
    expect(request).toHaveBeenCalledOnce()
  })
})
