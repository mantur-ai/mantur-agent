/** Recorded failed call, expired-tool removal, and explicit post-reconnect call. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent-presets'
import { startExpiryFixture } from '../../../packages/mcp/mcp-client/tests/http-expiry-fixture.ts'
import { fixtureUserPrompts, launchWebScaffold, readPersistedEvents, webSnapshotMode, type WebScaffold } from './scaffold.ts'

const root = fileURLToPath(new URL('../../../snapshots/web/mcp-http-recovery/', import.meta.url))
const anchor = fileURLToPath(new URL('../../../packages/mcp/mcp-client/package.json', import.meta.url))
it.skipIf(webSnapshotMode() === 'record')('records failure without replaying the call during HTTP recovery', async () => {
  const work = await mkdtemp(join(tmpdir(), 'dsh-mcp-http-replay-'))
  let fixture: Awaited<ReturnType<typeof startExpiryFixture>> | undefined
  let scaffold: WebScaffold | undefined
  const resume: PromiseWithResolvers<void> = Promise.withResolvers()
  try {
    fixture = await startExpiryFixture()
    const overlay = join(work, 'mcp.patch.yml')
    await writeFile(overlay, `- insert:\n    - id: expiry-mcp\n      name: '@deepseek-ai/dsh-mcp-client'\n      config: ${JSON.stringify({
      transport: 'streamable-http', serverName: 'expiry', url: fixture.url,
      toolCallTimeoutMs: 2000, failOnStartupError: true,
      reconnect: { initialDelayMs: 5, maxDelayMs: 20, maxAttempts: 2 },
    })}\n`)
    scaffold = await launchWebScaffold({
      extraOverlayPath: overlay, extraInstallAnchors: [anchor],
      replayFixture: join(root, 'session.jsonl'), replayOverride: join(root, 'replay.override.json'),
    })
    const first = fixture.initialized[0]!.id
    fixture.failures.set(first, 404)
    fixture.holdInitializations(resume.promise)
    const handle = await scaffold.ctx.agents.create({
      sessionId: SessionId('mcp-http-recovery'), meta: { cwd: scaffold.workspaceCwd },
      agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      setup: agentCtx => scaffold!.ctx.agentPresets.mount(agentCtx).then(() => undefined),
    })
    const tasks = fixtureUserPrompts(await readFile(join(root, 'session.jsonl'), 'utf8'))
    expect(tasks).toHaveLength(2)
    const send = async (text: string) => {
      handle.agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
      await handle.agent.whenIdle()
    }
    await send(tasks[0]!)
    expect(fixture.calls).toEqual([first])
    await expect.poll(() => scaffold!.ctx.tools.get('mcp__expiry__mutate')).toBeUndefined()
    await expect.poll(() => fixture!.initializeRequests.length).toBe(2)
    resume.resolve()
    await expect.poll(() => scaffold!.ctx.tools.get('mcp__expiry__mutate')).toBeDefined()
    expect(fixture.calls).toEqual([first])
    await send(tasks[1]!)
    expect(fixture.calls).toEqual([first, fixture.initialized[1]!.id])
    expect(fixture.initializeRequests).toEqual([undefined, undefined])
    const events = await readPersistedEvents(scaffold, handle.agent.id)
    const results = events.filter(event => event.type === 'tool/result')
    expect(results).toHaveLength(2)
    expect(events.filter(event => event.type === 'request/header')).toHaveLength(3)
  } finally {
    resume.resolve()
    try { await scaffold?.close() }
    finally {
      try { await fixture?.close() }
      finally { await rm(work, { recursive: true, force: true }) }
    }
  }
})
