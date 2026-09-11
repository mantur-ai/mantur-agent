/** Exercise the installed GitHub provider against older, equal, and incomplete newer releases. */
import { createRequire } from 'node:module'
import type { AppUpdater } from 'electron-updater'
import type { GitHubProvider as Provider } from 'electron-updater/out/providers/GitHubProvider'
import type { ProviderRuntimeOptions } from 'electron-updater/out/providers/Provider'
import { describe, expect, it, vi } from 'vitest'
import { describeUpdateError, desktopCopy } from '../src/locales.ts'

const requireDesktop = createRequire(import.meta.url)
const { GitHubProvider } = requireDesktop('electron-updater/out/providers/GitHubProvider') as { GitHubProvider: typeof Provider }

function release(tag: string, metadata: string | Error, allowDowngrade = false, allowPrerelease = false) {
  const request = vi.fn(async (options: { path: string }) => {
    if (options.path.endsWith('.atom')) return `<feed><entry><title>${tag}</title><link href="https://github.com/mantur-ai/mantur-agent/releases/tag/${tag}"/><content>Release</content></entry></feed>`
    if (options.path.endsWith('/latest')) return JSON.stringify({ tag_name: tag })
    if (metadata instanceof Error) throw metadata
    return metadata
  })
  // The provider consumes these updater fields without launching Electron or owning an installer.
  const updater = { currentVersion: '0.1.7', allowDowngrade, allowPrerelease, fullChangelog: false } as unknown as AppUpdater
  const provider = new GitHubProvider({ provider: 'github', owner: 'mantur-ai', repo: 'mantur-agent' }, updater, {
    platform: 'darwin', isUseMultipleRangeRequest: false,
    executor: { request } as unknown as ProviderRuntimeOptions['executor'],
  })
  return { provider, request }
}

describe('GitHub release version checks', () => {
  it.each(['v0.1.3', 'v0.1.7'])('does not request missing update metadata for %s', async (tag) => {
    const { provider, request } = release(tag, new Error('metadata must not be fetched'))
    await expect(provider.getLatestVersion()).rejects.toMatchObject({ code: 'ERR_UPDATER_NO_NEWER_RELEASE' })
    expect(request.mock.calls.map(([options]) => options.path)).toEqual([
      '/mantur-ai/mantur-agent/releases.atom', '/mantur-ai/mantur-agent/releases/latest',
    ])
  })

  it('reads real metadata for a higher release and resolves the signed update ZIP', async () => {
    const { provider } = release('v0.1.8', 'version: 0.1.8\nfiles:\n  - url: Mantur-Agent-macOS-arm64.zip\n    sha512: digest\n    size: 42\n')
    const info = await provider.getLatestVersion()
    expect(info.version).toBe('0.1.8')
    expect(provider.resolveFiles(info)[0]?.url.href).toBe('https://github.com/mantur-ai/mantur-agent/releases/download/v0.1.8/Mantur-Agent-macOS-arm64.zip')
  })

  it('preserves missing-metadata failures for a genuinely higher version', async () => {
    const missing = Object.assign(new Error('missing metadata'), { code: 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND' })
    const { provider } = release('v0.1.8', missing)
    await expect(provider.getLatestVersion()).rejects.toBe(missing)
  })

  it('keeps explicit downgrade and prerelease selection behavior', async () => {
    const metadata = 'version: 0.1.3\nfiles: []\n'
    await expect(release('v0.1.3', metadata, true).provider.getLatestVersion()).resolves.toMatchObject({ version: '0.1.3' })
    await expect(release('v0.1.6-beta.1', new Error('must not fetch'), false, true).provider.getLatestVersion()).rejects.toMatchObject({ code: 'ERR_UPDATER_NO_NEWER_RELEASE' })
  })
})

describe('user-facing update failures', () => {
  it.each(['zh-CN', 'en-US'])('keeps raw diagnostics out of %s feedback', (locale) => {
    const raw = 'HTTP 404 Headers: secret-header at /private/example/app.js'
    const error = Object.assign(new Error(raw), { code: 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND' })
    expect(describeUpdateError(error, locale)).toBe(desktopCopy(locale).updateFeedUnavailable)
    expect(describeUpdateError(new Error(raw), locale)).toBe(desktopCopy(locale).updateTransferFailed)
    expect(describeUpdateError(raw, locale)).not.toContain(raw)
    error.code = 'ERR_UPDATER_CHECKSUM_MISMATCH'
    expect(describeUpdateError(error, locale)).toBe(desktopCopy(locale).updateVerificationFailed)
  })
})
