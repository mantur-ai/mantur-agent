/** Embedded CLI resources through the real command consumer; these fixtures do not open Electron windows. */
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, onTestFinished } from 'vitest'
import { z } from 'zod'
import { embeddedCliEnvironment, prepareEmbeddedCli } from '../src/embedded-cli.ts'
import { hostFixture } from './native-account-host-support.ts'
import { smokeEmbeddedCli } from '../../../scripts/desktop-embedded-cli-smoke.ts'

const resourceRoot = fileURLToPath(new URL('../.generated/mantur-cli', import.meta.url))
const resultSchema = z.object({ ok: z.literal(true), result: z.object({ exitCode: z.number().nullable(),
  timedOut: z.boolean(), aborted: z.boolean(), stdout: z.object({ text: z.string() }), stderr: z.object({ text: z.string() }) }) })

async function profile() {
  const root = await mkdtemp(join(tmpdir(), 'mantur-embedded-cli-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  return root
}

it('copies CLI modules from an explicit resource root that the packager does not discard', async () => {
  const manifest = z.object({ build: z.object({ extraResources: z.array(z.object({ from: z.string(), to: z.string() })) }) })
    .parse(JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as unknown)
  expect(manifest.build.extraResources).toContainEqual({
    from: '.generated/mantur-cli/source.json', to: 'mantur-cli/source.json',
  })
  expect(manifest.build.extraResources).toContainEqual({
    from: '.generated/mantur-cli/node_modules', to: 'mantur-cli/node_modules',
  })
})

it('requires prepared resources and never chooses a global CLI when they are absent', async () => {
  const root = await profile()
  await expect(prepareEmbeddedCli({ resourceRoot: join(root, 'missing'), userData: root,
    executable: process.execPath, platform: 'darwin' })).rejects.toMatchObject({ code: 'ENOENT' })
})

it('replaces case variants of PATH and fixes desktop identity while preserving unrelated variables', () => {
  const environment = embeddedCliEnvironment('/owned/bin', { Path: '/ambient/bin', MANTURHUB_IDENTITY_MODE: 'standalone', LANG: 'C' })
  expect(environment.PATH).toBe('/owned/bin' + (process.platform === 'win32' ? ';' : ':') + '/ambient/bin')
  expect(environment.Path).toBeUndefined()
  expect(environment.MANTURHUB_IDENTITY_MODE).toBe('desktop-managed')
  expect(environment.LANG).toBe('C')
})

// Preparing the reviewed artifact is required evidence for distribution; ordinary source tests need not install it.
describe.skipIf(process.env.DSH_TEST_EMBEDDED_CLI !== '1')('prepared embedded CLI', () => {
  it('starts the reviewed CLI through its private launcher without an account', async () => {
    await smokeEmbeddedCli({ resourceRoot, userData: await profile(),
      executable: process.env.DSH_EMBEDDED_CLI_EXECUTABLE ?? process.execPath,
      platform: process.platform === 'win32' ? 'win32' : 'darwin' })
  })

  it.each(['manifest', 'dependency'] as const)('rejects damaged %s resources before launching', async (damage) => {
    const root = await profile()
    const resources = join(root, 'resources')
    await cp(resourceRoot, resources, { recursive: true })
    if (damage === 'manifest') await writeFile(join(resources, 'source.json'), '{}')
    else await rm(join(resources, 'node_modules/@vercel/detect-agent/dist/index.js'))
    await expect(smokeEmbeddedCli({ resourceRoot: resources, userData: root,
      executable: process.execPath, platform: 'darwin' })).rejects.toThrow()
    await expect(readFile(join(root, 'managed-cli-bin/manturhub'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('writes an explicit Windows launcher without relying on node.exe or global account configuration', async () => {
    const root = await profile()
    const bin = await prepareEmbeddedCli({ resourceRoot, userData: root, executable: process.execPath, platform: 'win32' })
    const script = await readFile(join(bin, 'manturhub.cmd'), 'utf8')
    expect(script).toContain('setlocal DisableDelayedExpansion')
    expect(script).toContain('set "ELECTRON_RUN_AS_NODE=1"')
    expect(script).toContain('set "MANTURHUB_IDENTITY_MODE=desktop-managed"')
    expect(script).not.toContain('node.exe')
  })

  it.skipIf(process.platform === 'win32')('runs the embedded balance command through Main and Loader, then refuses it after logout', async () => {
    const root = await profile()
    const bin = await prepareEmbeddedCli({ resourceRoot, userData: root,
      executable: process.env.DSH_EMBEDDED_CLI_EXECUTABLE ?? process.execPath, platform: 'darwin' })
    const environment = embeddedCliEnvironment(bin, { PATH: '/usr/bin:/bin', SystemRoot: process.env.SystemRoot })
    const b = await hostFixture((_request, response) => {
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ email: 'fixture@example.com', balance: 9 }))
    }, false, true, environment)
    await b.login()
    const reply = await b.send('command', { command: 'manturhub balance --json', env: {
      MANTURHUB_IDENTITY_MODE: 'standalone', MANTURHUB_KEY: 'never-use-this-key',
      MANTURHUB_BASE: 'https://other.invalid',
    } }).result
    const result = resultSchema.parse(reply).result
    expect(result, result.stderr.text).toMatchObject({ exitCode: 0, timedOut: false, aborted: false })
    expect(JSON.parse(result.stdout.text)).toMatchObject({ balance_usd: 0.09 })
    expect(result.stdout.text + result.stderr.text).not.toContain(b.backend.bearer())
    expect(b.backend.observed).toHaveLength(1)
    await b.controller.signOut()
    const signedOut = resultSchema.parse(await b.send('command', { command: 'manturhub balance --json', env: {
      MANTURHUB_KEY: 'never-use-this-key', MANTURHUB_IDENTITY_MODE: 'standalone',
    } }).result).result
    expect(signedOut.exitCode).not.toBe(0)
    expect(b.backend.observed).toHaveLength(1)
    expect(signedOut.stdout.text + signedOut.stderr.text).not.toContain('never-use-this-key')
  })
})
