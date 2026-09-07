/** Package resources and IPC fixtures; the real editor build has a separate packaged smoke. */
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChildProcess } from 'node:child_process'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { resolvePackagedResources } from '../adapters/mantur-packaged-resources.mjs'
import { startEditor, type EditorRuntime, type RuntimeConfig } from '../src/runtime.ts'

const children = vi.hoisted(() => [] as Array<{ child: ChildProcess; closed: Promise<void>; isClosed: boolean }>)
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, spawn: (...args: Parameters<typeof actual.spawn>) => {
    const child = actual.spawn(...args)
    const entry = { child, closed: Promise.resolve(), isClosed: false }
    entry.closed = new Promise(resolve => child.once('close', () => { entry.isClosed = true; resolve() }))
    children.push(entry)
    return child
  } }
})

const roots: string[] = []
const running = new Set<EditorRuntime>()
afterEach(async () => {
  const results = await Promise.allSettled([...running].map(runtime => runtime.dispose()))
  running.clear()
  // Negative shutdown cases leave work alive; this cleanup is test-owned, never an installation result.
  for (const entry of children.splice(0)) {
    if (!entry.isClosed) entry.child.kill('SIGKILL')
    await entry.closed
  }
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  for (const result of results) if (result.status === 'rejected') throw result.reason
})
async function temporary() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'mantur-package-')))
  roots.push(root)
  return root
}

async function fixture(platform = process.platform, arch = process.arch) {
  const root = await temporary()
  const suffix = platform === 'win32' ? '.exe' : ''
  const paths = { server: 'server/embedded-server.mjs', web: 'dist', remotionBundle: 'remotion-bundle',
    browserExecutable: 'bin/browser', ffmpeg: 'bin/ffmpeg', ffprobe: 'bin/ffprobe', compositor: 'compositor',
    whisperCli: `bin/whisper-cli${suffix}`, whisperServer: `bin/whisper-server${suffix}` }
  for (const directory of ['server', 'dist', 'remotion-bundle', 'bin', 'compositor']) await mkdir(join(root, directory))
  for (const file of ['dist/index.html', 'dist/mantur-theme.mjs', 'remotion-bundle/index.html', 'compositor/program', 'bin/browser', 'bin/ffmpeg', 'bin/ffprobe', paths.whisperCli, paths.whisperServer]) {
    await writeFile(join(root, file), file)
  }
  await writeFile(join(root, paths.server), `import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
export async function startEmbeddedServer(dist, options) {
  assert.equal(options.port, 0);
  const server = createServer((req, res) => res.end(JSON.stringify({
    pid: process.pid, cwd: process.cwd(), temp: process.env.TMPDIR,
    renderBundle: process.env.CC_REMOTION_BUNDLE, compositor: process.env.CC_REMOTION_BINARIES_DIR,
    browser: process.env.CC_BROWSER_EXECUTABLE, ffmpeg: process.env.OPENCHATCUT_FFMPEG,
    ffprobe: process.env.OPENCHATCUT_FFPROBE, electronMode: process.env.ELECTRON_RUN_AS_NODE,
    whisperCli: process.env.OPENCHATCUT_WHISPER_CLI,
    parentOrigin: options.parentOrigin, dist,
  })));
  server.manturShutdown = { stopForShutdown: async () => {} };
  await new Promise(resolve => server.listen(options.port, '127.0.0.1', resolve));
  const close = server.close.bind(server);
  server.close = callback => close(async error => {
    await writeFile('shutdown.txt', 'HTTP closed');
    callback(error);
  });
  return {server, port: server.address().port};
}`)
  const manifest = { formatVersion: 1, platform, arch, paths }
  await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest))
  return { root, manifest }
}

describe('packaged editor manifest', () => {
  it.each([['darwin', 'arm64'], ['darwin', 'x64'], ['win32', 'x64']] as const)(
    'resolves only the declared resources for %s/%s', async (platform, arch) => {
      const { root } = await fixture(platform, arch)
      expect(resolvePackagedResources(root, platform, arch).server).toBe(join(root, 'server/embedded-server.mjs'))
      expect(() => resolvePackagedResources(root, 'linux', 'x64')).toThrow('platform and format')
    },
  )

  it('rejects mismatched versions, escaped paths and missing resources', async () => {
    const { root, manifest } = await fixture('darwin', 'arm64')
    const check = () => resolvePackagedResources(root, 'darwin', 'arm64')
    await writeFile(join(root, 'manifest.json'), JSON.stringify({ ...manifest, formatVersion: 2 }))
    expect(check).toThrow('platform and format')
    for (const server of ['../outside', '/absolute', 'server\\outside', 'server/../outside', '']) {
      await writeFile(join(root, 'manifest.json'), JSON.stringify({ ...manifest, paths: { ...manifest.paths, server } }))
      expect(check).toThrow('contained relative path')
    }
    await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest))
    await rm(join(root, manifest.paths.server))
    expect(check).toThrow('ENOENT')
    await mkdir(join(root, manifest.paths.server))
    expect(check).toThrow('file kind')
  })

  it('rejects linked directories outside the installation', async () => {
    const { root, manifest } = await fixture('darwin', 'arm64')
    const outside = await temporary()
    await symlink(outside, join(root, 'outside'), process.platform === 'win32' ? 'junction' : 'dir')
    await writeFile(join(root, 'manifest.json'), JSON.stringify({ ...manifest, paths: { ...manifest.paths, web: 'outside' } }))
    expect(() => resolvePackagedResources(root, 'darwin', 'arm64')).toThrow('escapes its installation')
  })

  it('requires both Whisper programs and their upstream sibling relationship', async () => {
    const { root, manifest } = await fixture('darwin', 'arm64')
    const check = () => resolvePackagedResources(root, 'darwin', 'arm64')
    for (const name of ['whisperCli', 'whisperServer']) {
      await writeFile(join(root, 'manifest.json'), JSON.stringify({ ...manifest, paths: { ...manifest.paths, [name]: undefined } }))
      expect(check).toThrow('contained relative path')
    }
    await writeFile(join(root, 'manifest.json'), JSON.stringify({ ...manifest, paths: { ...manifest.paths, whisperServer: 'bin/ffmpeg' } }))
    expect(check).toThrow('declared sibling')
    await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest))
    expect(check().whisperServer).toBe(join(root, 'bin/whisper-server'))
    await rm(join(root, manifest.paths.whisperServer))
    expect(check).toThrow('ENOENT')
  })

  it('checks static entry files rather than trusting their containing directory', async () => {
    const { root } = await fixture('darwin', 'arm64')
    const outside = await temporary()
    await writeFile(join(outside, 'index.html'), 'outside')
    await rm(join(root, 'dist/index.html'))
    await symlink(join(outside, 'index.html'), join(root, 'dist/index.html'), 'file')
    expect(() => resolvePackagedResources(root, 'darwin', 'arm64')).toThrow('escapes its installation')
  })
})

// The release supports these three desktop targets, not a Linux production editor.
describe.skipIf(!['darwin-arm64', 'darwin-x64', 'win32-x64'].includes(`${process.platform}-${process.arch}`))('packaged editor process', () => {
  it('uses separate writable Session directories and drains HTTP before child close', async () => {
    const { root } = await fixture()
    const before = await readFile(join(root, 'compositor/program'), 'utf8')
    const config: RuntimeConfig = { runtimeMode: 'packaged', editorRoot: root, nodeExecutable: process.execPath,
      startupTimeoutMs: 5000, stopTimeoutMs: 3000, toolCallTimeoutMs: 1000 }
    const project = await temporary()
    const first = await startEditor(config, project, 'one' as SessionId, 'http://127.0.0.1:5298')
    running.add(first)
    const second = await startEditor(config, project, 'two' as SessionId, 'http://127.0.0.1:5298')
    running.add(second)
    expect(first.workspace.editorUrl).not.toBe(second.workspace.editorUrl)
    for (const runtime of [first, second]) {
      const response = await fetch(runtime.workspace.editorUrl)
      const state = await response.json() as Record<string, string | number>
      expect(state.cwd).toBe(join(runtime.workspace.directory, '工程'))
      expect(state.electronMode).toBe('1')
      expect(state.parentOrigin).toBe('http://127.0.0.1:5298')
      expect(state.dist).toBe(join(root, 'dist'))
      expect(state.ffmpeg).toBe(join(root, 'bin/ffmpeg'))
      expect(state.ffprobe).toBe(join(root, 'bin/ffprobe'))
      expect(state.whisperCli).toBe(join(root, `bin/whisper-cli${process.platform === 'win32' ? '.exe' : ''}`))
      expect(state.temp).toContain(join(runtime.workspace.directory, '工程', '.mantur-runtime-'))
      expect(state.compositor).not.toContain(root)
      await Promise.all([runtime.dispose(), runtime.dispose()])
      expect(await readFile(join(state.cwd as string, 'shutdown.txt'), 'utf8')).toBe('HTTP closed')
      expect((await readdir(state.cwd as string)).some(file => file.startsWith('.mantur-runtime-'))).toBe(false)
      await expect(fetch(runtime.workspace.editorUrl)).rejects.toThrow()
      expect(() => process.kill(state.pid as number, 0)).toThrow()
    }
    expect(await readFile(join(root, 'compositor/program'), 'utf8')).toBe(before)
    expect((await readdir(root)).sort()).toEqual(['bin', 'compositor', 'dist', 'manifest.json', 'remotion-bundle', 'server'])
  })

  it('rejects an incomplete installation before creating Session data', async () => {
    const { root } = await fixture()
    await rm(join(root, 'bin/browser'))
    const project = await temporary()
    await expect(startEditor({ runtimeMode: 'packaged', editorRoot: root, nodeExecutable: process.execPath,
      startupTimeoutMs: 5000, stopTimeoutMs: 3000, toolCallTimeoutMs: 1000 }, project, 'one' as SessionId, 'http://127.0.0.1:5298')).rejects.toThrow('ENOENT')
    expect(await readdir(project)).toEqual([])
  })

  it('reports failed startup and retains its unconfirmed private runtime for diagnosis', async () => {
    const { root } = await fixture()
    await writeFile(join(root, 'server/embedded-server.mjs'), "throw new Error('production server import failed')")
    const project = await temporary()
    await expect(startEditor({ runtimeMode: 'packaged', editorRoot: root, nodeExecutable: process.execPath,
      startupTimeoutMs: 5000, stopTimeoutMs: 3000, toolCallTimeoutMs: 1000 }, project, 'one' as SessionId, 'http://127.0.0.1:5298')).rejects.toThrow('production server import failed')
    expect((await readdir(join(project, '剪辑/one/工程'))).some(file => file.startsWith('.mantur-runtime-'))).toBe(true)
    expect(await readdir(join(project, '剪辑/one/素材'))).toEqual([])
    expect(await readdir(join(project, '剪辑/one/导出'))).toEqual([])
  })

  it('does not report abnormal child termination as successful disposal', async () => {
    const { root } = await fixture()
    const serverFile = join(root, 'server/embedded-server.mjs')
    const source = await readFile(serverFile, 'utf8')
    await writeFile(serverFile, source.replace('callback(error);', 'process.exit(7);'))
    const runtime = await startEditor({ runtimeMode: 'packaged', editorRoot: root, nodeExecutable: process.execPath,
      startupTimeoutMs: 5000, stopTimeoutMs: 3000, toolCallTimeoutMs: 1000 }, await temporary(), 'one' as SessionId, 'http://127.0.0.1:5298')
    running.add(runtime)
    await expect(runtime.dispose()).rejects.toThrow('exited (7)')
    running.delete(runtime)
    await expect(fetch(runtime.workspace.editorUrl)).rejects.toThrow()
  })

  it('reports a shutdown deadline without force-killing the unconfirmed child', async () => {
    const { root } = await fixture()
    const serverFile = join(root, 'server/embedded-server.mjs')
    const source = await readFile(serverFile, 'utf8')
    await writeFile(serverFile, source.replace('callback(error);', 'setInterval(() => {}, 1000);'))
    const runtime = await startEditor({ runtimeMode: 'packaged', editorRoot: root, nodeExecutable: process.execPath,
      startupTimeoutMs: 5000, stopTimeoutMs: 50, toolCallTimeoutMs: 1000 }, await temporary(), 'one' as SessionId, 'http://127.0.0.1:5298')
    running.add(runtime)
    const response = await fetch(runtime.workspace.editorUrl)
    const { pid } = await response.json() as { pid: number }
    const stopping = runtime.dispose()
    try { await expect(stopping).rejects.toThrow('timed out') }
    finally { running.delete(runtime) }
    expect(runtime.dispose()).toBe(stopping)
    expect(() => process.kill(pid, 0)).not.toThrow()
    await expect(fetch(runtime.workspace.editorUrl)).rejects.toThrow()
  })
})
