/** Shutdown admission and process-local activation history on real Cordis services. */
import { expect, it, vi } from 'vitest'
import Runner, { hasStartedDynamicPrograms } from '../src/index.ts'
import { AGENT_A, CLIENT_CODE, setup } from './helpers.ts'

function define(runner: Runner, code: { host?: string; client?: string }) {
  return runner.define({ sessionId: AGENT_A.id, plugin: { kind: 'new', idPrefix: 'stop' }, name: 'shutdown', purpose: 'lifecycle fixture', code })
}

it('cancels approval without activation and closes all execution admission', async () => {
  const { ctx, runner } = await setup()
  const definition = define(runner, { client: CLIENT_CODE })
  const response = await runner.run(AGENT_A, definition.pluginId, definition.packageId, 'run')
  expect(response).toMatchObject({ ok: true, status: 'awaiting-approval' })
  try {
    expect(runner.hasStartedPrograms).toBe(false)
    const stopping = runner.stopForShutdown()
    expect(runner.stopForShutdown()).toBe(stopping)
    await stopping
    expect(runner.inventory()[0]?.latestRun?.status).toBe('cancelled')
    expect(hasStartedDynamicPrograms(ctx)).toBe(false)
    expect(() => define(runner, { client: CLIENT_CODE })).toThrow('stopping for shutdown')
    await expect(runner.run(AGENT_A, definition.pluginId, definition.packageId, 'run')).rejects.toThrow('stopping for shutdown')
    await expect(runner.runHostHalf(AGENT_A, definition.pluginId, definition.packageId, 'run', null, false)).rejects.toThrow('stopping for shutdown')
  } finally { await ctx.fiber.dispose() }
})

it.each([false, true])('waits for an admitted handler before retraction, including handler rejection: %s', async (reject) => {
  const { ctx, runner } = await setup()
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const writes: string[] = []
  ctx.provide('shutdownProbe', { async hold() { entered.resolve(undefined); await release.promise; writes.push('saved'); if (reject) throw new Error('handler failed'); return 42 } })
  const definition = define(runner, { host: `
    return { inject: ['shutdownProbe'], apply(ctx) { harness.handle('hold', () => ctx.shutdownProbe.hold()) } }` })
  const activation = await runner.run(AGENT_A, definition.pluginId, definition.packageId, 'run')
  if (!activation.ok || !('pluginRunId' in activation)) throw new Error('fixture activation failed')
  const running = runner.invoke(definition.pluginId, activation.pluginRunId, 'hold', null)
  await entered.promise
  const stopping = runner.stopForShutdown()
  let stopped = false
  void stopping.then(() => { stopped = true })
  try {
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(stopped).toBe(false)
    expect(runner.inventory()[0]?.activeRun).toBeDefined()
    await expect(runner.invoke(definition.pluginId, activation.pluginRunId, 'hold', null)).rejects.toThrow('stopping for shutdown')
    expect(() => runner.getClientCode(AGENT_A, definition.pluginId, activation.pluginRunId)).toThrow('stopping for shutdown')
    release.resolve(undefined)
    expect(await running).toMatchObject({ ok: !reject })
    await stopping
    expect(writes).toEqual(['saved'])
    expect(runner.inventory()[0]?.activeRun).toBeUndefined()
    expect(runner.hasStartedPrograms).toBe(true)
  } finally { release.resolve(undefined); await Promise.allSettled([running, stopping]); await ctx.fiber.dispose() }
})

it('retains activation history through stop, undefine, removal and scoped replacement', async () => {
  const { ctx, runner } = await setup()
  const foreign = await setup()
  try {
    const definition = define(runner, { host: 'return { apply() {} }' })
    await runner.run(AGENT_A, definition.pluginId, definition.packageId, 'run')
    await runner.stop(AGENT_A, definition.pluginId)
    await runner.undefine(AGENT_A, definition.pluginId)
    await [...ctx.registry.get(Runner)!.fibers][0]!.dispose()
    expect(hasStartedDynamicPrograms(ctx)).toBe(true)
    const scoped = ctx.isolate('dynamicCordisRunner')
    await scoped.plugin(Runner, {})
    expect(scoped.dynamicCordisRunner.hasStartedPrograms).toBe(true)
    expect(foreign.runner.hasStartedPrograms).toBe(false)
  } finally { await Promise.all([ctx.fiber.dispose(), foreign.ctx.fiber.dispose()]) }
})

it('retains retraction failures for repeated shutdown requests', async () => {
  const { ctx, runner } = await setup()
  const definition = define(runner, { host: 'return { apply() {} }' })
  await runner.run(AGENT_A, definition.pluginId, definition.packageId, 'run')
  const fiber = runner.snapshot(AGENT_A)[0]!.activeRun!.fiber!
  const error = new Error('owned retraction failed')
  const spy = vi.spyOn(fiber, 'dispose').mockRejectedValue(error)
  try {
    const stopping = runner.stopForShutdown()
    await expect(stopping).rejects.toMatchObject({ errors: [error] })
    expect(runner.stopForShutdown()).toBe(stopping)
  } finally { spy.mockRestore(); await fiber.dispose(); await ctx.fiber.dispose() }
})

it('joins an accepted activation before retracting its newly published run', async () => {
  const { ctx, runner } = await setup()
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  ctx.provide('shutdownProbe', { async hold() { entered.resolve(undefined); await release.promise } })
  const definition = define(runner, { host: `
    return { inject: ['shutdownProbe'], async apply(ctx) { await ctx.shutdownProbe.hold() } }` })
  const running = runner.run(AGENT_A, definition.pluginId, definition.packageId, 'run')
  await entered.promise
  expect(runner.hasStartedPrograms).toBe(true)
  const stopping = runner.stopForShutdown()
  let stopped = false
  void stopping.then(() => { stopped = true })
  try {
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(stopped).toBe(false)
    release.resolve(undefined)
    expect(await running).toMatchObject({ ok: true })
    await stopping
    expect(runner.inventory()[0]?.activeRun).toBeUndefined()
  } finally { release.resolve(undefined); await Promise.allSettled([running, stopping]); await ctx.fiber.dispose() }
})
