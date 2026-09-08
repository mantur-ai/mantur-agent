/** Build the pinned Mantur Cut runtime resource tree for one native desktop target. */

import { createHash } from 'node:crypto'
import { chmod, cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const sourceConfigPath = resolve(root, 'apps/desktop/mantur-cut/source.json')
const defaultCacheDir = resolve(root, '.cache/mantur-cut')
const defaultOutputDir = resolve(root, 'apps/desktop/.generated/mantur-cut')
const patchRoot = resolve(root, 'packages/client/ui-mantur-editing/adapters')
const themeAdapter = resolve(patchRoot, 'openchatcut-theme.mjs')

export type ManturCutTarget = 'darwin-arm64' | 'darwin-x64' | 'win32-x64'

interface PatchSource {
  file: string
  sha256: string
  resultTree: string
}

interface TargetSource {
  platform: 'darwin' | 'win32'
  arch: 'arm64' | 'x64'
  chromePlatform: string
  chromeVersion: string
  chromeSha256: string
  ffmpegSha256: string
  browserExecutable: string
  ffmpeg: string
  ffprobe: string
  compositor: string
  compositorPackage: string
  compositorIntegrity: string
  ffprobePackage: string
  ffprobeIntegrity: string
  ffprobeLicense: string
  whisperArchive: string | null
  whisperArchiveSha256: string | null
}

interface SourceConfig {
  formatVersion: 1
  repository: string
  version: string
  upstreamCommit: string
  upstreamTree: string
  electronVersion: string
  embeddedNodeVersion: string
  cmakeVersion: string
  cmakeMacArchiveSha256: string
  whisperRepository: string
  whisperVersion: string
  whisperCommit: string
  whisperTree: string
  remotionVersion: string
  remotionRendererIntegrity: string
  ffmpegStaticVersion: string
  ffmpegStaticIntegrity: string
  patches: [PatchSource, PatchSource]
  targets: Record<ManturCutTarget, TargetSource>
}

export interface ProgramManifest {
  formatVersion: 1
  platform: TargetSource['platform']
  arch: TargetSource['arch']
  source: {
    upstreamCommit: string
    patchedTree: string
    basePatchSha256: string
    runtimePatchSha256: string
  }
  paths: {
    server: string
    web: string
    remotionBundle: string
    browserExecutable: string
    ffmpeg: string
    ffprobe: string
    compositor: string
    whisperCli: string
    whisperServer: string
  }
}

/** Parse the runtime manifest consumed from a packaged desktop resource directory. */
export function parseProgramManifest(value: unknown): ProgramManifest {
  const manifest = object(value, 'Mantur Cut program manifest')
  exactKeys(manifest, ['arch', 'formatVersion', 'paths', 'platform', 'source'], 'Mantur Cut program manifest')
  if (manifest.formatVersion !== 1) throw new Error('Mantur Cut program manifest formatVersion must be 1')
  const platform = string(manifest.platform, 'Mantur Cut program manifest platform')
  const arch = string(manifest.arch, 'Mantur Cut program manifest arch')
  if (platform !== 'darwin' && platform !== 'win32') throw new Error('Mantur Cut program manifest platform is unsupported')
  if (arch !== 'arm64' && arch !== 'x64') throw new Error('Mantur Cut program manifest arch is unsupported')
  const source = object(manifest.source, 'Mantur Cut program manifest source')
  exactKeys(source, ['basePatchSha256', 'patchedTree', 'runtimePatchSha256', 'upstreamCommit'], 'Mantur Cut program manifest source')
  const paths = object(manifest.paths, 'Mantur Cut program manifest paths')
  exactKeys(paths, ['browserExecutable', 'compositor', 'ffmpeg', 'ffprobe', 'remotionBundle', 'server', 'web', 'whisperCli', 'whisperServer'], 'Mantur Cut program manifest paths')
  return {
    formatVersion: 1, platform, arch,
    source: {
      upstreamCommit: gitObject(source.upstreamCommit, 'Mantur Cut program manifest upstreamCommit'),
      patchedTree: gitObject(source.patchedTree, 'Mantur Cut program manifest patchedTree'),
      basePatchSha256: digest(source.basePatchSha256, 'Mantur Cut program manifest basePatchSha256'),
      runtimePatchSha256: digest(source.runtimePatchSha256, 'Mantur Cut program manifest runtimePatchSha256'),
    },
    paths: {
      server: string(paths.server, 'Mantur Cut program manifest server'),
      web: string(paths.web, 'Mantur Cut program manifest web'),
      remotionBundle: string(paths.remotionBundle, 'Mantur Cut program manifest remotionBundle'),
      browserExecutable: string(paths.browserExecutable, 'Mantur Cut program manifest browserExecutable'),
      ffmpeg: string(paths.ffmpeg, 'Mantur Cut program manifest ffmpeg'),
      ffprobe: string(paths.ffprobe, 'Mantur Cut program manifest ffprobe'),
      compositor: string(paths.compositor, 'Mantur Cut program manifest compositor'),
      whisperCli: string(paths.whisperCli, 'Mantur Cut program manifest whisperCli'),
      whisperServer: string(paths.whisperServer, 'Mantur Cut program manifest whisperServer'),
    },
  }
}

function object(value: unknown, subject: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${subject} must be an object`)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], subject: string): void {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (actual.join('\0') !== wanted.join('\0')) throw new Error(`${subject} must contain only ${wanted.join(', ')}`)
}

function string(value: unknown, subject: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${subject} must be a non-empty string`)
  return value
}

function optionalString(value: unknown, subject: string): string | null {
  return value === null ? null : string(value, subject)
}

function optionalDigest(value: unknown, subject: string): string | null {
  return value === null ? null : digest(value, subject)
}

function digest(value: unknown, subject: string): string {
  const result = string(value, subject)
  if (!/^[a-f0-9]{64}$/.test(result)) throw new Error(`${subject} must be a lowercase SHA-256 digest`)
  return result
}

function gitObject(value: unknown, subject: string): string {
  const result = string(value, subject)
  if (!/^[a-f0-9]{40}$/.test(result)) throw new Error(`${subject} must be a lowercase Git object id`)
  return result
}

function patchSource(value: unknown, subject: string): PatchSource {
  const row = object(value, subject)
  exactKeys(row, ['file', 'resultTree', 'sha256'], subject)
  return { file: string(row.file, `${subject}.file`), sha256: digest(row.sha256, `${subject}.sha256`), resultTree: gitObject(row.resultTree, `${subject}.resultTree`) }
}

function targetSource(value: unknown, subject: string): TargetSource {
  const row = object(value, subject)
  exactKeys(row, ['arch', 'browserExecutable', 'chromePlatform', 'chromeSha256', 'chromeVersion', 'compositor', 'compositorIntegrity', 'compositorPackage', 'ffmpeg', 'ffmpegSha256', 'ffprobe', 'ffprobeIntegrity', 'ffprobeLicense', 'ffprobePackage', 'platform', 'whisperArchive', 'whisperArchiveSha256'], subject)
  const platform = string(row.platform, `${subject}.platform`)
  const arch = string(row.arch, `${subject}.arch`)
  if (platform !== 'darwin' && platform !== 'win32') throw new Error(`${subject}.platform is unsupported`)
  if (arch !== 'arm64' && arch !== 'x64') throw new Error(`${subject}.arch is unsupported`)
  const whisperArchive = optionalString(row.whisperArchive, `${subject}.whisperArchive`)
  const whisperArchiveSha256 = optionalDigest(row.whisperArchiveSha256, `${subject}.whisperArchiveSha256`)
  if ((whisperArchive === null) !== (whisperArchiveSha256 === null)) throw new Error(`${subject} Whisper archive metadata is incomplete`)
  if (platform === 'darwin' && whisperArchive !== null) throw new Error(`${subject} must build Whisper from source`)
  if (platform === 'win32' && whisperArchive === null) throw new Error(`${subject} must pin a Whisper archive`)
  return {
    platform, arch,
    chromePlatform: string(row.chromePlatform, `${subject}.chromePlatform`),
    chromeVersion: string(row.chromeVersion, `${subject}.chromeVersion`),
    chromeSha256: digest(row.chromeSha256, `${subject}.chromeSha256`),
    ffmpegSha256: digest(row.ffmpegSha256, `${subject}.ffmpegSha256`),
    browserExecutable: string(row.browserExecutable, `${subject}.browserExecutable`),
    ffmpeg: string(row.ffmpeg, `${subject}.ffmpeg`),
    ffprobe: string(row.ffprobe, `${subject}.ffprobe`),
    compositor: string(row.compositor, `${subject}.compositor`),
    compositorPackage: string(row.compositorPackage, `${subject}.compositorPackage`),
    compositorIntegrity: string(row.compositorIntegrity, `${subject}.compositorIntegrity`),
    ffprobePackage: string(row.ffprobePackage, `${subject}.ffprobePackage`),
    ffprobeIntegrity: string(row.ffprobeIntegrity, `${subject}.ffprobeIntegrity`),
    ffprobeLicense: string(row.ffprobeLicense, `${subject}.ffprobeLicense`),
    whisperArchive,
    whisperArchiveSha256,
  }
}

/** Parse the committed source and target pins used by the distribution build. */
export function parseSourceConfig(value: unknown): SourceConfig {
  const config = object(value, 'Mantur Cut source config')
  exactKeys(config, ['cmakeMacArchiveSha256', 'cmakeVersion', 'electronVersion', 'embeddedNodeVersion', 'ffmpegStaticIntegrity', 'ffmpegStaticVersion', 'formatVersion', 'patches', 'remotionRendererIntegrity', 'remotionVersion', 'repository', 'targets', 'upstreamCommit', 'upstreamTree', 'version', 'whisperCommit', 'whisperRepository', 'whisperTree', 'whisperVersion'], 'Mantur Cut source config')
  if (config.formatVersion !== 1) throw new Error('Mantur Cut source config formatVersion must be 1')
  if (!Array.isArray(config.patches) || config.patches.length !== 2) throw new Error('Mantur Cut source config must pin the base and runtime patches')
  const targetRows = object(config.targets, 'Mantur Cut source config targets')
  exactKeys(targetRows, ['darwin-arm64', 'darwin-x64', 'win32-x64'], 'Mantur Cut source config targets')
  return {
    formatVersion: 1,
    repository: string(config.repository, 'Mantur Cut source config repository'),
    version: string(config.version, 'Mantur Cut source config version'),
    upstreamCommit: gitObject(config.upstreamCommit, 'Mantur Cut source config upstreamCommit'),
    upstreamTree: gitObject(config.upstreamTree, 'Mantur Cut source config upstreamTree'),
    electronVersion: string(config.electronVersion, 'Mantur Cut source config electronVersion'),
    embeddedNodeVersion: string(config.embeddedNodeVersion, 'Mantur Cut source config embeddedNodeVersion'),
    cmakeVersion: string(config.cmakeVersion, 'Mantur Cut source config cmakeVersion'),
    cmakeMacArchiveSha256: digest(config.cmakeMacArchiveSha256, 'Mantur Cut source config cmakeMacArchiveSha256'),
    whisperRepository: string(config.whisperRepository, 'Mantur Cut source config whisperRepository'),
    whisperVersion: string(config.whisperVersion, 'Mantur Cut source config whisperVersion'),
    whisperCommit: gitObject(config.whisperCommit, 'Mantur Cut source config whisperCommit'),
    whisperTree: gitObject(config.whisperTree, 'Mantur Cut source config whisperTree'),
    remotionVersion: string(config.remotionVersion, 'Mantur Cut source config remotionVersion'),
    remotionRendererIntegrity: string(config.remotionRendererIntegrity, 'Mantur Cut source config remotionRendererIntegrity'),
    ffmpegStaticVersion: string(config.ffmpegStaticVersion, 'Mantur Cut source config ffmpegStaticVersion'),
    ffmpegStaticIntegrity: string(config.ffmpegStaticIntegrity, 'Mantur Cut source config ffmpegStaticIntegrity'),
    patches: [patchSource(config.patches[0], 'Mantur Cut base patch'), patchSource(config.patches[1], 'Mantur Cut runtime patch')],
    targets: {
      'darwin-arm64': targetSource(targetRows['darwin-arm64'], 'Mantur Cut darwin-arm64 target'),
      'darwin-x64': targetSource(targetRows['darwin-x64'], 'Mantur Cut darwin-x64 target'),
      'win32-x64': targetSource(targetRows['win32-x64'], 'Mantur Cut win32-x64 target'),
    },
  }
}

/** Resolve the only native target allowed on the current runner. */
export function hostTarget(platform = process.platform, arch = process.arch): ManturCutTarget {
  const target = `${platform}-${arch}`
  if (target !== 'darwin-arm64' && target !== 'darwin-x64' && target !== 'win32-x64') {
    throw new Error(`Mantur Cut distribution does not support build host ${target}`)
  }
  return target
}

/** Return the SHA-256 digest of one file. */
export async function fileSha256(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

/** Build an isolated environment for commands executed from the third-party source tree. */
export function sourceBuildEnvironment(
  cacheDir: string,
  ambient: NodeJS.ProcessEnv = process.env,
  toolDirectories: readonly string[] = [],
): NodeJS.ProcessEnv {
  const environment = Object.fromEntries(Object.entries(ambient).filter(([name]) => (
    !(/(KEY|SECRET|TOKEN|PASSWORD)/i.test(name)
      || name === 'APPLE_ID'
      || name === 'APPLE_TEAM_ID'
      || name === 'CSC_LINK'
      || name.startsWith('OPENCHATCUT_'))
  )))
  environment.ELECTRON_SKIP_BINARY_DOWNLOAD = '1'
  environment.npm_config_cache = join(cacheDir, 'npm')
  environment.npm_config_registry = 'https://registry.npmjs.org/'
  environment.PATH = [...toolDirectories, environment.PATH].filter((value): value is string => value !== undefined).join(delimiter)
  return environment
}

async function download(url: string, destination: string, expected: string): Promise<void> {
  try {
    if (await fileSha256(destination) === expected) return
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  await mkdir(dirname(destination), { recursive: true })
  const temporary = `${destination}.${process.pid}.tmp`
  const response = await fetch(url)
  if (!response.ok || response.body === null) throw new Error(`Mantur Cut download failed with HTTP ${response.status}: ${url}`)
  try {
    await writeFile(temporary, new Uint8Array(await response.arrayBuffer()), { flag: 'wx' })
    if (await fileSha256(temporary) !== expected) throw new Error(`Mantur Cut download digest does not match: ${url}`)
    await rename(temporary, destination)
  } finally {
    await rm(temporary, { force: true })
  }
}

async function prepareCmake(cacheDir: string, config: SourceConfig): Promise<string> {
  const archiveName = `cmake-${config.cmakeVersion}-macos-universal.tar.gz`
  const archive = join(cacheDir, 'tools', archiveName)
  await download(`https://github.com/Kitware/CMake/releases/download/v${config.cmakeVersion}/${archiveName}`, archive, config.cmakeMacArchiveSha256)
  const directory = join(cacheDir, 'tools', `cmake-${config.cmakeVersion}-macos-universal`)
  const executable = join(directory, 'CMake.app/Contents/bin/cmake')
  try { await lstat(executable) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    run('tar', ['-xzf', archive, '-C', join(cacheDir, 'tools')], root)
  }
  const version = capture(executable, ['--version'], root).split('\n', 1)[0]
  if (version !== `cmake version ${config.cmakeVersion}`) throw new Error(`Mantur Cut CMake version does not match ${config.cmakeVersion}`)
  return dirname(executable)
}

async function prepareWhisper(
  source: string,
  cacheDir: string,
  config: SourceConfig,
  targetKey: ManturCutTarget,
  target: TargetSource,
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  const mirror = join(cacheDir, 'whisper.cpp.git')
  try { await lstat(mirror) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    run('git', ['init', '--bare', mirror], root)
  }
  run('git', ['--git-dir', mirror, 'fetch', '--force', '--depth', '1', config.whisperRepository, `${config.whisperCommit}:refs/heads/mantur-cut-pinned`], root)
  const whisperSource = join(source, '.cache/whisper-cli/whisper.cpp')
  await mkdir(dirname(whisperSource), { recursive: true })
  run('git', ['clone', '--no-checkout', mirror, whisperSource], root)
  run('git', ['checkout', '--detach', config.whisperCommit], whisperSource)
  if (capture('git', ['rev-parse', 'HEAD^{tree}'], whisperSource) !== config.whisperTree) throw new Error('Mantur Cut Whisper tree does not match its source pin')

  if (target.whisperArchive !== null && target.whisperArchiveSha256 !== null) {
    const archive = join(cacheDir, 'downloads', `${config.whisperVersion}-${target.whisperArchive}`)
    await download(`https://github.com/ggml-org/whisper.cpp/releases/download/${config.whisperVersion}/${target.whisperArchive}`, archive, target.whisperArchiveSha256)
    const extracted = join(source, '.cache/whisper-cli/prebuilt', targetKey)
    await mkdir(extracted, { recursive: true })
    run('unzip', ['-q', archive, '-d', extracted], source)
    await cp(join(extracted, 'Release'), join(source, 'public/whisper-cli', targetKey), { recursive: true })
  } else {
    const buildDirectory = join(source, '.cache/whisper-cli/build')
    run('cmake', [
      '-B', buildDirectory,
      '-DCMAKE_BUILD_TYPE=Release',
      '-DBUILD_SHARED_LIBS=OFF',
      '-DGGML_METAL=ON',
      '-DGGML_METAL_EMBED_LIBRARY=ON',
      whisperSource,
    ], source, environment)
    run('cmake', ['--build', buildDirectory, '--config', 'Release', '-j', '--target', 'whisper-cli', 'whisper-server'], source, environment)
    const targetDirectory = join(source, 'public/whisper-cli', targetKey)
    await mkdir(targetDirectory, { recursive: true })
    for (const executable of ['whisper-cli', 'whisper-server']) {
      const destination = join(targetDirectory, executable)
      await cp(join(buildDirectory, 'bin', executable), destination)
      await chmod(destination, 0o755)
    }
  }
}

function verifyWhisperExecutables(source: string, targetKey: ManturCutTarget, target: TargetSource, environment: NodeJS.ProcessEnv): void {
  const directory = join(source, 'public/whisper-cli', targetKey)
  const suffix = target.platform === 'win32' ? '.exe' : ''
  for (const executable of [`whisper-cli${suffix}`, `whisper-server${suffix}`]) {
    run(join(directory, executable), ['--help'], directory, environment)
  }
}

function run(command: string, args: readonly string[], cwd: string, environment: NodeJS.ProcessEnv = process.env): void {
  const result = spawnSync(command, args, { cwd, env: environment, stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${String(result.status ?? result.signal)}`)
}

function capture(command: string, args: readonly string[], cwd: string, environment: NodeJS.ProcessEnv = process.env): string {
  const result = spawnSync(command, args, { cwd, env: environment, encoding: 'utf8' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${String(result.status ?? result.signal)}: ${result.stderr.trim()}`)
  return result.stdout.trim()
}

async function auditProductionDependencies(source: string, targetKey: ManturCutTarget, environment: NodeJS.ProcessEnv): Promise<string> {
  const result = spawnSync('npm', ['audit', '--json', '--omit=dev'], { cwd: source, env: environment, encoding: 'utf8' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0 && result.status !== 1) throw new Error(`npm audit exited with ${String(result.status ?? result.signal)}: ${result.stderr.trim()}`)
  let report: unknown
  try { report = JSON.parse(result.stdout) as unknown }
  catch { throw new Error('npm audit did not return valid JSON') }
  object(report, 'Mantur Cut npm audit report')
  const artifact = resolve(root, '.artifacts/mantur-cut-distribution-review', `npm-audit-${targetKey}-${process.pid}.json`)
  await mkdir(dirname(artifact), { recursive: true })
  await writeFile(artifact, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  process.stdout.write(`Mantur Cut production dependency audit written to ${artifact}\n`)
  return artifact
}

async function replaceDirectory(staging: string, outputDir: string): Promise<void> {
  const backup = `${outputDir}.backup-${process.pid}`
  let hadOutput = false
  try {
    await lstat(outputDir)
    hadOutput = true
    await rename(outputDir, backup)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  try {
    await rename(staging, outputDir)
  } catch (error) {
    if (hadOutput) await rename(backup, outputDir)
    throw error
  }
  if (hadOutput) await rm(backup, { recursive: true, force: true })
}

function inside(rootDir: string, candidate: string): boolean {
  const path = relative(rootDir, candidate)
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))
}

async function requireResource(resourceRoot: string, path: string, kind: 'file' | 'directory'): Promise<void> {
  if (isAbsolute(path) || path.split(/[\\/]/).includes('..')) throw new Error(`Mantur Cut resource path must stay relative: ${path}`)
  const candidate = resolve(resourceRoot, path)
  if (!inside(resourceRoot, candidate)) throw new Error(`Mantur Cut resource path escapes its root: ${path}`)
  if (!inside(await realpath(resourceRoot), await realpath(candidate))) throw new Error(`Mantur Cut resource resolves outside its root: ${path}`)
  const info = await lstat(candidate)
  if (kind === 'file' ? !info.isFile() : !info.isDirectory()) throw new Error(`Mantur Cut resource ${path} must be a ${kind}`)
}

/** Verify that every manifest path exists inside the packaged resource root. */
export async function verifyProgramManifest(resourceRoot: string, manifest: ProgramManifest): Promise<void> {
  await requireResource(resourceRoot, manifest.paths.server, 'file')
  await requireResource(resourceRoot, manifest.paths.web, 'directory')
  await requireResource(resourceRoot, manifest.paths.remotionBundle, 'directory')
  await requireResource(resourceRoot, manifest.paths.browserExecutable, 'file')
  await requireResource(resourceRoot, manifest.paths.ffmpeg, 'file')
  await requireResource(resourceRoot, manifest.paths.ffprobe, 'file')
  await requireResource(resourceRoot, manifest.paths.compositor, 'directory')
  await requireResource(resourceRoot, manifest.paths.whisperCli, 'file')
  await requireResource(resourceRoot, manifest.paths.whisperServer, 'file')
}

async function copyProductionProgram(source: string, staging: string, auditReport: string, targetKey: ManturCutTarget, target: TargetSource): Promise<ProgramManifest['paths']> {
  const whisperExecutable = target.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'
  const whisperServer = target.platform === 'win32' ? 'whisper-server.exe' : 'whisper-server'
  const paths: ProgramManifest['paths'] = {
    server: 'runtime/server/embedded-server.mjs',
    web: 'dist',
    remotionBundle: 'remotion-bundle',
    browserExecutable: target.browserExecutable,
    ffmpeg: target.ffmpeg,
    ffprobe: target.ffprobe,
    compositor: target.compositor,
    whisperCli: `whisper-cli/${targetKey}/${whisperExecutable}`,
    whisperServer: `whisper-cli/${targetKey}/${whisperServer}`,
  }
  await mkdir(dirname(join(staging, paths.server)), { recursive: true })
  await cp(join(source, 'desktop-dist/mantur-embedded-server.mjs'), join(staging, paths.server))
  await cp(join(source, 'dist'), join(staging, paths.web), { recursive: true })
  await cp(join(source, 'desktop-dist/remotion-bundle'), join(staging, paths.remotionBundle), { recursive: true })
  await cp(join(source, 'desktop-dist/chrome-headless-shell'), join(staging, 'chrome-headless-shell'), { recursive: true })
  await cp(join(source, 'public/whisper-cli', targetKey), join(staging, 'whisper-cli', targetKey), { recursive: true })
  await cp(join(source, '.cache/whisper-cli/whisper.cpp/LICENSE'), join(staging, 'whisper-cli/LICENSE.whisper.cpp'))
  await cp(join(source, 'node_modules'), join(staging, 'runtime/node_modules'), { recursive: true })
  await removePackageBinLinks(join(staging, 'runtime/node_modules'))
  await cp(join(source, 'package.json'), join(staging, 'package.json'))
  await cp(join(source, 'package-lock.json'), join(staging, 'package-lock.json'))
  await cp(join(source, 'LICENSE'), join(staging, 'LICENSE'))
  await cp(themeAdapter, join(staging, 'dist/mantur-theme.mjs'))
  await mkdir(join(staging, 'SOURCE/patches'), { recursive: true })
  await cp(sourceConfigPath, join(staging, 'SOURCE/source.json'))
  await cp(resolve(patchRoot, 'mantur-cut.patch'), join(staging, 'SOURCE/patches/mantur-cut.patch'))
  await cp(resolve(patchRoot, 'mantur-cut-packaged.patch'), join(staging, 'SOURCE/patches/mantur-cut-packaged.patch'))
  await mkdir(join(staging, 'SECURITY'), { recursive: true })
  await cp(auditReport, join(staging, 'SECURITY/npm-audit.json'))
  return paths
}

async function removePackageBinLinks(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const child = join(directory, entry.name)
    if (entry.name === '.bin') await rm(child, { recursive: true, force: true })
    else await removePackageBinLinks(child)
  }
}

async function writeDependencyInventory(resourceRoot: string): Promise<void> {
  const packages: Array<{ path: string; name: string; version: string; license: string | null; licenseFiles: string[] }> = []
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const child = join(directory, entry.name)
      if (entry.name.startsWith('@')) { await visit(child); continue }
      const packagePath = join(child, 'package.json')
      try {
        const value = object(JSON.parse(await readFile(packagePath, 'utf8')) as unknown, packagePath)
        const licenseFiles = (await readdir(child)).filter(name => /^(LICENSE|LICENCE|COPYING|NOTICE)(\.|$)/i.test(name)).sort()
        packages.push({
          path: relative(resourceRoot, child).split(sep).join('/'),
          name: string(value.name, `${packagePath} name`),
          version: string(value.version, `${packagePath} version`),
          license: typeof value.license === 'string' ? value.license : null,
          licenseFiles,
        })
        const nested = join(child, 'node_modules')
        try { await visit(nested) } catch (nestedError) { if ((nestedError as NodeJS.ErrnoException).code !== 'ENOENT') throw nestedError }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
  }
  await visit(join(resourceRoot, 'runtime/node_modules'))
  packages.sort((a, b) => a.path.localeCompare(b.path))
  await writeFile(join(resourceRoot, 'THIRD_PARTY_PACKAGES.json'), `${JSON.stringify({ formatVersion: 1, packages }, null, 2)}\n`)
}

async function directorySha256(directory: string): Promise<string> {
  const records: string[] = []
  async function visit(current: string): Promise<void> {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile()) records.push(`${relative(directory, path).split(sep).join('/')}\0${await fileSha256(path)}`)
      else throw new Error(`Mantur Cut resource tree contains a non-file entry: ${path}`)
    }
  }
  await visit(directory)
  return createHash('sha256').update(records.join('\n')).digest('hex')
}

async function writeBuildInformation(
  resourceRoot: string,
  config: SourceConfig,
  targetKey: ManturCutTarget,
  target: TargetSource,
  paths: ProgramManifest['paths'],
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  const harnessCommit = capture('git', ['rev-parse', 'HEAD'], root)
  const information = {
    formatVersion: 1,
    target: targetKey,
    harnessCommit,
    distributionId: await fileSha256(sourceConfigPath),
    buildHost: {
      platform: process.platform,
      arch: process.arch,
      nodeExecutable: process.execPath,
      nodeVersion: process.versions.node,
      npmVersion: capture('npm', ['--version'], root, environment),
      cmakeVersion: target.platform === 'darwin' ? capture('cmake', ['--version'], root, environment).split('\n', 1)[0] : null,
      compiler: target.platform === 'darwin' ? capture('xcrun', ['clang', '--version'], root, environment).split('\n', 1)[0] : null,
    },
    editor: {
      repository: config.repository,
      version: config.version,
      upstreamCommit: config.upstreamCommit,
      patchedTree: config.patches[1].resultTree,
    },
    runtime: { electronVersion: config.electronVersion, embeddedNodeVersion: config.embeddedNodeVersion, nodeLaunch: 'ELECTRON_RUN_AS_NODE=1' },
    dependencies: {
      remotion: { version: config.remotionVersion, license: 'SEE LICENSE IN LICENSE.md' },
      ffmpegStatic: { version: config.ffmpegStaticVersion, license: 'GPL-3.0-or-later' },
      ffprobe: { package: target.ffprobePackage, license: target.ffprobeLicense },
      chromeHeadlessShell: { version: target.chromeVersion, licenseFile: `chrome-headless-shell/${target.chromePlatform}/chrome-headless-shell-${target.chromePlatform}/LICENSE.headless_shell` },
      whisper: { repository: config.whisperRepository, version: config.whisperVersion, commit: config.whisperCommit, license: 'MIT', licenseFile: 'whisper-cli/LICENSE.whisper.cpp' },
    },
    sha256: {
      server: await fileSha256(join(resourceRoot, paths.server)),
      web: await directorySha256(join(resourceRoot, paths.web)),
      remotionBundle: await directorySha256(join(resourceRoot, paths.remotionBundle)),
      browserExecutable: await fileSha256(join(resourceRoot, paths.browserExecutable)),
      ffmpeg: await fileSha256(join(resourceRoot, paths.ffmpeg)),
      ffprobe: await fileSha256(join(resourceRoot, paths.ffprobe)),
      compositor: await directorySha256(join(resourceRoot, paths.compositor)),
      whisperCli: await fileSha256(join(resourceRoot, paths.whisperCli)),
      whisperServer: await fileSha256(join(resourceRoot, paths.whisperServer)),
      packageLock: await fileSha256(join(resourceRoot, 'package-lock.json')),
    },
  }
  await writeFile(join(resourceRoot, 'BUILD_INFO.json'), `${JSON.stringify(information, null, 2)}\n`)
  const review = `Mantur Cut distribution review\n\nThis resource contains modified OpenChatCut ${config.version} from ${config.repository} at ${config.upstreamCommit}. OpenChatCut declares AGPL-3.0-or-later. SOURCE/source.json and SOURCE/patches contain the exact source identity and both applied patches. A public distribution must make the complete corresponding source and build instructions available to every recipient under the applicable license terms.\n\nRemotion ${config.remotionVersion} uses its own LICENSE.md terms. The distributor must confirm that the legal entity is eligible for the free license or obtain the required company license, and must confirm that this embedded modified editor is an allowed use. This build does not accept either outcome.\n\nThe runtime includes ffmpeg-static ${config.ffmpegStaticVersion} under GPL-3.0-or-later, ${target.ffprobePackage} under ${target.ffprobeLicense}, whisper.cpp ${config.whisperVersion} at ${config.whisperCommit} under MIT, and Chrome Headless Shell ${target.chromeVersion} with its bundled LICENSE.headless_shell. THIRD_PARTY_PACKAGES.json inventories installed production packages and the license files retained beside them. SECURITY/npm-audit.json records the production dependency audit used for this build. Public release remains blocked until the source-delivery method, Remotion eligibility, GPL/LGPL obligations, notices, security findings, and binary redistribution terms are approved for this exact patched tree.\n`
  await writeFile(join(resourceRoot, 'SOURCE_OFFER_REVIEW.txt'), review)
}

function lockPackage(lock: Record<string, unknown>, name: string): Record<string, unknown> {
  const packages = object(lock.packages, 'OpenChatCut package-lock packages')
  return object(packages[`node_modules/${name}`], `OpenChatCut package-lock ${name}`)
}

async function verifyRuntimePins(source: string, config: SourceConfig, target: TargetSource): Promise<void> {
  const project = object(JSON.parse(await readFile(join(source, 'package.json'), 'utf8')) as unknown, 'OpenChatCut package')
  if (project.version !== config.version) throw new Error('OpenChatCut package version does not match its source pin')
  if (project.license !== 'AGPL-3.0-or-later') throw new Error('OpenChatCut package license does not match the reviewed license')
  const lock = object(JSON.parse(await readFile(join(source, 'package-lock.json'), 'utf8')) as unknown, 'OpenChatCut package-lock')
  const checks = [
    ['@remotion/renderer', config.remotionVersion, config.remotionRendererIntegrity],
    ['ffmpeg-static', config.ffmpegStaticVersion, config.ffmpegStaticIntegrity],
    [target.compositorPackage, config.remotionVersion, target.compositorIntegrity],
    [target.ffprobePackage, undefined, target.ffprobeIntegrity],
  ] as const
  for (const [name, version, integrity] of checks) {
    const row = lockPackage(lock, name)
    if ((version !== undefined && row.version !== version) || row.integrity !== integrity) throw new Error(`OpenChatCut package-lock pin does not match ${name}`)
  }
  if (lockPackage(lock, target.ffprobePackage).license !== target.ffprobeLicense) {
    throw new Error(`OpenChatCut package-lock license does not match ${target.ffprobePackage}`)
  }
}

async function prepare(targetKey: ManturCutTarget, cacheDir: string, outputDir: string): Promise<void> {
  const currentHost = hostTarget()
  if (targetKey !== currentHost) throw new Error(`Mantur Cut ${targetKey} must build on a matching native runner; current host is ${currentHost}`)
  if (outputDir === root || !inside(root, outputDir)) throw new Error('Mantur Cut output directory must stay inside the repository')
  const config = parseSourceConfig(JSON.parse(await readFile(sourceConfigPath, 'utf8')) as unknown)
  if (process.versions.node.split('.', 1)[0] !== '24') throw new Error(`Mantur Cut distribution requires Node 24; current Node is ${process.versions.node}`)
  const target = config.targets[targetKey]
  if (`${target.platform}-${target.arch}` !== targetKey) throw new Error(`Mantur Cut target metadata does not match ${targetKey}`)
  const desktopPackage = object(JSON.parse(await readFile(resolve(root, 'apps/desktop/package.json'), 'utf8')) as unknown, 'desktop package')
  const devDependencies = object(desktopPackage.devDependencies, 'desktop devDependencies')
  if (devDependencies.electron !== config.electronVersion) throw new Error('Mantur Cut Electron pin must match apps/desktop')

  await mkdir(cacheDir, { recursive: true })
  const mirror = join(cacheDir, 'openchatcut.git')
  try { await lstat(mirror) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    run('git', ['init', '--bare', mirror], root)
  }
  run('git', ['--git-dir', mirror, 'fetch', '--force', '--depth', '1', config.repository, `${config.upstreamCommit}:refs/heads/mantur-cut-pinned`], root)
  const temporary = await mkdtemp(join(tmpdir(), 'mantur-cut-distribution-'))
  const source = join(temporary, 'source')
  await mkdir(dirname(outputDir), { recursive: true })
  const stagingRoot = await mkdtemp(join(dirname(outputDir), '.mantur-cut-staging-'))
  const staging = join(stagingRoot, 'program')
  try {
    run('git', ['clone', '--no-checkout', mirror, source], root)
    run('git', ['checkout', '--detach', config.upstreamCommit], source)
    if (capture('git', ['rev-parse', 'HEAD^{tree}'], source) !== config.upstreamTree) throw new Error('Mantur Cut upstream tree does not match its source pin')
    for (const patch of config.patches) {
      const path = resolve(patchRoot, patch.file)
      if (!inside(patchRoot, path)) throw new Error(`Mantur Cut patch path escapes its owner: ${patch.file}`)
      if (await fileSha256(path) !== patch.sha256) throw new Error(`Mantur Cut patch digest does not match ${patch.file}`)
      run('git', ['apply', '--index', path], source)
      if (capture('git', ['write-tree'], source) !== patch.resultTree) throw new Error(`Mantur Cut patched tree does not match after ${patch.file}`)
    }
    await verifyRuntimePins(source, config, target)
    const cmakeDirectory = target.platform === 'darwin' ? await prepareCmake(cacheDir, config) : null
    const environment = sourceBuildEnvironment(cacheDir, process.env, cmakeDirectory === null ? [] : [cmakeDirectory])
    run('npm', ['ci'], source, environment)
    const auditReport = await auditProductionDependencies(source, targetKey, environment)
    await prepareWhisper(source, cacheDir, config, targetKey, target, environment)
    run('npm', ['run', 'build'], source, environment)
    verifyWhisperExecutables(source, targetKey, target, environment)
    run('npm', ['run', 'desktop:build:main'], source, environment)
    run('npm', ['run', 'desktop:prebundle'], source, environment)
    const chromeArchive = `chrome-headless-shell-${target.chromePlatform}-${target.chromeVersion}.zip`
    const cachedChrome = join(cacheDir, 'downloads', chromeArchive)
    await download(`https://storage.googleapis.com/chrome-for-testing-public/${target.chromeVersion}/${target.chromePlatform}/chrome-headless-shell-${target.chromePlatform}.zip`, cachedChrome, target.chromeSha256)
    await mkdir(join(source, 'desktop-dist'), { recursive: true })
    await cp(cachedChrome, join(source, 'desktop-dist', `chs-${target.chromePlatform}-${target.chromeVersion}.zip`))
    run('npm', ['run', 'desktop:prepare', '--', targetKey], source, environment)
    run(join(source, 'node_modules/.bin/esbuild'), ['desktop/embedded-server.ts', '--bundle', '--platform=node', '--format=esm', '--packages=external', '--outfile=desktop-dist/mantur-embedded-server.mjs'], source, environment)
    run('npm', ['prune', '--omit=dev'], source, environment)
    await mkdir(staging, { recursive: true })
    const paths = await copyProductionProgram(source, staging, auditReport, targetKey, target)
    if (await fileSha256(join(staging, paths.ffmpeg)) !== target.ffmpegSha256) throw new Error(`Mantur Cut FFmpeg binary does not match ${targetKey}`)
    const manifest: ProgramManifest = {
      formatVersion: 1,
      platform: target.platform,
      arch: target.arch,
      source: {
        upstreamCommit: config.upstreamCommit,
        patchedTree: config.patches[1].resultTree,
        basePatchSha256: config.patches[0].sha256,
        runtimePatchSha256: config.patches[1].sha256,
      },
      paths,
    }
    await verifyProgramManifest(staging, manifest)
    await writeDependencyInventory(staging)
    await writeBuildInformation(staging, config, targetKey, target, paths, environment)
    await writeFile(join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    await replaceDirectory(staging, outputDir)
  } finally {
    await rm(temporary, { recursive: true, force: true })
    await rm(stagingRoot, { recursive: true, force: true })
  }
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  if (index === -1) return undefined
  const value = process.argv[index + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

async function main(): Promise<void> {
  const target = (option('--target') ?? hostTarget()) as ManturCutTarget
  if (!['darwin-arm64', 'darwin-x64', 'win32-x64'].includes(target)) throw new Error(`Unsupported Mantur Cut target ${target}`)
  const cacheDir = resolve(option('--cache-dir') ?? process.env.MANTUR_CUT_CACHE_DIR ?? defaultCacheDir)
  const outputDir = resolve(option('--output-dir') ?? defaultOutputDir)
  await prepare(target, cacheDir, outputDir)
  process.stdout.write(`Mantur Cut ${target} resources prepared at ${outputDir}\n`)
}

if (import.meta.main) void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
