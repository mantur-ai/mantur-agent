/** Real Host/editor owner and MCP transport ordering; editor jobs/browser are separate integration evidence. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ChildProcess } from 'node:child_process'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Llm, { createUserMessage } from '@deepseek-ai/dsh-llm'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import Agents from '@deepseek-ai/dsh-agent'
import Loop from '@deepseek-ai/dsh-agent-loop'
import Persistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import Registry from '@deepseek-ai/dsh-typert-registry'
import Gateway from '@deepseek-ai/dsh-api-gateway'
import Attachments from '@deepseek-ai/dsh-attachment-local'
import Editing from '@deepseek-ai/dsh-client-ui-mantur-editing'
import { expect, it, vi } from 'vitest'
import { MockAdapter, toolCallResponse, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { startExpiryFixture } from '../../../mcp/mcp-client/tests/http-expiry-fixture.ts'
import { createHostUpdateShutdown } from '../src/update-shutdown.ts'

const childClosures = vi.hoisted(() => [] as Array<{ closed: boolean; child: ChildProcess }>)
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, spawn: (...args: Parameters<typeof actual.spawn>) => {
    const child = actual.spawn(...args)
    const state = { closed: false, child }
    child.once('close', () => { state.closed = true })
    childClosures.push(state)
    return child
  } }
})

it('retains a real AgentLoop MCP signal through image storage, editor drain and owned child close', async () => {
  const root = await mkdtemp(join(tmpdir(), 'combined-editing-'))
  const ctx = new Context()
  const fixture = await startExpiryFixture()
  const reply = Promise.withResolvers<undefined>()
  const save = Promise.withResolvers<undefined>()
  const saving = Promise.withResolvers<undefined>()
  fixture.holdCalls(reply.promise)
  fixture.replyWithImage()
  const editorRoot = join(root, 'editor')
  const viteRoot = join(editorRoot, 'node_modules/vite')
  await mkdir(join(viteRoot, 'dist/node'), { recursive: true })
  await writeFile(join(viteRoot, 'package.json'), '{"type":"module"}')
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='
  await writeFile(join(viteRoot, 'dist/node/index.js'), `
import { createServer as http, request } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
export async function createServer() {
  const responses = new Set();
  const httpServer = http((incoming, outgoing) => {
    const completion = new Promise(resolve => outgoing.once('close', resolve));
    responses.add(completion);
    completion.then(() => responses.delete(completion));
    const upstream = request(${JSON.stringify(fixture.url)}, { method: incoming.method, headers: incoming.headers }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString().replaceAll('AQ==', ${JSON.stringify(png)});
        const headers = { ...response.headers }; delete headers['content-length'];
        outgoing.writeHead(response.statusCode, headers).end(body);
      });
    });
    upstream.on('error', error => outgoing.writeHead(502).end(error.message));
    incoming.pipe(upstream);
  });
  httpServer.manturShutdown = { async stopForShutdown() {
    await writeFile('drain-entered', '1');
    await new Promise(resolve => { const timer = setInterval(() => {
      if (existsSync('release-editor')) { clearInterval(timer); resolve(); }
    }, 10); });
    await writeFile('saved-before-close', '1');
  }, async finishTransportShutdown() {
    await Promise.all([...responses]);
    await writeFile('transport-closed', '1');
  } };
  return { config: { server: {}, inlineConfig: { server: {} } }, httpServer,
    close: async () => {
      await new Promise(resolve => { httpServer.close(resolve); httpServer.closeAllConnections(); });
      await writeFile('editor-closed', '1');
    } };
}
`)
  let preparing: Promise<unknown> | undefined
  let preparationResult: Promise<PromiseSettledResult<unknown>[]> | undefined
  let signal: AbortSignal | undefined
  let savedImages: Awaited<ReturnType<Attachments['saveImages']>> = []
  try {
    ctx.baseUrl = new URL('../', import.meta.url).href
    for (const plugin of [Loader, Llm, Sessions, Projections, SystemPrompt, Tools, Agents, Registry, Gateway]) await ctx.plugin(plugin)
    await ctx.plugin(Persistence, { root: join(root, 'sessions'), compression: 'none' })
    await ctx.plugin(Attachments, { dshHome: join(root, 'home') })
    await ctx.plugin(Loop, { agents: [] })
    const adapter = new MockAdapter([toolCallResponse('combined-mcp', 'mcp__mantur_cut__mutate', {}), textResponse('saved')])
    const resolveModel = adapter.resolveModel.bind(adapter)
    vi.spyOn(adapter, 'resolveModel').mockImplementation(async (provider, model) => ({ ...await resolveModel(provider, model), inputModalities: ['text', 'image'] }))
    ctx.effect(() => ctx.llm.registerAdapter(['mock'], adapter))
    ctx.provide('webServer', { port: 5298, stopForShutdown: async () => {} })
    await ctx.plugin(Editing, { runtimeMode: 'development', editorRoot, nodeExecutable: process.execPath,
      startupTimeoutMs: 10000, stopTimeoutMs: 10000, toolCallTimeoutMs: 10000 })
    const handle = await ctx.agents.create({ sessionId: SessionId('combined'), meta: { cwd: root }, agentOptions: { provider: 'mock', model: 'mock' } })
    const workspace = await ctx.manturEditing.open(handle.agent, 'http://127.0.0.1:5298')
    expect(childClosures.map(state => state.closed)).toEqual([false])
    ctx.on('tools/execute', async (exec, next) => {
      if (exec.name === 'mcp__mantur_cut__mutate') signal = exec.signal
      return next()
    })
    const saveImages = ctx.attachments.saveImages.bind(ctx.attachments)
    vi.spyOn(ctx.attachments, 'saveImages').mockImplementation(async (...args) => {
      saving.resolve(undefined)
      await save.promise
      savedImages = await saveImages(...args)
      return savedImages
    })
    const quiesce = vi.spyOn(ctx.agentLoop, 'quiesceForShutdown')
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Run the local fixture mutation.' }], source: { kind: 'user' } }))
    await expect.poll(() => fixture.calls.length).toBe(1)
    expect(signal?.aborted).toBe(false)
    const coordinator = createHostUpdateShutdown(ctx)
    preparing = coordinator.prepare()
    preparationResult = Promise.allSettled([preparing])
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(signal?.aborted).toBe(false)
    expect(quiesce).not.toHaveBeenCalled()
    await expect(ctx.manturEditing.open(handle.agent, 'http://127.0.0.1:5298')).rejects.toThrow('shutting down')
    reply.resolve(undefined)
    await saving.promise
    expect(signal?.aborted).toBe(false)
    await expect(readFile(join(editorRoot, 'drain-entered'))).rejects.toMatchObject({ code: 'ENOENT' })
    save.resolve(undefined)
    await expect.poll(async () => readFile(join(editorRoot, 'drain-entered'), 'utf8').catch(() => '')).toBe('1')
    expect(signal?.aborted).toBe(false)
    expect(quiesce).not.toHaveBeenCalled()
    expect(childClosures.map(state => state.closed)).toEqual([false])
    expect(savedImages).toHaveLength(1)
    expect((await ctx.attachments.readImage(savedImages[0]!)).data.byteLength).toBeGreaterThan(0)
    await handle.agent.whenIdle()
    const before = handle.agent.session.snapshotEvents()
    expect(before.some(event => event.type === 'tool/result' && event.data.message.content[0].isError === false)).toBe(true)
    await writeFile(join(editorRoot, 'release-editor'), '1')
    await preparing
    expect(childClosures.map(state => state.closed)).toEqual([true])
    expect(await readFile(join(editorRoot, 'saved-before-close'), 'utf8')).toBe('1')
    expect(await readFile(join(editorRoot, 'transport-closed'), 'utf8')).toBe('1')
    expect(await readFile(join(editorRoot, 'editor-closed'), 'utf8')).toBe('1')
    await expect(fetch(workspace.editorUrl)).rejects.toThrow()
    const reader = await ctx.sessionPersistence.open(handle.agent.id, 'read')
    try { expect(await reader.read()).toEqual(before) } finally { await reader.close() }
  } finally {
    reply.resolve(undefined); save.resolve(undefined)
    await writeFile(join(editorRoot, 'release-editor'), '1')
    await preparationResult
    vi.restoreAllMocks()
    try { await ctx.fiber.dispose() } finally {
      // Failed fixtures retain their owner; only this test's captured child is force-cleaned.
      for (const state of childClosures) if (!state.closed) {
        const closed = new Promise<void>((resolve) => { state.child.once('close', () => { resolve() }) })
        state.child.kill('SIGKILL')
        await closed
      }
      await fixture.close()
      await rm(root, { recursive: true, force: true })
    }
  }
}, 30000)
