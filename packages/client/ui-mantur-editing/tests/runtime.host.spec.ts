import { mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { editingDirectories, startEditor, type EditorRuntime, type RuntimeConfig } from '../src/runtime.ts'

const roots: string[] = []
const runtimes: EditorRuntime[] = []
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map(runtime => runtime.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
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

async function fixture(listen: string): Promise<RuntimeConfig> {
  const editorRoot = await temp()
  const vite = join(editorRoot, 'node_modules/vite/dist/node')
  await mkdir(vite, { recursive: true })
  await writeFile(join(editorRoot, 'node_modules/vite/package.json'), '{"type":"module"}')
  await writeFile(join(vite, 'index.js'), `import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
export async function createServer() {
  await writeFile('project-root.txt', process.env.MANTUR_CUT_PROJECT_DIR);
  const httpServer = createHttpServer();
  const listen = httpServer.listen.bind(httpServer);
  httpServer.listen = async (...args) => { ${listen} listen(...args); };
  return { config: { server: {}, inlineConfig: { server: {} } }, httpServer, close: async () => {
    if (httpServer.listening) await new Promise(resolve => httpServer.close(resolve));
    await writeFile('closed.txt', 'drained');
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
