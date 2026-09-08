/** Opt-in fixed-package joint tests: actual CLI/bin transport plus native controller, not the Electron/profile command entry. */
import { spawn, execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile, unlink } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { beforeAll, describe, expect, it, onTestFinished } from 'vitest'
import type { NativeBrokerDescriptor } from '../src/auth/broker.ts'
import { withNativeBrokerDescriptor } from '../src/auth/descriptor.ts'
import { nativeBrokerBench, nativeBrokerHeaders, nativeBrokerScope } from './native-account-broker-support.ts'

const cliPackage = process.env.DSH_NATIVE_CLI_PACKAGE
const cliTarball = process.env.DSH_NATIVE_CLI_TARBALL
const execFileAsync = promisify(execFile)
const packageHash = '44e93ee513e9cad0805679209e27298b85dfdd9d7a1537d535c660206bd14013'

function location(path: string): string {
  if (cliPackage === undefined) throw new Error('DSH_NATIVE_CLI_PACKAGE must name the fixed unpacked CLI')
  return join(cliPackage, path)
}

async function saveDescriptor(root: string, descriptor: NativeBrokerDescriptor): Promise<string> {
  const path = join(root, 'cli-auth.json')
  await writeFile(path, JSON.stringify(descriptor), { flag: 'wx', mode: 0o600 })
  onTestFinished(() => unlink(path))
  return path
}

async function command(path: string, args: readonly string[], signal?: AbortSignal) {
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
    MANTURHUB_IDENTITY_MODE: 'desktop-managed', MANTURHUB_AGENT_AUTH: path,
    MANTURHUB_KEY: 'isolated-legacy-canary-must-not-be-used', MANTURHUB_BASE: 'https://other.invalid',
    MANTURHUB_DISABLE_UPDATE_CHECK: '1', MANTURHUB_DISABLE_SKILL_UPDATE_CHECK: '1',
  }
  signal?.throwIfAborted()
  const child = spawn(process.execPath, [...args], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  const stop = (): void => { child.kill('SIGTERM') }
  signal?.addEventListener('abort', stop, { once: true })
  if (signal?.aborted === true) stop()
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; stop() }, 15_000)
  // All test commands disable both CLI background updaters and spawn no descendants.
  child.stdout.on('data', (chunk: Buffer) => { stdout.push(chunk) })
  child.stderr.on('data', (chunk: Buffer) => { stderr.push(chunk) })
  try {
    const status = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (code, exitSignal) => { resolve({ code, signal: exitSignal }) })
    })
    return { ...status, timedOut, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', stop)
  }
}

function script(source: string): string[] {
  return ['--input-type=module', '--eval', `import {apiFetch,apiRequest} from ${JSON.stringify(pathToFileURL(location('lib/api.js')).href)}; ${source}`]
}

// The unpublished release artifact is explicit input; ordinary CI does not claim this joint acceptance.
describe.skipIf(cliPackage === undefined && cliTarball === undefined || process.platform === 'win32')('fixed CLI 0.11.0 and Main broker joint transport (POSIX descriptor fixture)', () => {
  beforeAll(async () => {
    if (cliPackage === undefined || cliTarball === undefined) throw new Error('Both fixed CLI package and tarball paths are required')
    expect(createHash('sha256').update(await readFile(cliTarball)).digest('hex')).toBe(packageHash)
    const listed = await execFileAsync('tar', ['-tzf', cliTarball], { encoding: 'utf8' })
    const files = listed.stdout.trim().split('\n').filter(path => !path.endsWith('/'))
    expect(files).toHaveLength(22)
    for (const path of files) {
      expect(path.startsWith('package/')).toBe(true)
      const packed = await execFileAsync('tar', ['-xOf', cliTarball, path], { encoding: 'buffer' })
      expect(await readFile(location(path.slice('package/'.length))), path).toEqual(packed.stdout)
    }
  })

  it('runs the real balance command after browser code exchange, without a CLI login or ambient API key', async () => {
    const b = await nativeBrokerBench((_request, response) => {
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ email: 'broker@example.com', balance: 9 }))
    })
    await b.broker.run(new AbortController().signal, async (descriptor, signal) => {
      let saved: string | undefined
      await withNativeBrokerDescriptor(b.root, descriptor, signal, async (environment) => {
        const path = environment.MANTURHUB_AGENT_AUTH
        if (path === undefined) throw new Error('Expected managed descriptor path')
        saved = path
        const result = await command(path, [location('bin/cli.js'), 'balance', '--json'], signal)
        expect(result.timedOut).toBe(false)
        expect(result.signal).toBeNull()
        expect(result.code, result.stderr).toBe(0)
        expect(JSON.parse(result.stdout)).toMatchObject({ email: 'broker@example.com', balance: 9 })
        expect(result.stdout + result.stderr).not.toContain(b.bearer())
        expect(result.stdout + result.stderr).not.toContain(b.password)
      })
      if (saved === undefined) throw new Error('Expected published descriptor')
      await expect(readFile(saved)).rejects.toMatchObject({ code: 'ENOENT' })
    })
    expect(b.observed).toEqual([{ path: '/api/v1/me', authorization: `Bearer ${String(b.bearer())}`, apiKey: undefined, client: 'cli' }])
  })

  it('keeps optional 401 authenticated and streams downloads through the real packaged CLI transport', async () => {
    const b = await nativeBrokerBench((request, response) => {
      if (request.url === '/api/v1/operators') {
        response.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'CREDENTIAL_REVOKED' }))
      } else {
        response.writeHead(200, { 'Content-Type': 'application/zip', 'Set-Cookie': 'not-for-cli' })
        response.write('stream-')
        response.end('body')
      }
    })
    const scope = await nativeBrokerScope(b.broker)
    const path = await saveDescriptor(b.root, scope.descriptor)
    const result = await command(path, script("const denied=await apiFetch('/api/v1/operators',{auth:'optional'}); const download=await apiRequest('/api/v1/skills/test/download'); console.log(JSON.stringify({status:denied.status,body:await download.text(),cookie:download.headers.get('set-cookie')}));"))
    expect(result).toMatchObject({ code: 0, signal: null, timedOut: false })
    expect(JSON.parse(result.stdout)).toEqual({ status: 401, body: 'stream-body', cookie: null })
    expect(b.observed.map(value => value.path)).toEqual(['/api/v1/operators', '/api/v1/skills/test/download'])
    expect(b.observed.every(value => value.authorization === `Bearer ${String(b.bearer())}` && value.apiKey === undefined)).toBe(true)
  })

  it('runs the real upload command with brokered presign and a single direct credential-free PUT', async () => {
    const uploads: Array<{ method: string | undefined; authorization: string | undefined; body: string }> = []
    const tos = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => { chunks.push(chunk) })
      request.on('end', () => {
        uploads.push({ method: request.method, authorization: request.headers.authorization, body: Buffer.concat(chunks).toString('utf8') })
        response.end()
      })
    })
    onTestFinished(async () => {
      const closed = new Promise<void>((resolve) => { tos.close(() => { resolve() }) })
      tos.closeAllConnections()
      await closed
    })
    await new Promise<void>((resolve) => { tos.listen(0, '127.0.0.1', resolve) })
    const address = tos.address()
    if (address === null || typeof address === 'string') throw new Error('Expected isolated TOS endpoint')
    const signed = `http://127.0.0.1:${String(address.port)}/upload?signature=isolated-memory-only`
    const b = await nativeBrokerBench((request, response) => {
      request.resume()
      request.on('end', () => {
        response.setHeader('Content-Type', 'application/json')
        response.end(JSON.stringify({ put_url: signed, access_url: 'https://assets.example/public/file.txt' }))
      })
    })
    const scope = await nativeBrokerScope(b.broker)
    const path = await saveDescriptor(b.root, scope.descriptor)
    const file = join(b.root, 'upload.txt')
    await writeFile(file, 'direct body')
    const result = await command(path, [location('bin/cli.js'), 'upload', file])
    expect(result).toMatchObject({ code: 0, signal: null, timedOut: false })
    expect(result.stdout.trim()).toBe('https://assets.example/public/file.txt')
    expect(result.stdout + result.stderr).not.toContain(signed)
    expect(uploads).toEqual([{ method: 'PUT', authorization: undefined, body: 'direct body' }])
    expect(b.observed.map(value => value.path)).toEqual(['/api/v1/uploads/presign'])
  })

  it('fails a managed command with a missing descriptor instead of using its ambient key', async () => {
    const b = await nativeBrokerBench((_request, response) => { response.end('unexpected') })
    const result = await command(join(b.root, 'missing.json'), [location('bin/cli.js'), 'balance', '--json'])
    expect(result.timedOut).toBe(false)
    expect(result.code).not.toBe(0)
    expect(result.stderr).not.toContain('isolated-legacy-canary')
    expect(b.observed).toEqual([])
  })

  it('aborts an actual CLI body and waits for its child close on desktop logout', async () => {
    const entered = Promise.withResolvers<undefined>()
    const upstreamClosed = Promise.withResolvers<undefined>()
    const b = await nativeBrokerBench((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/octet-stream' })
      response.write('pending body')
      response.on('close', () => { upstreamClosed.resolve(undefined) })
      entered.resolve(undefined)
    })
    let descriptor: NativeBrokerDescriptor | undefined
    let result: Awaited<ReturnType<typeof command>> | undefined
    const running = b.broker.run(new AbortController().signal, async (value, signal) => {
      descriptor = value
      await withNativeBrokerDescriptor(b.root, value, signal, async (environment) => {
        const path = environment.MANTURHUB_AGENT_AUTH
        if (path === undefined) throw new Error('Expected managed descriptor path')
        result = await command(path, script("const response=await apiRequest('/api/v1/slow'); await response.text();"), signal)
      })
    })
    const rejected = expect(running).rejects.toMatchObject({ name: 'AbortError' })
    await entered.promise
    await b.controller.signOut()
    await upstreamClosed.promise
    await rejected
    expect(result?.timedOut).toBe(false)
    expect(result?.code === 0 && result.signal === null).toBe(false)
    expect(descriptor).toBeDefined()
    if (descriptor === undefined) throw new Error('Expected admitted command descriptor')
    const stale = await fetch(`${descriptor.proxy_origin}/api/v1/late`, { headers: nativeBrokerHeaders(descriptor) })
    expect(stale.status).toBe(401)
    await stale.body?.cancel()
    expect(b.observed).toHaveLength(1)
  })
})
