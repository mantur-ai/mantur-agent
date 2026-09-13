/** Target-only dependency copying and pre-signing relocation for the embedded editor. */

import { spawnSync } from 'node:child_process'
import { cp, lstat, readdir } from 'node:fs/promises'
import { basename, join, relative, sep } from 'node:path'
import type { ManturCutTarget } from './mantur-cut-distribution.ts'

/**
 * Copy production dependencies without build caches, the duplicate browser, or other ONNX targets.
 * @param source - Installed node_modules from the pinned editor build.
 * @param destination - New distribution staging node_modules directory.
 * @param target - Native target selected by the distribution build.
 */
export async function copyRuntimeDependencies(source: string, destination: string, target: ManturCutTarget): Promise<void> {
  const [platform, arch] = target.split('-') as [string, string]
  for (const packagePath of ['onnxruntime-node', '@huggingface/transformers/node_modules/onnxruntime-node']) {
    const binding = join(source, packagePath, 'bin/napi-v6', platform, arch, 'onnxruntime_binding.node')
    if (!(await lstat(binding)).isFile()) throw new Error(`Missing target ONNX binding: ${binding}`)
  }
  await cp(source, destination, {
    recursive: true,
    filter: (path) => {
      const name = relative(source, path).split(sep).join('/')
      if (name === '.cache/webpack' || name === '.remotion/chrome-headless-shell') return false
      const native = /(?:^|\/)node_modules\/onnxruntime-node\/bin\/napi-v6\/([^/]+)(?:\/([^/]+))?/.exec(`node_modules/${name}`)
      return native === null || (native[1] === platform && (native[2] === undefined || native[2] === arch))
    },
  })
}

function capture(command: string, args: string[], directory: string): string {
  const result = spawnSync(command, args, { cwd: directory, encoding: 'utf8' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`${command} failed (${String(result.status ?? result.signal)}): ${result.stderr.trim()}`)
  return result.stdout
}

function dependencies(binary: string, directory: string): string[] {
  return capture('/usr/bin/otool', ['-L', binary], directory).split('\n').slice(1).flatMap((line) => {
    const dependency = /^\s+(.+) \(compatibility version /.exec(line)?.[1]
    return dependency === undefined ? [] : [dependency]
  })
}

/**
 * Resolve only system libraries or same-directory compositor dylibs; reject unresolved references.
 * @param dependency - One Mach-O install name reported by otool.
 * @param libraries - Dylib filenames present in the compositor package.
 * @returns The absolute system install name or loader-relative sibling install name.
 */
export function compositorInstallName(dependency: string, libraries: ReadonlySet<string>): string {
  if (dependency.startsWith('/System/Library/') || dependency.startsWith('/usr/lib/')) return dependency
  const name = dependency.startsWith('@loader_path/') ? dependency.slice('@loader_path/'.length) : dependency
  if (name !== basename(name) || !libraries.has(name)) throw new Error(`Unresolved compositor dependency: ${dependency}`)
  return `@loader_path/${name}`
}

/**
 * Relocate the compositor executables and every sibling dylib before Electron signs the staged resources.
 * @param directory - macOS compositor package inside a new unsigned staging tree, never an installed App.
 */
export async function relocateMacCompositor(directory: string): Promise<void> {
  const libraries = new Set((await readdir(directory, { withFileTypes: true }))
    .filter(entry => entry.isFile() && entry.name.endsWith('.dylib')).map(entry => entry.name))
  const binaries = ['ffmpeg', 'ffprobe', 'remotion', ...libraries]
  const plans = binaries.map(binary => ({
    binary,
    changes: dependencies(binary, directory).map(dependency => ({
      from: dependency, to: compositorInstallName(dependency, libraries),
    })).filter(change => change.from !== change.to),
  }))
  for (const { binary, changes } of plans) {
    const args = changes.flatMap(change => ['-change', change.from, change.to])
    if (libraries.has(binary)) args.push('-id', `@loader_path/${binary}`)
    if (args.length > 0) capture('/usr/bin/install_name_tool', [...args, binary], directory)
  }
  for (const binary of binaries) {
    for (const dependency of dependencies(binary, directory)) {
      if (compositorInstallName(dependency, libraries) !== dependency) throw new Error(`Unrelocated compositor dependency in ${binary}: ${dependency}`)
    }
  }
}
