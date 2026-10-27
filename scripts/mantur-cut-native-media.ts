/** Install and inspect the reviewed two-ABI media tree without rewriting its install names. */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { cp, lstat, mkdir, readFile, readdir, realpath, rm, symlink } from 'node:fs/promises'
import { dirname, join, posix, relative, sep } from 'node:path'

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

function capture(executable: string, args: string[], environment?: NodeJS.ProcessEnv): string {
  const result = spawnSync(executable, args, { encoding: 'utf8', env: environment, timeout: 30_000 })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`Native media probe failed: ${executable}: ${result.stderr}`)
  return result.stdout + result.stderr
}

/**
 * Check signed or unsigned media install names and load all four CLI copies in Remotion's loader environment.
 * @param directory - Complete native-media directory with bin, lib and compositor children.
 * @returns SHA256 inventory of the actual inspected bytes; distribution signing may change those bytes.
 */
export async function verifyNativeMedia(directory: string): Promise<Record<string, string>> {
  const actual = await inventory(directory)
  const files = new Set(Object.keys(actual))
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
  const environment = { PATH: process.env.PATH, DYLD_LIBRARY_PATH: join(directory, 'compositor') }
  for (const folder of ['bin', 'compositor']) {
    for (const name of ['ffmpeg', 'ffprobe']) {
      const executable = join(directory, folder, name)
      const version = capture(executable, ['-version'], environment)
      if (!version.startsWith(`${name} version 6.1.6`) || /--enable-(?:nonfree|libfdk_aac)/.test(version)) throw new Error(`Native media has an unreviewed configuration: ${folder}/${name}`)
      if (!capture(executable, ['-L'], environment).includes('GNU General Public License')) throw new Error(`Native media CLI license does not match: ${folder}/${name}`)
    }
  }
  return actual
}

/**
 * Install a complete candidate and replace npm executable lookups with contained relative aliases.
 * @param candidate - Verified extracted candidate, retained without modification.
 * @param runtime - New staging runtime containing its production node_modules.
 * @param expected - Complete committed candidate inventory.
 */
export async function installNativeMedia(candidate: string, runtime: string, expected: Readonly<Record<string, string>>): Promise<void> {
  await verifyNativeMediaInventory(candidate, expected)
  const destination = join(runtime, 'native-media')
  await cp(candidate, destination, { recursive: true, errorOnExist: true, force: false })
  await verifyNativeMediaInventory(destination, expected)
  const aliases = [
    ['node_modules/@remotion/compositor-darwin-arm64', '../../native-media/compositor', 'dir'],
    ['node_modules/ffmpeg-static/ffmpeg', '../../native-media/bin/ffmpeg', 'file'],
    ['node_modules/@ffprobe-installer/darwin-arm64/ffprobe', '../../../native-media/bin/ffprobe', 'file'],
  ] as const
  for (const [path, target, kind] of aliases) {
    const alias = join(runtime, path)
    try {
      const stat = await lstat(alias)
      if (stat.isSymbolicLink()) throw new Error(`Unexpected existing media alias: ${alias}`)
      await rm(alias, { recursive: stat.isDirectory() })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await mkdir(dirname(alias), { recursive: true })
    await symlink(target, alias, kind)
    const resolved = await realpath(alias)
    const expectedPath = join(destination, kind === 'dir' ? 'compositor' : `bin/${path.endsWith('/ffmpeg') ? 'ffmpeg' : 'ffprobe'}`)
    if (resolved !== await realpath(expectedPath)) throw new Error(`Native media alias resolves to an unexpected resource: ${alias}`)
  }
}

/**
 * Verify npm's fallback package paths resolve to the same reviewed media tree.
 * @param runtime - Packaged runtime directory containing node_modules and native-media.
 */
export async function verifyNativeMediaDefaults(runtime: string): Promise<void> {
  const require = createRequire(join(runtime, 'media-resolution.cjs'))
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
