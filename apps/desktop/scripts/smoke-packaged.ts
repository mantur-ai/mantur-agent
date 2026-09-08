/** Native smoke for the dependency closure inside one unpacked desktop application. */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { startDesktopService } from '../src/runtime.ts'
import { parseProgramManifest, verifyProgramManifest } from '../../../scripts/mantur-cut-distribution.ts'

const desktopRoot = resolve(import.meta.dirname, '..')

function packagedPaths(): { electronExecutable: string; resourcesRoot: string; nativeResourcesRoot: string; updateConfig: string } {
  if (process.platform === 'darwin') {
    const app = join(desktopRoot, 'dist', process.arch === 'arm64' ? 'mac-arm64' : 'mac', '漫途Agent.app')
    return {
      electronExecutable: join(app, 'Contents', 'MacOS', '漫途Agent'),
      resourcesRoot: join(app, 'Contents', 'Resources', 'app'),
      nativeResourcesRoot: join(app, 'Contents', 'Resources'),
      updateConfig: join(app, 'Contents', 'Resources', 'app-update.yml'),
    }
  }
  if (process.platform === 'win32') {
    const directory = join(desktopRoot, 'dist', 'win-unpacked')
    return {
      electronExecutable: join(directory, '漫途Agent.exe'),
      resourcesRoot: join(directory, 'resources', 'app'),
      nativeResourcesRoot: join(directory, 'resources'),
      updateConfig: join(directory, 'resources', 'app-update.yml'),
    }
  }
  throw new Error(`desktop packaged smoke does not support ${process.platform}`)
}

const packaged = packagedPaths()
const entry = join(packaged.resourcesRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const updater = join(packaged.resourcesRoot, 'node_modules', 'electron-updater', 'out', 'main.js')
const manturCutRoot = join(packaged.nativeResourcesRoot, 'mantur-cut')
if (!existsSync(packaged.electronExecutable)) {
  throw new Error(`packaged Electron executable is missing: ${packaged.electronExecutable}`)
}
if (!existsSync(entry)) throw new Error(`packaged dsh entry is missing: ${entry}`)
if (!existsSync(updater)) throw new Error(`packaged updater entry is missing: ${updater}`)
const manturCutManifest = parseProgramManifest(JSON.parse(readFileSync(join(manturCutRoot, 'manifest.json'), 'utf8')) as unknown)
if (manturCutManifest.platform !== process.platform || manturCutManifest.arch !== process.arch) {
  throw new Error(`packaged Mantur Cut target is ${manturCutManifest.platform}-${manturCutManifest.arch}, expected ${process.platform}-${process.arch}`)
}
await verifyProgramManifest(manturCutRoot, manturCutManifest)
for (const file of ['BUILD_INFO.json', 'THIRD_PARTY_PACKAGES.json', 'SECURITY/npm-audit.json', 'SOURCE/source.json', 'SOURCE/patches/mantur-cut.patch', 'SOURCE/patches/mantur-cut-packaged.patch', 'SOURCE/patches/mantur-cut-shutdown.patch', 'SOURCE_OFFER_REVIEW.txt', 'whisper-cli/LICENSE.whisper.cpp']) {
  if (!existsSync(join(manturCutRoot, file))) throw new Error(`packaged Mantur Cut source or license record is missing: ${file}`)
}
for (const path of [manturCutManifest.paths.whisperCli, manturCutManifest.paths.whisperServer]) {
  const executable = join(manturCutRoot, path)
  const result = spawnSync(executable, ['--help'], { encoding: 'utf8', timeout: 30_000 })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`packaged Mantur Cut native executable failed to start: ${path}`)
}
if (!existsSync(packaged.updateConfig)) {
  throw new Error(`packaged updater configuration is missing: ${packaged.updateConfig}`)
}
const updateConfig = readFileSync(packaged.updateConfig, 'utf8')
for (const expected of ['provider: github', 'owner: mantur-ai', 'repo: mantur-harness']) {
  if (!updateConfig.includes(expected)) {
    throw new Error(`packaged updater configuration is missing ${expected}`)
  }
}
const dshHome = mkdtempSync(join(tmpdir(), 'mantur-agent-desktop-smoke-'))
const launchRoot = join(dshHome, 'launch-root')
const logPath = join(dshHome, 'harness.log')
mkdirSync(launchRoot)

const service = startDesktopService({
  electronExecutable: packaged.electronExecutable,
  entry,
  cwd: launchRoot,
  logPath,
  environment: {
    ...process.env,
    DSH_HOME: dshHome,
    DSH_TELEMETRY_DISABLED: '1',
    NODE_PATH: '',
  },
})
try {
  const url = await service.ready
  const exchange = await fetch(url, { redirect: 'manual' })
  const setCookie = exchange.headers.get('set-cookie')
  if (exchange.status !== 303 || setCookie === null) {
    throw new Error(`packaged dsh Web authentication returned HTTP ${String(exchange.status)}`)
  }
  const response = await fetch(new URL(url).origin, {
    headers: { cookie: setCookie.split(';', 1)[0]! },
  })
  const html = await response.text()
  if (!response.ok) throw new Error(`packaged dsh Web returned HTTP ${String(response.status)}`)
  if (!html.includes('__DSH_BOOT__')) throw new Error('packaged dsh Web did not return its boot payload')
  if (!html.includes('<title>漫途Agent</title>')) throw new Error('packaged Web title is not 漫途Agent')
  console.log(`desktop packaged smoke: ${String(response.status)} ${new URL(url).origin}`)
} finally {
  service.stop()
  await service.closed
  if (!readFileSync(logPath, 'utf8').includes('dsh web: http://127.0.0.1:')) {
    throw new Error('packaged Harness output was not persisted to the desktop log')
  }
  rmSync(dshHome, { recursive: true, force: true })
}
