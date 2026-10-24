/** Fixture cleanup waits for effects and real child exit before deleting scripts. */
import { existsSync, rmSync } from 'node:fs'
import { once } from 'node:events'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { describe, expect, it, vi } from 'vitest'
import { HookCoverageFixture } from './coverage-fixture.ts'

describe('hook coverage fixture ownership', () => {
  it('retains directories while a context disposer is pending', async () => {
    const fixture = new HookCoverageFixture()
    const directory = fixture.directory('dsh-hook-dispose-')
    const entered = Promise.withResolvers<'entered'>()
    const release = Promise.withResolvers<undefined>()
    const ctx = fixture.context()
    const descriptor = Object.getOwnPropertyDescriptor(ctx.logger, 'error')
    const unrelated = new HookCoverageFixture()
    const unrelatedContext = unrelated.context()
    ctx.effect(() => async () => {
      entered.resolve('entered')
      await release.promise
    })
    const disposal = fixture.dispose()
    try {
      expect(await Promise.race([entered.promise, disposal.then(() => 'early')])).toBe('entered')
      expect(existsSync(directory)).toBe(true)
      unrelatedContext.logger.error(new Error('independent root error'))
    } finally {
      release.resolve(undefined)
      try { await disposal } finally { await unrelated.dispose() }
    }
    expect(Object.getOwnPropertyDescriptor(ctx.logger, 'error')).toEqual(descriptor)
    expect(existsSync(directory)).toBe(false)
  })

  it.each(['sync', 'async'] as const)('retains directories after a real %s effect failure and waits for another root', async (mode) => {
    const fixture = new HookCoverageFixture()
    const directories = [fixture.directory('dsh-hook-failed-'), fixture.directory('dsh-hook-waiting-')]
    const failed = fixture.context()
    const waiting = fixture.context()
    const failure = new Error('effect cleanup failed')
    const reported = Promise.withResolvers<unknown>()
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const logger = failed.logger
    const errorLog = vi.spyOn(logger, 'error').mockImplementation((reason: unknown) => { reported.resolve(reason) })
    const descriptor = Object.getOwnPropertyDescriptor(logger, 'error')
    const waitingDescriptor = Object.getOwnPropertyDescriptor(waiting.logger, 'error')
    let siblingFinished = false
    let waitingFinished = false
    let settled = false
    await failed.plugin((ctx) => {
      ctx.effect(() => mode === 'sync'
        ? () => { throw failure }
        : () => Promise.reject(failure))
      ctx.effect(() => () => { siblingFinished = true })
    })
    waiting.effect(() => async () => {
      entered.resolve(undefined)
      await release.promise
      waitingFinished = true
    })
    const result = fixture.dispose().then(
      () => { settled = true; return { kind: 'resolved' as const } },
      (error: unknown) => { settled = true; return { kind: 'rejected' as const, error } },
    )
    try {
      expect(await reported.promise).toBe(failure)
      await entered.promise
      expect(settled).toBe(false)
      expect(waitingFinished).toBe(false)
      for (const directory of directories) expect(existsSync(directory)).toBe(true)
      release.resolve(undefined)
      const outcome = await result
      if (outcome.kind !== 'rejected' || !(outcome.error instanceof AggregateError)) {
        throw new Error('Fixture cleanup must reject with AggregateError')
      }
      expect(outcome.error.errors).toHaveLength(1)
      expect(outcome.error.errors[0]).toBe(failure)
      expect(waitingFinished).toBe(true)
      expect(siblingFinished).toBe(true)
      expect(errorLog).toHaveBeenCalledWith(failure)
      expect(Object.getOwnPropertyDescriptor(logger, 'error')).toEqual(descriptor)
      expect(Object.getOwnPropertyDescriptor(waiting.logger, 'error')).toEqual(waitingDescriptor)
      await expect(fixture.dispose()).rejects.toMatchObject({ errors: [failure] })
      for (const directory of directories) expect(existsSync(directory)).toBe(true)
    } finally {
      release.resolve(undefined)
      await result
      errorLog.mockRestore()
      for (const directory of directories) rmSync(directory, { recursive: true, force: true })
    }
  })

  it('reports a failing logger without interrupting the remaining effects', async () => {
    const fixture = new HookCoverageFixture()
    const directory = fixture.directory('dsh-hook-logger-')
    const ctx = fixture.context()
    const failure = new Error('effect cleanup failed')
    const reporterFailure = new Error('logger failed')
    const errorLog = vi.spyOn(ctx.logger, 'error').mockImplementation(() => { throw reporterFailure })
    let siblingFinished = false
    ctx.effect(() => () => { throw failure })
    ctx.effect(() => () => { siblingFinished = true })
    try {
      await expect(fixture.dispose()).rejects.toMatchObject({ errors: [failure, reporterFailure] })
      expect(siblingFinished).toBe(true)
      expect(existsSync(directory)).toBe(true)
      expect(ctx.logger.error).toBe(errorLog)
    } finally {
      errorLog.mockRestore()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it.each([false, true])('disposes an in-memory agent without durable checkpoints (already disposed: %s)', async (alreadyDisposed) => {
    const fixture = new HookCoverageFixture()
    const directory = fixture.directory('dsh-hook-memory-')
    const ctx = fixture.context()
    try {
      await mountAgentLoopTestDependencies(ctx)
      await ctx.plugin(SessionProjectionRegistry)
      const owner = ctx.plugin(AgentLoop, { agents: [] })
      fixture.agentOwner(ctx, () => owner.dispose())
      await owner
      ctx.llm.registerAdapter(['mock'], new MockAdapter([textResponse('done')]))
      const handle = await ctx.agents.create({ sessionId: SessionId('fixture-memory'), agentOptions: { provider: 'mock', model: 'mock' } })
      handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
      await handle.agent.whenIdle()
      if (alreadyDisposed) await handle.dispose()
      await fixture.dispose()
      expect(existsSync(directory)).toBe(false)
    } finally {
      await fixture.dispose()
    }
  })

  it('flushes the real agent writer before root disposal can close persistence', async () => {
    const fixture = new HookCoverageFixture()
    const directory = fixture.directory('dsh-hook-writer-')
    const ctx = fixture.context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(JsonlSessionPersistence, { root: directory })
    const agentOwner = ctx.plugin(AgentLoop, { agents: [] })
    fixture.agentOwner(ctx, () => agentOwner.dispose())
    await agentOwner
    ctx.llm.registerAdapter(['mock'], new MockAdapter([textResponse('done')]))
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const producerEntered = Promise.withResolvers<undefined>()
    const releaseProducer = Promise.withResolvers<undefined>()
    let flushStarted = false
    let rootStarted = false
    let closeCalls = 0
    let flushed = false
    const create = ctx.sessionPersistence.create.bind(ctx.sessionPersistence)
    const createSpy = vi.spyOn(ctx.sessionPersistence, 'create').mockImplementation(async (...args) => {
      const writer = await create(...args)
      const flush = writer.flush.bind(writer)
      const close = writer.close.bind(writer)
      vi.spyOn(writer, 'flush').mockImplementation(async (...options) => {
        flushStarted = true
        entered.resolve(undefined)
        await release.promise
        await flush(...options)
        flushed = true
      })
      vi.spyOn(writer, 'close').mockImplementation((...options) => {
        closeCalls++
        return close(...options)
      })
      return writer
    })
    const handle = await ctx.agents.create({ sessionId: SessionId('fixture-writer'), agentOptions: { provider: 'mock', model: 'mock' } })
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()
    fixture.hook(ctx, ctx.effect(() => async () => {
      producerEntered.resolve(undefined)
      await releaseProducer.promise
    }))
    ctx.effect(() => () => { rootStarted = true })
    const result = fixture.dispose().then(() => ({ kind: 'resolved' }), (error: unknown) => ({ kind: 'rejected', error }))
    try {
      await producerEntered.promise
      expect(rootStarted).toBe(false)
      expect(flushStarted).toBe(false)
      releaseProducer.resolve(undefined)
      await entered.promise
      expect(rootStarted).toBe(false)
      expect(closeCalls).toBe(0)
      expect(existsSync(directory)).toBe(true)
      release.resolve(undefined)
      expect(await result).toEqual({ kind: 'resolved' })
      expect(flushed).toBe(true)
      expect(closeCalls).toBe(1)
      expect(rootStarted).toBe(true)
      expect(existsSync(directory)).toBe(false)
    } finally {
      releaseProducer.resolve(undefined)
      release.resolve(undefined)
      await result
      createSpy.mockRestore()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('joins a live child and removes its host-exit listener when the body fails', async () => {
    const fixture = new HookCoverageFixture()
    const directory = fixture.directory('dsh-hook-child-')
    const listeners = process.listenerCount('exit')
    const ctx = fixture.context()
    let pid: number | undefined
    const body = async (): Promise<void> => {
      try {
        await ctx.plugin(LocalSubprocessRuntime)
        const child = ctx.subprocess.spawn({
          argv: [process.execPath, '-e', 'process.stdin.resume(); process.stdout.write("ready")'],
          cwd: directory,
          graceMs: 100,
          stdio: { stdin: 'pipe', stdout: 'pipe', stderr: { maxBytes: 4096 } },
        })
        pid = child.pid
        expect(child.stdout).toBeDefined()
        await once(child.stdout!, 'data')
        expect(process.listenerCount('exit')).toBe(listeners + 1)
        throw new Error('body failed')
      } finally {
        await fixture.dispose()
      }
    }
    await expect(body()).rejects.toThrow('body failed')
    expect(pid).toBeDefined()
    expect(() => process.kill(pid!, 0)).toThrow(expect.objectContaining({ code: 'ESRCH' }))
    expect(process.listenerCount('exit')).toBe(listeners)
    expect(existsSync(directory)).toBe(false)
  })
})
