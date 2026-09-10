/** A stopped MCP connection records refusal without sending a remote mutation. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { connectMcpServer, type ConnectionHandle } from '@deepseek-ai/dsh-mcp-client'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent-presets'
import { expect, it } from 'vitest'
import { startExpiryFixture } from '../../../packages/mcp/mcp-client/tests/http-expiry-fixture.ts'
import { fixtureUserPrompts, launchWebScaffold, readPersistedEvents, webSnapshotMode, type WebScaffold } from './scaffold.ts'

const root = fileURLToPath(new URL('../../../snapshots/web/mcp-shutdown/', import.meta.url))
const anchor = fileURLToPath(new URL('../../../packages/mcp/mcp-client/package.json', import.meta.url))

it.skipIf(webSnapshotMode() === 'record')('records an MCP shutdown refusal without sending the tool request', async () => {
  const fixture = await startExpiryFixture()
  let scaffold: WebScaffold | undefined
  let connection: ConnectionHandle | undefined
  try {
    scaffold = await launchWebScaffold({
      extraInstallAnchors: [anchor],
      replayFixture: join(root, 'session.jsonl'), replayOverride: join(root, 'replay.override.json'),
    })
    await scaffold.ctx.plugin({
      name: 'snapshot-owned-mcp', inject: ['tools'],
      async apply(ctx: Context) {
        connection = connectMcpServer(ctx, {
          transport: 'streamable-http', serverName: 'shutdown', url: fixture.url,
          headers: {}, toolCallTimeoutMs: 2000, failOnStartupError: true,
        })
        await connection.ready
      },
    }).await()
    if (connection === undefined) throw new Error('Snapshot connection did not start')
    const handle = await scaffold.ctx.agents.create({
      sessionId: SessionId('mcp-shutdown'), meta: { cwd: scaffold.workspaceCwd },
      agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      setup: agentCtx => scaffold!.ctx.agentPresets.mount(agentCtx).then(() => undefined),
    })
    await connection.stopAccepting()
    const [task] = fixtureUserPrompts(await readFile(join(root, 'session.jsonl'), 'utf8'))
    if (task === undefined) throw new Error('Shutdown snapshot has no user task')
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: task }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()
    const events = await readPersistedEvents(scaffold, handle.agent.id)
    const results = events.filter(event => event.type === 'tool/result')
    expect(results).toHaveLength(1)
    expect(JSON.stringify(results[0]!.data)).toContain('shutting down; this call was not accepted')
    expect(fixture.calls).toEqual([])
    expect(fixture.initializeRequests).toEqual([undefined])
    await connection.dispose()
  } finally {
    try { await scaffold?.close() }
    finally { await fixture.close() }
  }
})
