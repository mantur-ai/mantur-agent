/** Logged editing guidance through the shipped Mantur Loader and native MCP client. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-client-ui-mantur-editing'
import type {} from '@deepseek-ai/dsh-agent-presets'
import { startHttpMcpFixture } from '../../../packages/mcp/mcp-client/tests/http-fixture.ts'
import { fixtureUserPrompts, launchWebScaffold, readPersistedEvents, webSnapshotMode, type WebScaffold } from './scaffold.ts'

const fixture = fileURLToPath(new URL('../../../snapshots/web/mantur-editing-workflow/session.jsonl', import.meta.url))
const manturOverlay = fileURLToPath(new URL('../../../packages/bundle/mantur-app/cordis.patch.yml', import.meta.url))
const anchor = fileURLToPath(new URL('../../../packages/bundle/mantur-app/package.json', import.meta.url))

// Only the external editor and model are fixtures; the Host launch, MCP discovery,
// Agent scope, request assembly, and persisted log run their shipping implementations.
it.skipIf(webSnapshotMode() === 'record')('records native workbench guidance in the editing Agent request', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mantur-editing-workflow-'))
  let mcp: Awaited<ReturnType<typeof startHttpMcpFixture>> | undefined
  let scaffold: WebScaffold | undefined
  try {
    mcp = await startHttpMcpFixture()
    const editorRoot = join(root, 'editor')
    const viteRoot = join(editorRoot, 'node_modules/vite')
    await mkdir(join(viteRoot, 'dist/node'), { recursive: true })
    await writeFile(join(viteRoot, 'package.json'), '{"type":"module"}\n')
    await writeFile(join(viteRoot, 'dist/node/index.js'), `
import { createServer as createHttpServer, request } from 'node:http';
export async function createServer() {
  const httpServer = createHttpServer((incoming, outgoing) => {
    const upstream = request(${JSON.stringify(mcp.url)}, { method: incoming.method, headers: incoming.headers }, response => {
      outgoing.writeHead(response.statusCode, response.headers);
      response.pipe(outgoing);
    });
    upstream.on('error', error => { outgoing.writeHead(502).end(error.message); });
    incoming.pipe(upstream);
  });
  return { config: { server: {}, inlineConfig: { server: {} } }, httpServer,
    close: () => new Promise(resolve => { httpServer.close(resolve); httpServer.closeAllConnections(); }) };
}
`)
    const overlay = join(root, 'editing.patch.yml')
    await writeFile(overlay, `${await readFile(manturOverlay, 'utf8')}\n- id: ui-mantur-editing\n  disabled: false\n  config: ${JSON.stringify({
      editorRoot, nodeExecutable: process.execPath, startupTimeoutMs: 10000, stopTimeoutMs: 2000, toolCallTimeoutMs: 5000,
    })}\n`)
    scaffold = await launchWebScaffold({ extraOverlayPath: overlay, extraInstallAnchors: [anchor], replayFixture: fixture })
    const handle = await scaffold.ctx.agents.create({
      sessionId: SessionId('mantur-editing-workflow'),
      meta: { cwd: scaffold.workspaceCwd },
      agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      setup: agentCtx => scaffold!.ctx.agentPresets.mount(agentCtx).then(() => undefined),
    })
    // Keep this Session registered through scaffold.close(), which compares its entire recorded log.
    const before = await scaffold.ctx.systemPrompt.assemble({ scope: handle.agent })
    expect(before.sections.some(section => section.name === 'mantur:editing-workflow')).toBe(false)
    await scaffold.ctx.manturEditing.open(handle.agent, scaffold.baseUrl)
    const [task] = fixtureUserPrompts(await readFile(fixture, 'utf8'))
    if (task === undefined) throw new Error('Editing snapshot has no user task')
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: task }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()
    const events = await readPersistedEvents(scaffold, handle.agent.id)
    const header = events.find(event => event.type === 'request/header')
    if (header?.type !== 'request/header') throw new Error('Editing replay did not log a request header')
    expect(header.data.header.system).toContain('Mantur Cut editing workflow')
    expect(header.data.header.tools?.some(tool => tool.name === 'mcp__mantur_cut__ping')).toBe(true)
    expect(mcp.authorization.length).toBeGreaterThan(0)
    expect(mcp.authorization.every(value => value?.startsWith('Bearer '))).toBe(true)
  } finally {
    try { await scaffold?.close() }
    finally {
      try { await mcp?.close() }
      finally { await rm(root, { recursive: true, force: true }) }
    }
  }
})
