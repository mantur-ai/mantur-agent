import { Context } from '@deepseek-ai/cordis'
import { createScope, scopeOf } from '@deepseek-ai/dsh-scope'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, expect, it, vi } from 'vitest'
import ManturEditing, { type Config } from '../src/index.ts'

const harness = vi.hoisted(() => ({ start: vi.fn(), scopes: [] as unknown[], stopped: [] as ReturnType<typeof vi.fn>[] }))
vi.mock('../src/runtime.ts', () => ({ startEditor: harness.start }))
vi.mock('@deepseek-ai/dsh-mcp-client', () => ({
  name: 'mcp-client', Config: undefined, inject: [],
  async apply(ctx: Context) {
    harness.scopes.push(scopeOf(ctx))
  },
}))
const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  harness.start.mockReset(); harness.scopes.length = 0; harness.stopped.length = 0
})
const config: Config = { editorRoot: '/editor', nodeExecutable: '/node', startupTimeoutMs: 1000, stopTimeoutMs: 1000, toolCallTimeoutMs: 1000 }
async function setup() {
  const ctx = new Context()
  contexts.push(ctx)
  ctx.provide('typert', {} as never)
  ctx.provide('tools', {} as never)
  ctx.provide('webServer', { port: 5298 } as never)
  harness.start.mockImplementation(async (_config: Config, cwd: string, id: SessionId) => {
    const dispose = vi.fn(async () => {})
    harness.stopped.push(dispose)
    return { workspace: { editorUrl: 'http://127.0.0.1:5300/', directory: `${cwd}/${id}` }, token: 'host-secret', dispose, assertRunning() {} }
  })
  const fiber = ctx.plugin(ManturEditing, config)
  await fiber.await()
  const makeAgent = (id: string) => {
    const scope = createScope(ctx, {})
    return { agent: { id: id as SessionId, ctx: scope.ctx, session: { header: { cwd: `/project-${id}` } } } as Agent, scope }
  }
  return { ctx, fiber, makeAgent }
}

it('coalesces repeated opens and binds different Sessions to different tool scopes', async () => {
  const { ctx, fiber, makeAgent } = await setup()
  const a = makeAgent('a'); const b = makeAgent('b')
  const values = await Promise.all([
    ctx.manturEditing.open(a.agent, 'http://127.0.0.1:5298'),
    ctx.manturEditing.open(a.agent, 'http://127.0.0.1:5298'),
    ctx.manturEditing.open(b.agent, 'http://127.0.0.1:5298'),
  ])
  expect(harness.start).toHaveBeenCalledTimes(2)
  expect(values[0]).toEqual(values[1])
  expect(values[0]?.directory).not.toBe(values[2]?.directory)
  expect(harness.scopes).toEqual([scopeOf(a.scope.ctx), scopeOf(b.scope.ctx)])
  expect(harness.scopes).not.toContain(undefined)
  expect(values.every(value => !('token' in value))).toBe(true)
  await a.scope.dispose()
  expect(harness.stopped[0]).toHaveBeenCalledOnce()
  expect(harness.stopped[1]).not.toHaveBeenCalled()
  await fiber.dispose()
  expect(harness.stopped[1]).toHaveBeenCalledOnce()
})

it('rejects a different browser origin before creating directories or tools', async () => {
  const { ctx, makeAgent } = await setup()
  const { agent } = makeAgent('a')
  await expect(ctx.manturEditing.open(agent, 'http://127.0.0.1:9999')).rejects.toThrow('local Mantur origin')
  await expect(ctx.manturEditing.open(agent, 'https://example.com')).rejects.toThrow('local Mantur origin')
  expect(harness.start).not.toHaveBeenCalled()
})

it('lets an explicit retry start again after failure', async () => {
  const { ctx, makeAgent } = await setup()
  const { agent } = makeAgent('a')
  harness.start.mockRejectedValueOnce(new Error('Disk is unavailable'))
  await expect(ctx.manturEditing.open(agent, 'http://127.0.0.1:5298')).rejects.toThrow('Disk is unavailable')
  await expect(ctx.manturEditing.open(agent, 'http://127.0.0.1:5298')).resolves.toMatchObject({ directory: '/project-a/a' })
})
