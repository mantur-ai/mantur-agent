/** Install and inspect the reviewed two-ABI media tree without rewriting its install names. */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { cp, lstat, mkdir, readFile, readdir, realpath, rm, symlink } from 'node:fs/promises'
import { dirname, isAbsolute, join, posix, relative, sep } from 'node:path'

type NativeMediaTarget = 'darwin-arm64' | 'win32-x64'

const windowsBinaries = [
  'bin/ffmpeg.exe', 'bin/ffprobe.exe', 'compositor/ffmpeg.exe', 'compositor/ffprobe.exe',
  'compositor/remotion.exe', 'compositor/avcodec-61.dll', 'compositor/avdevice-61.dll',
  'compositor/avfilter-10.dll', 'compositor/avformat-61.dll', 'compositor/avutil-59.dll',
  'compositor/swresample-5.dll', 'compositor/swscale-8.dll',
] as const

function currentTarget(): NativeMediaTarget {
  if (process.platform === 'darwin' && process.arch === 'arm64') return 'darwin-arm64'
  if (process.platform === 'win32' && process.arch === 'x64') return 'win32-x64'
  throw new Error(`Native media inspection does not support ${process.platform}-${process.arch}`)
}

/**
 * Check an x64 PE import table against the candidate directory and actual Windows system DLLs.
 * @param binary - Media-root-relative executable or DLL path.
 * @param output - GNU objdump -p output for the actual file.
 * @param files - Complete media-root-relative file inventory.
 * @param systemDlls - Lowercase DLL filenames present in the Windows System32 directory.
 * @returns The checked import names.
 */
export function windowsMediaDependencies(
  binary: string, output: string, files: ReadonlySet<string>, systemDlls: ReadonlySet<string>,
): string[] {
  if (!output.includes('file format pei-x86-64')) throw new Error(`Native media is not PE x64: ${binary}`)
  const imports = output.split('\n').flatMap((line) => {
    const name = /^\s*DLL Name:\s*(\S+)\s*$/.exec(line)?.[1]
    return name === undefined ? [] : [name]
  })
  if (imports.length === 0) throw new Error(`Native media has no PE imports: ${binary}`)
  const siblings = new Set([...files].filter(name => posix.dirname(name) === posix.dirname(binary))
    .map(name => posix.basename(name).toLowerCase()))
  for (const name of imports) {
    const lower = name.toLowerCase()
    if (!/^[a-z0-9_.-]+\.dll$/.test(lower)
      || (!siblings.has(lower) && !systemDlls.has(lower) && !/^(?:api|ext)-ms-win-[a-z0-9-]+\.dll$/.test(lower))) {
      throw new Error(`Unresolved Windows native media dependency in ${binary}: ${name}`)
    }
  }
  return imports
}

/**
 * Resolve a Mach-O dependency within the reviewed CLI or compositor ABI directory.
 * @param binary - Media-root-relative executable or library path.
 * @param dependency - Install name reported by otool.
 * @param files - Complete media-root-relative file inventory.
 * @returns The relative library path, or an unchanged Apple system dependency.
 */
export function nativeMediaDependency(binary: string, dependency: string, files: ReadonlySet<string>): string {
  const system = dependency.startsWith('/usr/lib/') || dependency.startsWith('/System/Library/')
  if (system && posix.normalize(dependency) === dependency) return dependency
  if (!dependency.startsWith('@loader_path/')) throw new Error(`Unresolved native media dependency: ${dependency}`)
  const path = posix.normalize(posix.join(posix.dirname(binary), dependency.slice('@loader_path/'.length)))
  const cli = binary.startsWith('bin/') || /^compositor\/ff(?:mpeg|probe)$/.test(binary) || binary.startsWith('lib/')
  const allowed = cli
    ? /^lib\/lib(?:avcodec|avdevice|avfilter|avformat|avutil|swresample|swscale)\.\d+\.dylib$/
    : /^compositor\/lib(?:avcodec|avdevice|avfilter|avformat|avutil|swresample|swscale)\.dylib$/
  if (!allowed.test(path) || !files.has(path)) throw new Error(`Unresolved native media dependency in ${binary}: ${dependency}`)
  return path
}

async function inventory(directory: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {}
  async function visit(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile()) files[relative(directory, path).split(sep).join('/')] = createHash('sha256').update(await readFile(path)).digest('hex')
      else throw new Error(`Native media must contain only files and directories: ${path}`)
    }
  }
  await visit(directory)
  return files
}

/**
 * Compare every candidate file with its committed inventory before staging or signing.
 * @param directory - Extracted candidate directory.
 * @param expected - Complete filename-to-SHA256 inventory bound by source.json.
 * @returns The checked file inventory.
 */
export async function verifyNativeMediaInventory(
  directory: string, expected: Readonly<Record<string, string>>,
): Promise<Record<string, string>> {
  const actual = await inventory(directory)
  const names = Object.keys(expected).sort()
  if (names.length === 0 || names.join('\0') !== Object.keys(actual).sort().join('\0')) throw new Error('Native media file inventory does not match')
  for (const name of names) {
    const digest = expected[name]
    if (digest === undefined || !/^[a-f0-9]{64}$/.test(digest) || actual[name] !== digest) {
      throw new Error(`Native media digest does not match: ${name}`)
    }
  }
  return actual
}

function capture(executable: string, args: string[], environment?: NodeJS.ProcessEnv, maxBuffer?: number): string {
  const result = spawnSync(executable, args, { encoding: 'utf8', env: environment, timeout: 30_000, maxBuffer })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`Native media probe failed: ${executable}: ${result.stderr}`)
  return result.stdout + result.stderr
}

/**
 * Inspect the platform's complete native library set and load all four CLI copies.
 * @param directory - Complete native-media directory with platform-owned bin and compositor children.
 * @param target - Native target to inspect; execution requires that target's host.
 * @returns SHA256 inventory of the actual inspected bytes; distribution signing may change those bytes.
 */
export async function verifyNativeMedia(directory: string, target: NativeMediaTarget = currentTarget()): Promise<Record<string, string>> {
  const actual = await inventory(directory)
  const files = new Set(Object.keys(actual))
  if (target === 'win32-x64') {
    if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Windows media inspection requires native Windows x64')
    const tool = process.env.MANTUR_WINDOWS_OBJDUMP
    if (tool === undefined || !isAbsolute(tool) || !(await lstat(tool)).isFile()) throw new Error('MANTUR_WINDOWS_OBJDUMP must name the reviewed native objdump executable')
    const systemRoot = process.env.SystemRoot
    if (systemRoot === undefined || !isAbsolute(systemRoot)) throw new Error('Windows media inspection requires SystemRoot')
    const systemDirectory = join(systemRoot, 'System32')
    const systemDlls = new Set((await readdir(systemDirectory)).filter(name => name.toLowerCase().endsWith('.dll')).map(name => name.toLowerCase()))
    const binaries = [...files].filter(name => /\.(?:exe|dll)$/i.test(name)).sort()
    if (binaries.join('\0') !== [...windowsBinaries].sort().join('\0')) throw new Error('Native media requires the reviewed twelve Windows PE files')
    for (const binary of binaries) windowsMediaDependencies(binary, capture(tool, ['-p', join(directory, binary)], undefined, 32 * 1024 * 1024), files, systemDlls)
    verifyCliCopies(directory, '.exe', { SystemRoot: systemRoot, PATH: systemDirectory, TEMP: process.env.TEMP, TMP: process.env.TMP })
    return actual
  }
  const binaries = [...files].filter(name => name.endsWith('.dylib') || /^(?:bin|compositor)\/ff(?:mpeg|probe)$/.test(name) || name === 'compositor/remotion')
  if (binaries.length !== 19) throw new Error('Native media requires nineteen Mach-O files')
  for (const binary of binaries) {
    const executable = join(directory, binary)
    if (!capture('/usr/bin/file', ['-b', executable]).includes('Mach-O 64-bit')) throw new Error(`Native media is not Mach-O: ${binary}`)
    if (!capture('/usr/bin/lipo', ['-archs', executable]).trim().split(/\s+/).every(arch => arch === 'arm64')) throw new Error(`Native media is not arm64: ${binary}`)
    capture('/usr/bin/codesign', ['--verify', '--strict', executable])
    const dependencies = capture('/usr/bin/otool', ['-L', executable]).split('\n').slice(1)
    for (const line of dependencies) {
      const dependency = /^\s+(.+) \(compatibility version /.exec(line)?.[1]
      if (dependency !== undefined) nativeMediaDependency(binary, dependency, files)
    }
  }
  verifyCliCopies(directory, '', { PATH: process.env.PATH, DYLD_LIBRARY_PATH: join(directory, 'compositor') })
  return actual
}

function verifyCliCopies(directory: string, suffix: string, environment: NodeJS.ProcessEnv): void {
  for (const folder of ['bin', 'compositor']) {
    for (const name of ['ffmpeg', 'ffprobe']) {
      const executable = join(directory, folder, name + suffix)
      const version = capture(executable, ['-version'], environment)
      if (!version.startsWith(`${name} version 6.1.6`) || /--enable-(?:nonfree|libfdk_aac)/.test(version)) throw new Error(`Native media has an unreviewed configuration: ${folder}/${name}`)
      if (!capture(executable, ['-L'], environment).includes('GNU General Public License')) throw new Error(`Native media CLI license does not match: ${folder}/${name}`)
    }
  }
}

async function removeDefault(path: string): Promise<void> {
  try {
    const stat = await lstat(path)
    if (stat.isSymbolicLink()) throw new Error(`Unexpected existing media alias: ${path}`)
    await rm(path, { recursive: stat.isDirectory() })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  await mkdir(dirname(path), { recursive: true })
}

/**
 * Install a complete candidate and replace npm executable lookups with reviewed aliases or Windows copies.
 * @param candidate - Verified extracted candidate, retained without modification.
 * @param runtime - New staging runtime containing its production node_modules.
 * @param expected - Complete committed candidate inventory.
 * @param target - Platform whose npm lookup paths will be replaced.
 */
export async function installNativeMedia(candidate: string, runtime: string, expected: Readonly<Record<string, string>>, target: NativeMediaTarget = 'darwin-arm64'): Promise<void> {
  await verifyNativeMediaInventory(candidate, expected)
  const destination = join(runtime, 'native-media')
  await cp(candidate, destination, { recursive: true, errorOnExist: true, force: false })
  await verifyNativeMediaInventory(destination, expected)
  if (target === 'win32-x64') {
    for (const [path, source] of [
      ['node_modules/@remotion/compositor-win32-x64-msvc', 'compositor'],
      ['node_modules/ffmpeg-static/ffmpeg.exe', 'bin/ffmpeg.exe'],
      ['node_modules/@ffprobe-installer/win32-x64/ffprobe.exe', 'bin/ffprobe.exe'],
    ] as const) {
      const pathInRuntime = join(runtime, path)
      await removeDefault(pathInRuntime)
      await cp(join(destination, source), pathInRuntime, { recursive: true, errorOnExist: true, force: false })
    }
    await verifyWindowsDefaultCopies(runtime)
    return
  }
  const aliases = [
    ['node_modules/@remotion/compositor-darwin-arm64', '../../native-media/compositor', 'dir'],
    ['node_modules/ffmpeg-static/ffmpeg', '../../native-media/bin/ffmpeg', 'file'],
    ['node_modules/@ffprobe-installer/darwin-arm64/ffprobe', '../../../native-media/bin/ffprobe', 'file'],
  ] as const
  for (const [path, target, kind] of aliases) {
    const alias = join(runtime, path)
    await removeDefault(alias)
    await symlink(target, alias, kind)
    const resolved = await realpath(alias)
    const expectedPath = join(destination, kind === 'dir' ? 'compositor' : `bin/${path.endsWith('/ffmpeg') ? 'ffmpeg' : 'ffprobe'}`)
    if (resolved !== await realpath(expectedPath)) throw new Error(`Native media alias resolves to an unexpected resource: ${alias}`)
  }
}

async function verifyWindowsDefaultCopies(runtime: string): Promise<void> {
  await verifyNativeMediaInventory(join(runtime, 'node_modules/@remotion/compositor-win32-x64-msvc'), await inventory(join(runtime, 'native-media/compositor')))
  for (const [path, expected] of [
    ['node_modules/ffmpeg-static/ffmpeg.exe', 'bin/ffmpeg.exe'],
    ['node_modules/@ffprobe-installer/win32-x64/ffprobe.exe', 'bin/ffprobe.exe'],
  ] as const) {
    const actual = join(runtime, path)
    if (!(await lstat(actual)).isFile() || !(await readFile(actual)).equals(await readFile(join(runtime, 'native-media', expected)))) {
      throw new Error(`Native media fallback differs from its candidate: ${path}`)
    }
  }
}

/**
 * Verify npm's fallback package paths resolve to the same reviewed media tree.
 * @param runtime - Packaged runtime directory containing node_modules and native-media.
 * @param target - Native target whose npm defaults must remain bound to the reviewed media.
 */
export async function verifyNativeMediaDefaults(runtime: string, target: NativeMediaTarget = currentTarget()): Promise<void> {
  const require = createRequire(join(runtime, 'media-resolution.cjs'))
  if (target === 'win32-x64') {
    await verifyWindowsDefaultCopies(runtime)
    for (const [actual, expected] of [
      [require.resolve('@remotion/compositor-win32-x64-msvc/package.json'), 'node_modules/@remotion/compositor-win32-x64-msvc/package.json'],
      [require('ffmpeg-static') as string, 'node_modules/ffmpeg-static/ffmpeg.exe'],
      [(require('@ffprobe-installer/ffprobe') as { path: string }).path, 'node_modules/@ffprobe-installer/win32-x64/ffprobe.exe'],
    ] as const) {
      if (await realpath(actual) !== join(await realpath(runtime), expected)) throw new Error(`Native media fallback resolves outside its candidate: ${actual}`)
    }
    return
  }
  const defaults = [
    [require.resolve('@remotion/compositor-darwin-arm64/package.json'), 'compositor/package.json'],
    [require('ffmpeg-static') as string, 'bin/ffmpeg'],
    [(require('@ffprobe-installer/ffprobe') as { path: string }).path, 'bin/ffprobe'],
  ] as const
  for (const [actual, expected] of defaults) {
    if (await realpath(actual) !== await realpath(join(runtime, 'native-media', expected))) {
      throw new Error(`Native media fallback resolves outside its candidate: ${actual}`)
    }
  }
}
