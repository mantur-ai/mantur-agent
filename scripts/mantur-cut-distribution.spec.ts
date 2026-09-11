import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  fileSha256,
  hostTarget,
  parseProgramManifest,
  parseSourceConfig,
  sourceBuildEnvironment,
  verifyProgramManifest,
} from './mantur-cut-distribution.ts'

const digest = 'a'.repeat(64)
const tree = 'b'.repeat(40)
const temporaryDirectories: string[] = []

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

function sourceConfig(): unknown {
  const target = (platform: 'darwin' | 'win32', arch: 'arm64' | 'x64') => ({
    platform, arch, chromePlatform: 'fixed', chromeVersion: '1', chromeSha256: digest, ffmpegSha256: digest,
    browserExecutable: 'browser', ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', compositor: 'compositor',
    compositorPackage: '@remotion/compositor-fixed', compositorIntegrity: 'sha512-fixed',
    ffprobePackage: '@ffprobe-installer/fixed', ffprobeIntegrity: 'sha512-fixed', ffprobeLicense: 'GPL-3.0',
    whisperArchive: platform === 'win32' ? 'whisper.zip' : null,
    whisperArchiveSha256: platform === 'win32' ? digest : null,
  })
  return {
    formatVersion: 2, repository: 'https://example.invalid/source.git', version: '1.0.0',
    upstreamCommit: tree, upstreamTree: tree, electronVersion: '43.4.0', embeddedNodeVersion: '24.18.1',
    cmakeVersion: '4.3.3', cmakeMacArchiveSha256: digest,
    whisperRepository: 'https://example.invalid/whisper.git', whisperVersion: 'v1', whisperCommit: tree, whisperTree: tree,
    remotionVersion: '4.0.509', remotionRendererIntegrity: 'sha512-fixed',
    ffmpegStaticVersion: '5.3.0', ffmpegStaticIntegrity: 'sha512-fixed',
    patches: [
      { file: 'base.patch', sha256: digest, resultTree: tree },
      { file: 'runtime.patch', sha256: digest, resultTree: tree },
      { file: 'shutdown.patch', sha256: digest, resultTree: tree },
    ],
    targets: {
      'darwin-arm64': target('darwin', 'arm64'),
      'darwin-x64': target('darwin', 'x64'),
      'win32-x64': target('win32', 'x64'),
    },
  }
}

describe('Mantur Cut distribution', () => {
  it('preserves Windows Path when preparing child build commands', () => {
    const result = sourceBuildEnvironment('cache', { Path: 'node-bin', API_KEY: 'hidden' }, ['tools'])
    expect(result.PATH).toBe(['tools', 'node-bin'].join(delimiter))
    expect(result.Path).toBeUndefined()
    expect(result.API_KEY).toBeUndefined()
  })

  it('keeps the Chrome cache version out of the upstream archive filename', async () => {
    const source = await readFile(new URL('./mantur-cut-distribution.ts', import.meta.url), 'utf8')
    expect(source).toContain('const chromeArchive = `chrome-headless-shell-${target.chromePlatform}-${target.chromeVersion}.zip`')
    expect(source).toContain('await download(`https://storage.googleapis.com/chrome-for-testing-public/${target.chromeVersion}/${target.chromePlatform}/chrome-headless-shell-${target.chromePlatform}.zip`, cachedChrome, target.chromeSha256)')
  })

  it('requires all three pinned patches and rejects the old two-layer configuration', () => {
    expect(parseSourceConfig(sourceConfig()).targets['win32-x64'].platform).toBe('win32')
    expect(hostTarget('darwin', 'arm64')).toBe('darwin-arm64')
    expect(() => hostTarget('linux', 'x64')).toThrow('does not support build host linux-x64')
    expect(() => parseSourceConfig({ ...sourceConfig() as object, patches: [] })).toThrow('base, runtime and shutdown patches')
    const config = parseSourceConfig(sourceConfig())
    expect(config.patches[2].file).toBe('shutdown.patch')
    expect(() => parseSourceConfig({ ...config, patches: config.patches.slice(0, 2) })).toThrow('base, runtime and shutdown patches')
    expect(() => parseSourceConfig({ ...config, formatVersion: 1 })).toThrow('formatVersion must be 2')
  })

  it('hashes exact file bytes', async () => {
    const directory = await temporaryDirectory('mantur-cut-hash-')
    const path = join(directory, 'input')
    await writeFile(path, 'mantur-cut')
    expect(await fileSha256(path)).toBe('15089876af45b37089bbdef895cc3dbb56abc3f25e16266f6c8da956865cad21')
  })

  it('requires every declared program resource inside its root', async () => {
    const root = await temporaryDirectory('mantur-cut-manifest-')
    for (const directory of ['dist', 'remotion', 'compositor', 'server']) await mkdir(join(root, directory))
    for (const file of ['server/entry.mjs', 'browser', 'ffmpeg', 'ffprobe', 'whisper-cli', 'whisper-server']) await writeFile(join(root, file), '')
    const manifest = {
      formatVersion: 2 as const, platform: 'darwin' as const, arch: 'arm64' as const,
      source: { upstreamCommit: tree, patchedTree: tree, basePatchSha256: digest, runtimePatchSha256: digest, shutdownPatchSha256: digest },
      paths: { server: 'server/entry.mjs', web: 'dist', remotionBundle: 'remotion', browserExecutable: 'browser', ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', compositor: 'compositor', whisperCli: 'whisper-cli', whisperServer: 'whisper-server' },
    }
    await expect(verifyProgramManifest(root, manifest)).resolves.toBeUndefined()
    expect(parseProgramManifest(manifest)).toEqual(manifest)
    expect(() => parseProgramManifest({ ...manifest, formatVersion: 1 })).toThrow('formatVersion must be 2')
    const { shutdownPatchSha256: _removed, ...twoLayerSource } = manifest.source
    expect(() => parseProgramManifest({ ...manifest, source: twoLayerSource })).toThrow('shutdownPatchSha256')
    expect(() => parseProgramManifest({ ...manifest, source: { ...manifest.source, shutdownPatchSha256: 'invalid' } })).toThrow('lowercase SHA-256 digest')
    await expect(verifyProgramManifest(root, { ...manifest, paths: { ...manifest.paths, ffmpeg: '../ffmpeg' } })).rejects.toThrow('must stay relative')
  })

  it.skipIf(process.platform === 'win32')('rejects a manifest resource symlink that escapes its root', async () => {
    const root = await temporaryDirectory('mantur-cut-manifest-link-')
    for (const directory of ['dist', 'remotion', 'compositor', 'server']) await mkdir(join(root, directory))
    for (const file of ['server/entry.mjs', 'browser', 'ffmpeg', 'ffprobe', 'whisper-cli', 'whisper-server']) await writeFile(join(root, file), '')
    const outside = await temporaryDirectory('mantur-cut-outside-')
    await writeFile(join(outside, 'binary'), '')
    await symlink(join(outside, 'binary'), join(root, 'linked'))
    const manifest = {
      formatVersion: 2 as const, platform: 'darwin' as const, arch: 'arm64' as const,
      source: { upstreamCommit: tree, patchedTree: tree, basePatchSha256: digest, runtimePatchSha256: digest, shutdownPatchSha256: digest },
      paths: { server: 'server/entry.mjs', web: 'dist', remotionBundle: 'remotion', browserExecutable: 'browser', ffmpeg: 'linked', ffprobe: 'ffprobe', compositor: 'compositor', whisperCli: 'whisper-cli', whisperServer: 'whisper-server' },
    }
    await expect(verifyProgramManifest(root, manifest)).rejects.toThrow('outside its root')
  })

  it('removes credentials and runtime overrides from third-party build commands', () => {
    const environment = sourceBuildEnvironment('/tmp/mantur-cache', {
      PATH: '/bin', API_KEY: 'secret', GITHUB_TOKEN: 'secret', CSC_LINK: 'certificate',
      APPLE_ID: 'person@example.com', APPLE_TEAM_ID: 'team', OPENCHATCUT_WHISPER_CLI: '/tmp/unpinned',
    }, ['/tmp/mantur-cmake'])
    expect(environment).toMatchObject({
      ELECTRON_SKIP_BINARY_DOWNLOAD: '1',
      npm_config_cache: join('/tmp/mantur-cache', 'npm'),
      npm_config_registry: 'https://registry.npmjs.org/',
    })
    expect(environment.PATH).toBe(['/tmp/mantur-cmake', '/bin'].join(delimiter))
    for (const name of ['API_KEY', 'GITHUB_TOKEN', 'CSC_LINK', 'APPLE_ID', 'APPLE_TEAM_ID', 'OPENCHATCUT_WHISPER_CLI']) {
      expect(environment[name]).toBeUndefined()
    }
  })
})
