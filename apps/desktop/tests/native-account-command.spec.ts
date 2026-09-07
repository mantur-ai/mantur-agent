/** Main → real Loader/provider → command scope → actual Bash and locked CLI package. */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it, beforeAll } from 'vitest'
import { z } from 'zod'
import { hostFixture } from './native-account-host-support.ts'

const cliPackage = process.env.DSH_NATIVE_CLI_PACKAGE
const cliTarball = process.env.DSH_NATIVE_CLI_TARBALL
const resultSchema = z.object({ ok: z.literal(true), result: z.object({ exitCode: z.number().nullable(),
  signal: z.string().nullable(), timedOut: z.boolean(), aborted: z.boolean(),
  stdout: z.object({ text: z.string() }), stderr: z.object({ text: z.string() }) }) })
const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`

describe.skipIf(process.platform === 'win32')('native identity through real command consumers', () => {
  it('overrides a stale command descriptor while skipped and never looks up standalone credentials', async () => {
    const b = await hostFixture((_request, response) => { response.end('unexpected') }, false, true)
    await b.controller.skip()
    const reply = await b.send('command', { command: 'printf "%s:%s" "$MANTURHUB_IDENTITY_MODE" "$MANTURHUB_AGENT_AUTH"',
      env: { MANTURHUB_AGENT_AUTH: '/isolated/stale-descriptor.json', MANTURHUB_IDENTITY_MODE: 'standalone' } }).result
    expect(resultSchema.parse(reply).result).toMatchObject({ exitCode: 0, stdout: { text: 'desktop-managed:' } })
    expect(b.backend.observed).toEqual([])
    expect(await readdir(b.root)).toEqual(['native-account'])
  })

  it('releases the Main descriptor after the real Bash process and scope finish', async () => {
    const b = await hostFixture((_request, response) => { response.end('unexpected') }, false, true)
    await b.login()
    const reply = await b.send('command', { command: 'printf "%s" "$MANTURHUB_AGENT_AUTH"' }).result
    const result = resultSchema.parse(reply).result
    expect(result.exitCode).toBe(0)
    expect(result.stdout.text.startsWith(b.root)).toBe(true)
    await expect(readFile(result.stdout.text)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(b.nativeRequests).toContain('mantur:account:close-scope')
  })

  it('retains the Main identity across real persistent terminal sends and joins logout cleanup', async () => {
    const b = await hostFixture((_request, response) => { response.end('unexpected') }, false, true)
    await b.login()
    const opened = await b.send('terminal-open').result
    const { sessionId } = z.object({ sessionId: z.string() }).parse(opened.result)
    const reply = await b.send('terminal-send', { sessionId,
      text: 'printf "IDENTITY %s %s\\n" "$$" "$MANTURHUB_AGENT_AUTH"' }).result
    const { viewport, waitReason } = z.object({ viewport: z.string(), waitReason: z.string() }).parse(reply.result)
    expect(waitReason).toBe('stdin_read')
    const info = /^IDENTITY (\d+) (.+)$/mu.exec(viewport)
    if (info === null) throw new Error('Terminal did not print its identity descriptor')
    const pid = Number(info[1]), path = info[2]!
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect(() => process.kill(pid, 0)).not.toThrow()
    await b.controller.signOut()
    expect(() => process.kill(pid, 0)).toThrow()
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(b.nativeRequests).toContain('mantur:account:close-scope')
  })
})

describe.skipIf(process.platform === 'win32' || cliPackage === undefined && cliTarball === undefined)('native command consumer with frozen CLI 0.11.0', () => {
  beforeAll(async () => {
    if (cliPackage === undefined || cliTarball === undefined) throw new Error('Both frozen CLI inputs are required')
    expect(createHash('sha256').update(await readFile(cliTarball)).digest('hex'))
      .toBe('44e93ee513e9cad0805679209e27298b85dfdd9d7a1537d535c660206bd14013')
    const exec = promisify(execFile)
    const listing = await exec('tar', ['-tzf', cliTarball])
    const files = listing.stdout.trim().split('\n').filter(path => !path.endsWith('/'))
    expect(files).toHaveLength(22)
    for (const path of files) {
      expect(path.startsWith('package/')).toBe(true)
      const packed = await exec('tar', ['-xOf', cliTarball, path], { encoding: 'buffer' })
      expect(await readFile(join(cliPackage, path.slice(8)))).toEqual(packed.stdout)
    }
  })

  it('runs balance without a second login or an upstream key in the command environment', async () => {
    if (cliPackage === undefined) throw new Error('Frozen CLI directory is required')
    const b = await hostFixture((_request, response) => {
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ email: 'broker@example.com', balance: 9 }))
    }, false, true)
    await b.login()
    const reply = await b.send('command', { command: `${quote(process.execPath)} ${quote(join(cliPackage, 'bin/cli.js'))} balance --json`,
      env: { MANTURHUB_KEY: 'isolated-legacy-canary', MANTURHUB_BASE: 'https://other.invalid',
        MANTURHUB_DISABLE_UPDATE_CHECK: '1', MANTURHUB_DISABLE_SKILL_UPDATE_CHECK: '1' } }).result
    const result = resultSchema.parse(reply).result
    expect(result, result.stderr.text).toMatchObject({ exitCode: 0, signal: null, timedOut: false, aborted: false })
    expect(JSON.parse(result.stdout.text)).toEqual({ email: 'broker@example.com', balance: 9, balance_usd: 0.09 })
    expect(result.stdout.text + result.stderr.text).not.toContain(b.backend.bearer())
    expect(result.stdout.text + result.stderr.text).not.toContain(b.backend.password)
    expect(b.backend.observed).toEqual([{ path: '/api/v1/me', authorization: `Bearer ${String(b.backend.bearer())}`, apiKey: undefined, client: 'cli' }])
    expect(await readdir(b.root)).toEqual(['native-account'])
  })

  it.each(['logout', 'composition disposal'] as const)('joins %s through a streaming real CLI descendant', async (operation) => {
    if (cliPackage === undefined) throw new Error('Frozen CLI directory is required')
    const requested = Promise.withResolvers<undefined>()
    const b = await hostFixture((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/octet-stream' })
      response.write('stream-open')
      requested.resolve(undefined)
    }, false, true)
    await b.login()
    const api = pathToFileURL(join(cliPackage, 'lib/api.js')).href
    const source = `import {apiRequest} from ${JSON.stringify(api)}; console.log(JSON.stringify({pid:process.pid,descriptor:process.env.MANTURHUB_AGENT_AUTH})); const response=await apiRequest('/api/v1/stream'); await response.text()`
    const command = b.send('command', { command: `${quote(process.execPath)} --input-type=module --eval ${quote(source)}`,
      env: { MANTURHUB_DISABLE_UPDATE_CHECK: '1', MANTURHUB_DISABLE_SKILL_UPDATE_CHECK: '1' } })
    await requested.promise
    const stopped = operation === 'logout'
      ? b.controller.signOut()
      : b.send('dispose').result.then((reply) => { expect(reply.ok).toBe(true) })
    const result = resultSchema.parse(await command.result).result
    await stopped
    const processInfo = z.object({ pid: z.number().int().positive(), descriptor: z.string() }).parse(JSON.parse(result.stdout.text.trim()))
    expect(() => process.kill(processInfo.pid, 0)).toThrow()
    await expect(readFile(processInfo.descriptor)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(result.aborted).toBe(true)
    expect(b.controller.getSnapshot().authenticated).toBe(operation !== 'logout')
    expect(b.nativeRequests).toContain('mantur:account:close-scope')
  })
})
