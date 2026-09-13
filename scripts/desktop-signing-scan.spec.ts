/** Exercise the packager's actual scanner under a low process file-descriptor limit. */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'

it.skipIf(process.platform === 'win32')('scans every binary without exhausting descriptors or skipping nested code', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-signing-scan-'))
  try {
    const framework = join(root, 'Nested.framework')
    await mkdir(framework)
    for (let index = 0; index < 512; index += 1) {
      await writeFile(join(framework, `source-${index}.js`), 'export const value = 1\n')
    }
    const binary = join(framework, 'runtime.node')
    await writeFile(binary, Buffer.alloc(16))
    const requireDesktop = createRequire(new URL('../apps/desktop/package.json', import.meta.url))
    const requireBuilder = createRequire(requireDesktop.resolve('electron-builder'))
    const requireLibrary = createRequire(requireBuilder.resolve('app-builder-lib'))
    const scanner = requireLibrary.resolve('@electron/osx-sign')
    const result = spawnSync('/bin/bash', [
      '-ec', 'ulimit -Sn 64; ulimit -Hn 64; exec "$@"', 'desktop-signing-scan', process.execPath,
      '-e', 'require(process.argv[1]).walkAsync(process.argv[2]).then(paths => process.stdout.write(JSON.stringify(paths))).catch(error => { console.error(error); process.exitCode = 1 })',
      scanner, root,
    ], { encoding: 'utf8', timeout: 30_000 })
    expect(result.error).toBeUndefined()
    expect(result.signal).toBeNull()
    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual([binary, framework])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
