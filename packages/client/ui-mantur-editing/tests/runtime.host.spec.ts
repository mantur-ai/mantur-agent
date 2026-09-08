import { mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import type { ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { editingDirectories, startEditor, type EditorRuntime, type RuntimeConfig } from '../src/runtime.ts'

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
const runtimes: EditorRuntime[] = []
afterEach(async () => {
  vi.useRealTimers()
  try { await Promise.all(runtimes.splice(0).map(runtime => runtime.dispose())) }
  finally {
    // Failure fixtures retain live processes by design; only the test owner force-cleans them after assertions.
    for (const entry of children.splice(0)) {
      if (!entry.isClosed) entry.child.kill('SIGKILL')
      await entry.closed
    }
    await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  }
})
async function temp() {
  const root = await mkdtemp(join(tmpdir(), 'mantur-cut-'))
  roots.push(root)
  return root
}

describe('Session editing directories', () => {
  it('keeps Sessions separate and reopening preserves existing media', async () => {
    const root = await temp()
    const first = await editingDirectories(root, 'session-a' as SessionId)
    await writeFile(join(first.media, 'clip.mp4'), 'owned source')
    const second = await editingDirectories(root, 'session-b' as SessionId)
    expect(first.directory).not.toBe(second.directory)
    expect(await readdir(second.media)).toEqual([])
    expect(await editingDirectories(root, 'session-a' as SessionId)).toEqual(first)
    expect(await readFile(join(first.media, 'clip.mp4'), 'utf8')).toBe('owned source')
  })

  it('rejects absent workspaces, path traversal and a linked editing directory', async () => {
    const root = await temp()
    await expect(editingDirectories(undefined, 'session' as SessionId)).rejects.toThrow('Select a project')
    await expect(editingDirectories(root, '../outside' as SessionId)).rejects.toThrow('identity')
    const paths = await editingDirectories(root, 'linked' as SessionId)
    const outside = await temp()
    await rm(paths.media, { recursive: true })
    await symlink(outside, paths.media)
    await expect(editingDirectories(root, 'linked' as SessionId)).rejects.toThrow('symbolic')
    expect(await readdir(outside)).toEqual([])
  })
})

async function fixture(listen: string, drain = '', close = '', transportClose = ''): Promise<RuntimeConfig> {
  const editorRoot = await temp()
  const vite = join(editorRoot, 'node_modules/vite/dist/node')
  await mkdir(vite, { recursive: true })
  await writeFile(join(editorRoot, 'node_modules/vite/package.json'), '{"type":"module"}')
  await writeFile(join(vite, 'index.js'), `import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
export async function createServer() {
  await writeFile('project-root.txt', process.env.MANTUR_CUT_PROJECT_DIR);
  const httpServer = createHttpServer((req, res) => {
    res.end('ready');
    if (req.url === '/exit') setImmediate(() => process.exit(0));
  });
  httpServer.manturShutdown = { stopForShutdown: async () => { ${drain} }, finishTransportShutdown: async () => { ${transportClose} } };
  const listen = httpServer.listen.bind(httpServer);
  httpServer.listen = async (...args) => { ${listen} listen(...args); };
  return { config: { server: {}, inlineConfig: { server: {} } }, httpServer, close: async () => {
    if (httpServer.listening) await new Promise(resolve => httpServer.close(resolve));
    await writeFile('closed.txt', 'drained');
    ${close}
  } };
}`.replace("import { createServer } from 'node:http'", "import { createServer as createHttpServer } from 'node:http'"))
  return { runtimeMode: 'development', editorRoot, nodeExecutable: process.execPath, startupTimeoutMs: 5000, stopTimeoutMs: 1000, toolCallTimeoutMs: 1000 }
}

describe('owned editor process', () => {
  it('waits for ready and drains close before reporting disposal complete', async () => {
    const config = await fixture('')
    const project = await temp()
    const runtime = await startEditor(config, project, 'session' as SessionId, 'http://127.0.0.1:5298')
    runtimes.push(runtime)
    expect(runtime.workspace.editorUrl).toMatch(/^http:\/\/127\.0\.0\.1:[1-9][0-9]+\/$/)
    expect(runtime.workspace).not.toHaveProperty('token')
    expect(await readFile(join(config.editorRoot, 'project-root.txt'), 'utf8')).toBe(await realpath(project))
    await Promise.all([runtime.dispose(), runtime.dispose()])
    expect(await readFile(join(config.editorRoot, 'closed.txt'), 'utf8')).toBe('drained')
    expect(() =>{  runtime.assertRunning() }).toThrow('exited')
  })

  it('drains a child that never sends ready and reports timeout', async () => {
    const config = await fixture("await writeFile('listen-started.txt', 'waiting'); await new Promise(() => {});")
    const project = await temp()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const failure = expect(startEditor({ ...config, startupTimeoutMs: 60_000 }, project, 'session' as SessionId, 'http://127.0.0.1:5298')).rejects.toThrow('timed out')
    try {
      await vi.waitFor(async () => { expect(await readFile(join(config.editorRoot, 'listen-started.txt'), 'utf8')).toBe('waiting') }, { timeout: 5000 })
    } finally {
      vi.advanceTimersToNextTimer()
      vi.useRealTimers()
      await failure
    }
    expect(await readFile(join(config.editorRoot, 'closed.txt'), 'utf8')).toBe('drained')
  })

  it('reports a spawn failure without claiming an editor exists', async () => {
    const config = await fixture('')
    await expect(startEditor({ ...config, nodeExecutable: join(config.editorRoot, 'missing-node') }, await temp(), 'session' as SessionId, 'http://127.0.0.1:5298')).rejects.toThrow('ENOENT')
  })
})

it('retains a rejected remote save and leaves the live process available for its outstanding work', async () => {
  const config = await fixture('', "throw new AggregateError([new Error('project write failed')], 'callbacks failed');")
  const runtime = await startEditor(config, await temp(), 'save-failure' as SessionId, 'http://127.0.0.1:5298')
  const stopping = runtime.dispose()
  await expect(stopping).rejects.toThrow('callbacks failed: project write failed')
  expect(runtime.dispose()).toBe(stopping)
  expect(children.at(-1)!.isClosed).toBe(false)
  expect((await fetch(runtime.workspace.editorUrl)).status).toBe(200)
  await expect(readFile(join(config.editorRoot, 'closed.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
})

it('rejects an unexpected zero exit even if the process was already closed', async () => {
  const config = await fixture('')
  const runtime = await startEditor(config, await temp(), 'unexpected-exit' as SessionId, 'http://127.0.0.1:5298')
  await fetch(new URL('exit', runtime.workspace.editorUrl))
  await children.at(-1)!.closed
  await expect(runtime.dispose()).rejects.toThrow('Editing runtime exited')
  await expect(runtime.dispose()).rejects.toThrow('Editing runtime exited')
})

it('waits for inherited stderr to close after a successful shutdown acknowledgement and parent exit', async () => {
  const holder = `
const {existsSync,writeFileSync,writeSync}=require('node:fs');
const {join}=require('node:path');
const root=process.argv[1];
writeFileSync('pipe-holder.txt','ready');
const timer=setInterval(()=>{if(existsSync(join(root,'release-pipe.txt'))){clearInterval(timer);writeSync(2,'late pipe write');process.exit(0);}},10);
`
  const config = await fixture('', '', `spawn(process.execPath, ['-e', ${JSON.stringify(holder)}, process.cwd()], {stdio:['ignore','ignore',2]});`)
  const runtime = await startEditor({ ...config, stopTimeoutMs: 60_000 }, await temp(), 'late-pipe' as SessionId, 'http://127.0.0.1:5298')
  const child = children.at(-1)!
  let finished = false
  const stopping = runtime.dispose()
  void stopping.then(() => { finished = true }, () => { finished = true })
  try {
    await expect.poll(async () => readFile(join(config.editorRoot, 'pipe-holder.txt'), 'utf8')).toBe('ready')
    await expect.poll(() => child.child.exitCode).toBe(0)
    expect(finished).toBe(false)
    expect(child.isClosed).toBe(false)
  } finally { await writeFile(join(config.editorRoot, 'release-pipe.txt'), 'release') }
  await stopping
  expect(child.isClosed).toBe(true)
})

it('retains a transport completion failure and leaves HTTP open after a successful save drain', async () => {
  const config = await fixture('', '', '', "throw new Error('native stream tail failed');")
  const runtime = await startEditor(config, await temp(), 'transport-failure' as SessionId, 'http://127.0.0.1:5298')
  await runtime.drainForShutdown()
  const stopping = runtime.dispose()
  await expect(stopping).rejects.toThrow('native stream tail failed')
  expect(runtime.dispose()).toBe(stopping)
  expect(children.at(-1)!.isClosed).toBe(false)
  expect((await fetch(runtime.workspace.editorUrl)).status).toBe(200)
  await expect(readFile(join(config.editorRoot, 'closed.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
})
