/** Native launch check for the CLI resources shipped inside one application. */
import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { embeddedCliEnvironment, prepareEmbeddedCli, type EmbeddedCliOptions } from '../apps/desktop/src/embedded-cli.ts'

/**
 * Validate installed CLI dependencies and execute its profile-local launcher without account commands.
 * @param options - Actual packaged resources and executable with a caller-owned temporary profile.
 * @returns after the launcher reports the pinned CLI version.
 */
export async function smokeEmbeddedCli(options: EmbeddedCliOptions): Promise<void> {
  for (const [name, version, license, entry] of [
    ['@manturhub/cli', '0.11.0', 'MIT', 'bin/cli.js'],
    ['@vercel/detect-agent', '1.2.1', 'Apache-2.0', 'dist/index.js'],
  ] as const) {
    const directory = join(options.resourceRoot, 'node_modules', name)
    const manifest: unknown = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
    assert.ok(typeof manifest === 'object' && manifest !== null)
    assert.equal('name' in manifest && manifest.name, name)
    assert.equal('version' in manifest && manifest.version, version)
    assert.equal('license' in manifest && manifest.license, license)
    await readFile(join(directory, 'LICENSE'))
    await readFile(join(directory, entry))
  }
  const bin = await prepareEmbeddedCli(options)
  const windows = options.platform === 'win32'
  const launcher = join(bin, windows ? 'manturhub.cmd' : 'manturhub')
  const result = spawnSync(windows ? '"' + launcher + '"' : launcher, ['--version'], {
    encoding: 'utf8',
    timeout: 30_000,
    shell: windows,
    env: embeddedCliEnvironment(bin, { SystemRoot: process.env.SystemRoot }),
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0 || result.stdout.trim() !== '0.11.0') {
    throw new Error(`packaged CLI launcher failed: exit ${String(result.status)}, stdout ${JSON.stringify(result.stdout)}, stderr ${JSON.stringify(result.stderr)}`)
  }
}
