/** Create a macOS disk image with the system image tool and an external block map. */

import { createRequire } from 'node:module'
import { mkdir, mkdtemp, rename, rm, symlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const desktopRoot = resolve(import.meta.dirname, '../apps/desktop')

export type MacArchitecture = 'arm64' | 'x64'

/**
 * Parse the required macOS artifact architecture.
 * @param arguments_ - Command-line arguments after the script path.
 * @returns Validated Electron architecture.
 */
export function parseMacArchitecture(arguments_: string[]): MacArchitecture {
  if (arguments_.length !== 2 || arguments_[0] !== '--arch') throw new Error('Usage: create-macos-dmg.ts --arch <arm64|x64>')
  const architecture = arguments_[1]
  if (architecture !== 'arm64' && architecture !== 'x64') throw new Error(`Unsupported macOS architecture: ${String(architecture)}`)
  return architecture
}

/**
 * Resolve electron-builder's unpacked application directory.
 * @param root - Desktop package directory.
 * @param architecture - Electron architecture.
 * @returns Absolute application path.
 */
export function macApplicationPath(root: string, architecture: MacArchitecture): string {
  return join(root, 'dist', architecture === 'arm64' ? 'mac-arm64' : 'mac', '漫途Agent.app')
}

function run(command: string, arguments_: string[]): void {
  const result = spawnSync(command, arguments_, { encoding: 'utf8', stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited with ${String(result.status)}`)
}

async function loadBlockMapBuilder(): Promise<(input: string, compression: 'gzip', output: string) => Promise<unknown>> {
  const require = createRequire(join(desktopRoot, 'package.json'))
  const electronBuilderPackage = require.resolve('electron-builder/package.json')
  const electronBuilderRequire = createRequire(electronBuilderPackage)
  const libraryPackage = electronBuilderRequire.resolve('app-builder-lib/package.json')
  const module = await import(pathToFileURL(join(dirname(libraryPackage), 'out/targets/blockmap/blockmap.js')).href) as {
    buildBlockMap: (input: string, compression: 'gzip', output: string) => Promise<unknown>
  }
  return module.buildBlockMap
}

async function main(): Promise<void> {
  if (process.platform !== 'darwin') throw new Error('macOS DMG creation requires macOS')
  const architecture = parseMacArchitecture(process.argv.slice(2))
  const application = macApplicationPath(desktopRoot, architecture)
  const output = join(desktopRoot, 'dist', `Mantur-Agent-macOS-${architecture}.dmg`)
  const blockMapOutput = `${output}.blockmap`
  const temporaryDirectory = await mkdtemp(join(desktopRoot, 'dist', '.mantur-dmg-'))
  const mountPoint = join(temporaryDirectory, 'mount')
  const writableImage = join(temporaryDirectory, 'writable.dmg')
  const compressedImage = join(temporaryDirectory, `Mantur-Agent-macOS-${architecture}.dmg`)
  const temporaryBlockMap = `${compressedImage}.blockmap`
  let mounted = false
  try {
    const buildVolumeName = `ManturAgentBuild-${String(process.pid)}`
    run('hdiutil', ['create', '-volname', buildVolumeName, '-srcfolder', application, '-format', 'UDRW', writableImage])
    await mkdir(mountPoint)
    run('hdiutil', ['attach', '-nobrowse', '-noverify', '-noautoopen', '-mountpoint', mountPoint, writableImage])
    mounted = true
    await symlink('/Applications', join(mountPoint, 'Applications'))
    run('diskutil', ['rename', mountPoint, '漫途Agent'])
    run('hdiutil', ['detach', mountPoint])
    mounted = false
    run('hdiutil', ['convert', writableImage, '-format', 'UDZO', '-o', compressedImage])
    const buildBlockMap = await loadBlockMapBuilder()
    await buildBlockMap(compressedImage, 'gzip', temporaryBlockMap)
    await rename(compressedImage, output)
    await rename(temporaryBlockMap, blockMapOutput)
  } finally {
    if (mounted) spawnSync('hdiutil', ['detach', mountPoint], { stdio: 'ignore' })
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) {
  main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 })
}
