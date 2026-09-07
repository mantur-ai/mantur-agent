/** Command ownership races at the OS allocation boundary, plus real Bash and PTY consumers. */
import { PassThrough } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type { SubprocessHandle, SubprocessOutcome, SubprocessTerminalHandle } from '@deepseek-ai/dsh-subprocess'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import LocalBashExecutor from '@deepseek-ai/dsh-bash-local'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import CommandScopes from '../src/index.ts'
import type { CommandIdentityLease } from '../src/index.ts'

const outcome: SubprocessOutcome = { exitCode: 0, signal: null }
const spec = { argv: [process.execPath, '-e', ''], cwd: process.cwd(), graceMs: 100,
  stdio: { stdin: 'ignore' as const, stdout: { maxBytes: 4096 }, stderr: { maxBytes: 4096 } } }
const terminalSpec = { argv: ['bash', '--noprofile', '--norc'], cwd: process.cwd(), rows: 24, cols: 80, graceMs: 100 }

function lease() {
  const abort = new AbortController()
  const release = vi.fn(async () => {})
  return { abort, release, value: { signal: abort.signal, release,
    environment: { MANTURHUB_IDENTITY_MODE: 'desktop-managed', MANTURHUB_AGENT_AUTH: '/isolated/descriptor.json' } } satisfies CommandIdentityLease }
}

function processHandle() {
  const direct = Promise.withResolvers<SubprocessOutcome>()
  const tree = Promise.withResolvers<boolean>()
  const waiting = Promise.withResolvers<undefined>()
  const handle = { pid: 123, stdin: undefined, stdout: undefined, stderr: undefined, collected: {},
    done: direct.promise, terminate: vi.fn(),
    waitForExit: vi.fn(() => { waiting.resolve(undefined); return tree.promise }) } satisfies SubprocessHandle
  return { handle, direct, tree, waiting }
}

function terminalHandle() {
  const direct = Promise.withResolvers<SubprocessOutcome>()
  const tree = Promise.withResolvers<undefined>()
  const stopping = Promise.withResolvers<undefined>()
  const output = new PassThrough()
  onTestFinished(() => { output.destroy() })
  const handle = { pid: 456, output, done: direct.promise,
    write: vi.fn(async () => {}), inspectForeground: vi.fn(async () => undefined), signalForeground: vi.fn(async () => 456),
    terminate: vi.fn(() => { stopping.resolve(undefined); return tree.promise }) } satisfies SubprocessTerminalHandle
  return { handle, direct, tree, stopping }
}

async function bench(identity: 'none' | 'required' = 'required') {
  const child = processHandle()
  const pty = terminalHandle()
  class ControlledSubprocess extends SubprocessRuntime {
    resolveExecutable = vi.fn(async (command: string) => command)
    spawn = vi.fn(() => child.handle)
    spawnTerminal = vi.fn(async (): Promise<SubprocessTerminalHandle> => pty.handle)
  }
  const ctx = new Context()
  onTestFinished(async () => {
    child.direct.resolve(outcome); child.tree.resolve(true); pty.direct.resolve(outcome); pty.tree.resolve(undefined)
    await ctx.fiber.dispose()
  })
  await ctx.plugin(ControlledSubprocess)
  await ctx.plugin(CommandScopes, { identity })
  const identityLease = lease()
  const provider = { prepare: vi.fn(async (_signal: AbortSignal): Promise<CommandIdentityLease> => identityLease.value) }
  const remove = identity === 'required' ? ctx.commandScopes.register(provider) : undefined
  return { ctx, child, pty, provider, remove, ...identityLease, subprocess: ctx.subprocess as ControlledSubprocess }
}

describe('command scope ownership', () => {
  it.each(['caller', 'timeout'] as const)('rejects %s cancellation during foreground preparation without inventing a process', async (cause) => {
    const b = await bench()
    const prepared = Promise.withResolvers<CommandIdentityLease>()
    const entered = Promise.withResolvers<AbortSignal>()
    onTestFinished(() => { prepared.resolve(b.value) })
    b.provider.prepare.mockImplementation((signal) => { entered.resolve(signal); return prepared.promise })
    await b.ctx.plugin(LocalBashExecutor)
    vi.useFakeTimers()
    onTestFinished(() => { vi.useRealTimers() })
    const caller = new AbortController()
    const run = b.ctx.shell.run(b.ctx.shell.resolve({ command: '', timeoutMs: 10, signal: caller.signal }))
    const signal = await entered.promise
    const rejected = expect(run).rejects.toSatisfy((error: unknown) => error === signal.reason)
    if (cause === 'caller') caller.abort()
    else await vi.advanceTimersByTimeAsync(10)
    expect(signal.aborted).toBe(true)
    prepared.resolve(b.value)
    await rejected
    expect(b.subprocess.spawn).not.toHaveBeenCalled()
    expect(b.release).toHaveBeenCalledOnce()
  })

  it.each(['identity', 'deadline'] as const)('preserves the first %s cancellation cause while cleanup outlasts the deadline', async (first) => {
    const b = await bench()
    const entered = Promise.withResolvers<undefined>()
    const reader = { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) }
    b.subprocess.spawn.mockImplementation(() => {
      entered.resolve(undefined)
      return { ...b.child.handle, collected: { stdout: reader, stderr: reader } }
    })
    await b.ctx.plugin(LocalBashExecutor)
    vi.useFakeTimers()
    onTestFinished(() => { vi.useRealTimers() })
    const run = b.ctx.shell.run(b.ctx.shell.resolve({ command: '', timeoutMs: 10 }))
    await entered.promise
    if (first === 'identity') b.abort.abort()
    await vi.advanceTimersByTimeAsync(10)
    if (first === 'deadline') b.abort.abort()
    b.child.direct.resolve(outcome); b.child.tree.resolve(true)
    expect(await run).toMatchObject({ exitCode: 0, timedOut: first === 'deadline', aborted: first === 'identity' })
  })

  it('refuses duplicate and no-identity registrations and allows idempotent provider removal', async () => {
    const b = await bench()
    expect(() => b.ctx.commandScopes.register(b.provider)).toThrow('cannot be registered')
    await b.remove!()
    await b.remove!()
    await b.ctx.commandScopes.stopAll()
    expect(() => b.ctx.commandScopes.register(b.provider)).toThrow('cannot be registered')
    const plain = await bench('none')
    expect(() => plain.ctx.commandScopes.register(b.provider)).toThrow('cannot be registered')
  })

  it('releases a synchronously rejected allocation and propagates the original error', async () => {
    const b = await bench()
    const failure = new Error('allocation refused')
    b.subprocess.spawn.mockImplementation(() => { throw failure })
    await expect(b.ctx.commandScopes.spawn(spec)).rejects.toBe(failure)
    expect(b.release).toHaveBeenCalledOnce()
    await b.ctx.commandScopes.stopAll()
  })

  it('joins cancellation raised inside synchronous allocation without publishing the late process', async () => {
    const b = await bench()
    b.subprocess.spawn.mockImplementation(() => {
      b.abort.abort()
      b.child.direct.resolve(outcome); b.child.tree.resolve(true)
      return b.child.handle
    })
    await expect(b.ctx.commandScopes.spawn(spec)).rejects.toMatchObject({ name: 'AbortError' })
    expect(b.child.handle.terminate).toHaveBeenCalledOnce()
    expect(b.release).toHaveBeenCalledOnce()
  })

  it('forwards explicit handle termination and tree-wait signals', async () => {
    const b = await bench()
    const handle = await b.ctx.commandScopes.spawn(spec)
    handle.terminate()
    const signal = new AbortController().signal
    const wait = handle.waitForExit(signal)
    expect(b.child.handle.waitForExit).toHaveBeenCalledWith(signal)
    b.child.direct.resolve(outcome); b.child.tree.resolve(true)
    expect(await wait).toBe(true)
    await handle.cleanup
  })

  it('keeps terminal operations on the real handle and cleans up naturally exited terminals', async () => {
    const b = await bench('none')
    const caller = new AbortController()
    const terminal = await b.ctx.commandScopes.spawnTerminal({ ...terminalSpec, signal: caller.signal })
    await terminal.write('input')
    await terminal.inspectForeground()
    expect(await terminal.signalForeground('SIGINT')).toBe(456)
    expect(b.pty.handle.write).toHaveBeenCalledWith('input')
    expect(b.pty.handle.inspectForeground).toHaveBeenCalledOnce()
    b.pty.direct.resolve(outcome)
    await b.pty.stopping.promise
    b.pty.tree.resolve(undefined)
    await terminal.terminate()
    await b.ctx.commandScopes.stopAll()
  })

  it('retains the failure when lifetime cancellation cannot terminate the terminal', async () => {
    const b = await bench()
    vi.mocked(b.pty.handle.terminate).mockRejectedValue(new Error('terminal stop refused'))
    await b.ctx.commandScopes.spawnTerminal(terminalSpec)
    b.abort.abort()
    await expect(b.ctx.commandScopes.stopAll()).rejects.toThrow('cleanup could not be confirmed')
    expect(b.release).not.toHaveBeenCalled()
  })

  it('releases a terminal allocation failure and does not publish a terminal', async () => {
    const b = await bench()
    const failure = new Error('PTY allocation failed')
    b.subprocess.spawnTerminal.mockRejectedValue(failure)
    await expect(b.ctx.commandScopes.spawnTerminal(terminalSpec)).rejects.toBe(failure)
    expect(b.release).toHaveBeenCalledOnce()
  })

  it('does not admit an identity-required command without its provider', async () => {
    const b = await bench()
    await b.remove!()
    await expect(b.ctx.commandScopes.spawn(spec)).rejects.toThrow('Required command identity provider')
    expect(b.subprocess.spawn).not.toHaveBeenCalled()
  })

  it('uses the explicit no-identity policy and keeps the real process handle', async () => {
    const b = await bench('none')
    const handle = await b.ctx.commandScopes.spawn(spec)
    expect(handle.pid).toBe(b.child.handle.pid)
    expect(handle.done).toBe(b.child.direct.promise)
    expect(b.provider.prepare).not.toHaveBeenCalled()
    b.child.direct.resolve(outcome); b.child.tree.resolve(true)
    await handle.cleanup
  })

  it('keeps cancellation active after direct-child exit until the whole tree and release finish', async () => {
    const b = await bench()
    const released = Promise.withResolvers<undefined>()
    const releasing = Promise.withResolvers<undefined>()
    onTestFinished(() => { released.resolve(undefined) })
    b.release.mockImplementation(() => { releasing.resolve(undefined); return released.promise })
    const handle = await b.ctx.commandScopes.spawn({ ...spec, env: { MANTURHUB_IDENTITY_MODE: 'standalone' } })
    expect(b.subprocess.spawn).toHaveBeenCalledWith(expect.objectContaining({ env: b.value.environment }))
    b.child.direct.resolve(outcome)
    await b.child.waiting.promise
    expect(b.release).not.toHaveBeenCalled()
    b.abort.abort()
    expect(b.child.handle.terminate).toHaveBeenCalledOnce()
    b.child.tree.resolve(true)
    await releasing.promise
    let stopped = false
    const stop = b.ctx.commandScopes.stopAll().then(() => { stopped = true })
    await expect(b.ctx.commandScopes.spawn(spec)).rejects.toThrow('admission is closed')
    expect(stopped).toBe(false)
    released.resolve(undefined)
    await stop
    await handle.cleanup
    expect(b.release).toHaveBeenCalledOnce()
  })

  it('freezes synchronously and joins a cancelled preparation that returns its lease late', async () => {
    const b = await bench()
    const prepared = Promise.withResolvers<CommandIdentityLease>()
    const entered = Promise.withResolvers<AbortSignal>()
    onTestFinished(() => { prepared.resolve(b.value) })
    b.provider.prepare.mockImplementation((signal) => { entered.resolve(signal); return prepared.promise })
    const start = b.ctx.commandScopes.spawn(spec)
    const rejected = expect(start).rejects.toMatchObject({ name: 'AbortError' })
    const signal = await entered.promise
    let stopped = false
    const stop = b.ctx.commandScopes.stopAll().then(() => { stopped = true })
    expect(signal.aborted).toBe(true)
    await expect(b.ctx.commandScopes.spawn(spec)).rejects.toThrow('admission is closed')
    expect(stopped).toBe(false)
    prepared.resolve(b.value)
    await rejected
    await stop
    expect(b.subprocess.spawn).not.toHaveBeenCalled()
    expect(b.release).toHaveBeenCalledOnce()
  })

  it('retains unconfirmed whole-tree failure without releasing authority or reporting successful shutdown', async () => {
    const b = await bench()
    const handle = await b.ctx.commandScopes.spawn(spec)
    b.child.direct.resolve(outcome); b.child.tree.resolve(false)
    await expect(handle.cleanup).rejects.toThrow('process-tree exit was not confirmed')
    expect(b.release).not.toHaveBeenCalled()
    await expect(b.ctx.commandScopes.stopAll()).rejects.toThrow('cleanup could not be confirmed')
    await expect(b.ctx.commandScopes.stopAll()).rejects.toThrow('cleanup could not be confirmed')
  })

  it('retains a failed release even after the real tree is gone', async () => {
    const b = await bench()
    b.release.mockRejectedValue(new Error('release refused'))
    const handle = await b.ctx.commandScopes.spawn(spec)
    b.child.direct.resolve(outcome); b.child.tree.resolve(true)
    await expect(handle.cleanup).rejects.toThrow('release refused')
    await expect(b.ctx.commandScopes.stopAll()).rejects.toThrow('cleanup could not be confirmed')
  })

  it('releases a failed spawn only after the primitive proves no live tree', async () => {
    const b = await bench()
    const handle = await b.ctx.commandScopes.spawn(spec)
    const failure = new Error('spawn failed')
    b.child.direct.reject(failure)
    await b.child.waiting.promise
    expect(b.release).not.toHaveBeenCalled()
    b.child.tree.resolve(true)
    await handle.cleanup
    await expect(handle.done).rejects.toBe(failure)
    expect(b.release).toHaveBeenCalledOnce()
  })

  it('terminates a late PTY and joins its complete cleanup before rejecting allocation', async () => {
    const b = await bench()
    const allocated = Promise.withResolvers<SubprocessTerminalHandle>()
    const entered = Promise.withResolvers<undefined>()
    onTestFinished(() => { allocated.resolve(b.pty.handle) })
    b.subprocess.spawnTerminal.mockImplementation(() => { entered.resolve(undefined); return allocated.promise })
    const start = b.ctx.commandScopes.spawnTerminal(terminalSpec)
    const rejected = expect(start).rejects.toMatchObject({ name: 'AbortError' })
    await entered.promise
    const stop = b.ctx.commandScopes.stopAll()
    allocated.resolve(b.pty.handle)
    await b.pty.stopping.promise
    expect(b.release).not.toHaveBeenCalled()
    b.pty.tree.resolve(undefined)
    await rejected
    await stop
    expect(b.pty.handle.terminate).toHaveBeenCalledOnce()
    expect(b.release).toHaveBeenCalledOnce()
  })

  it('reports failed PTY termination without waiting forever for direct exit or releasing authority', async () => {
    const b = await bench()
    vi.mocked(b.pty.handle.terminate).mockRejectedValue(new Error('terminal tree refused'))
    const terminal = await b.ctx.commandScopes.spawnTerminal(terminalSpec)
    await expect(terminal.terminate()).rejects.toThrow('terminal tree refused')
    expect(b.release).not.toHaveBeenCalled()
    await expect(b.ctx.commandScopes.stopAll()).rejects.toThrow('cleanup could not be confirmed')
  })

  it('provider removal refuses new commands and joins existing scopes', async () => {
    const b = await bench()
    const handle = await b.ctx.commandScopes.spawn(spec)
    const removed = b.remove!()
    await expect(b.ctx.commandScopes.spawn(spec)).rejects.toThrow('Required command identity provider')
    b.child.direct.resolve(outcome); b.child.tree.resolve(true)
    await removed
    await handle.cleanup
    expect(b.child.handle.terminate).toHaveBeenCalledOnce()
    expect(b.release).toHaveBeenCalledOnce()
  })
})

describe.skipIf(process.platform === 'win32')('real POSIX command consumers', () => {
  async function realBench() {
    const ctx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(CommandScopes, { identity: 'required' })
    const identity = lease()
    ctx.commandScopes.register({ prepare: async () => identity.value })
    await ctx.plugin(LocalBashExecutor, { graceMs: 100 })
    return { ctx, ...identity }
  }

  it('passes prepared identity through the actual Bash consumer and releases after completion', async () => {
    const b = await realBench()
    const result = await b.ctx.shell.run(b.ctx.shell.resolve({ command: 'printf "%s" "$MANTURHUB_IDENTITY_MODE"' }))
    expect(result.exitCode).toBe(0)
    expect(result.stdout.text).toBe('desktop-managed')
    expect(b.release).toHaveBeenCalledOnce()
  })

  it('kills a real surviving descendant after the direct child exits, then releases', async () => {
    const b = await realBench()
    const code = 'const c = require("node:child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {stdio:"ignore"}); console.log(c.pid); c.unref()'
    const handle = await b.ctx.commandScopes.spawn({ ...spec, argv: [process.execPath, '-e', code] })
    await handle.done
    const pid = Number(handle.collected.stdout!.readFrom(0).text.trim())
    expect(Number.isInteger(pid) && pid > 0).toBe(true)
    expect(() => process.kill(pid, 0)).not.toThrow()
    expect(b.release).not.toHaveBeenCalled()
    b.abort.abort()
    await handle.cleanup
    expect(() => process.kill(pid, 0)).toThrow()
    expect(b.release).toHaveBeenCalledOnce()
  })

  it('releases the real PTY only after terminating its session', async () => {
    const b = await realBench()
    const terminal = await b.ctx.commandScopes.spawnTerminal(terminalSpec)
    terminal.output.resume()
    const pid = terminal.pid
    expect(() => process.kill(pid, 0)).not.toThrow()
    await terminal.terminate()
    expect(() => process.kill(pid, 0)).toThrow()
    expect(b.release).toHaveBeenCalledOnce()
  })
})
