/** Staging exclusions preserve runtime dependencies; macOS fixtures retain hardened-runtime signing. */

import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { compositorInstallName, copyRuntimeDependencies, relocateMacCompositor } from './mantur-cut-resources.ts'

const directories: string[] = []

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'mantur-staging-'))
  directories.push(directory)
  return directory
}

async function file(root: string, path: string): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true })
  await writeFile(join(root, path), path)
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('editor resource staging', () => {
  it.each(['darwin-arm64', 'darwin-x64', 'win32-x64'] as const)('copies only %s ONNX binaries and preserves other cache content and licenses', async (target) => {
    const directory = await temporaryDirectory()
    const source = join(directory, 'source')
    const destination = join(directory, 'staged')
    const targets = ['darwin/arm64', 'darwin/x64', 'win32/x64', 'win32/arm64', 'linux/x64', 'linux/arm64']
    const packages = ['onnxruntime-node', '@huggingface/transformers/node_modules/onnxruntime-node']
    const preserved = ['.remotion/keep.json', '.cache/other/keep', 'other/bin/linux/runtime', '@remotion/renderer/LICENSE.md']
    const excluded = ['.cache/webpack/cache.bin', '.remotion/chrome-headless-shell/browser']
    for (const path of [...preserved, ...excluded]) await file(source, path)
    for (const pkg of packages) {
      await file(source, `${pkg}/LICENSE`)
      for (const native of targets) await file(source, `${pkg}/bin/napi-v6/${native}/onnxruntime_binding.node`)
    }
    await copyRuntimeDependencies(source, destination, target)
    for (const path of preserved) expect(await readFile(join(destination, path), 'utf8')).toBe(path)
    for (const path of excluded) await expect(readFile(join(destination, path))).rejects.toMatchObject({ code: 'ENOENT' })
    for (const pkg of packages) {
      expect(await readFile(join(destination, pkg, 'LICENSE'), 'utf8')).toBe(`${pkg}/LICENSE`)
      for (const native of targets) {
        const path = `${pkg}/bin/napi-v6/${native}/onnxruntime_binding.node`
        if (native === target.replace('-', '/')) expect(await readFile(join(destination, path), 'utf8')).toBe(path)
        else await expect(readFile(join(destination, path))).rejects.toMatchObject({ code: 'ENOENT' })
      }
    }
    for (const path of excluded) expect(await readFile(join(source, path), 'utf8')).toBe(path)
  })

  it('rejects missing target bindings before copying an incomplete package', async () => {
    const directory = await temporaryDirectory()
    await mkdir(join(directory, 'source'))
    await expect(copyRuntimeDependencies(join(directory, 'source'), join(directory, 'staged'), 'darwin-arm64')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(directory, 'staged'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('relocates sibling libraries without accepting unresolved or external dependencies', () => {
    const libraries = new Set(['libfixture.dylib'])
    expect(compositorInstallName('libfixture.dylib', libraries)).toBe('@loader_path/libfixture.dylib')
    expect(compositorInstallName('@loader_path/libfixture.dylib', libraries)).toBe('@loader_path/libfixture.dylib')
    for (const path of ['/usr/lib/libSystem.B.dylib', '/System/Library/Frameworks/Foundation.framework/Foundation']) {
      expect(compositorInstallName(path, libraries)).toBe(path)
    }
    for (const path of ['missing.dylib', '@rpath/libfixture.dylib', '../libfixture.dylib', '@loader_path/../libfixture.dylib', '/opt/homebrew/lib/libfixture.dylib']) {
      expect(() => compositorInstallName(path, libraries)).toThrow('Unresolved compositor dependency')
    }
  })

  // Mach-O install names, ad-hoc signing and hardened runtime are owned by macOS.
  it.skipIf(process.platform !== 'darwin')('loads recursive sibling dylibs after relocation and hardened-runtime signing', async () => {
    const directory = await temporaryDirectory()
    const desktopRequire = createRequire(new URL('../apps/desktop/package.json', import.meta.url))
    const builderRequire = createRequire(desktopRequire.resolve('electron-builder'))
    // Match the existing packager's standard entitlements; production signing options remain unchanged.
    const entitlements = join(dirname(builderRequire.resolve('app-builder-lib/package.json')), 'templates/entitlements.mac.plist')
    function command(executable: string, args: string[], input?: string): string {
      const result = spawnSync(executable, args, { cwd: directory, encoding: 'utf8', input, timeout: 30_000 })
      expect(result.error).toBeUndefined()
      expect(result.signal, result.stderr).toBeNull()
      expect(result.status, result.stderr).toBe(0)
      return result.stdout
    }
    command('/usr/bin/cc', ['-x', 'c', '-', '-dynamiclib', '-Wl,-headerpad_max_install_names', '-Wl,-install_name,libinner.dylib', '-o', 'libinner.dylib'], 'int inner(void) { return 42; }\n')
    command('/usr/bin/cc', ['-x', 'c', '-', '-dynamiclib', '-L.', '-linner', '-Wl,-headerpad_max_install_names', '-Wl,-install_name,libouter.dylib', '-o', 'libouter.dylib'], 'int inner(void); int outer(void) { return inner(); }\n')
    command('/usr/bin/cc', ['-x', 'c', '-', '-L.', '-louter', '-Wl,-headerpad_max_install_names', '-o', 'ffmpeg'], '#include <stdio.h>\nint outer(void); int main(void) { printf("%d", outer()); return 0; }\n')
    await cp(join(directory, 'ffmpeg'), join(directory, 'ffprobe'))
    await cp(join(directory, 'ffmpeg'), join(directory, 'remotion'))
    expect(command('/usr/bin/otool', ['-L', 'ffmpeg'])).toContain('\tlibouter.dylib ')
    await relocateMacCompositor(directory)
    for (const name of ['libinner.dylib', 'libouter.dylib', 'ffmpeg', 'ffprobe', 'remotion']) {
      command('/usr/bin/codesign', ['--force', '--sign', '-', '--options', 'runtime', '--entitlements', entitlements, name])
      command('/usr/bin/codesign', ['--verify', '--strict', name])
    }
    for (const name of ['ffmpeg', 'ffprobe', 'remotion']) expect(command(join(directory, name), [])).toBe('42')
    expect(command('/usr/bin/otool', ['-L', 'libouter.dylib'])).toContain('@loader_path/libinner.dylib')
  })
})
