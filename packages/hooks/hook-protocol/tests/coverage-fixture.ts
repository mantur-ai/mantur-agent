/** Owns hook coverage contexts until their effects settle, before removing script directories. */
import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-command-scopes'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

interface OwnedContext {
  ctx: Context
  hooks: Array<() => void | Promise<void>>
  agents: Array<() => void | Promise<void>>
}

/** Per-file fixture ownership; disposal failures preserve directories for diagnosis. */
export class HookCoverageFixture {
  private readonly contexts: OwnedContext[] = []
  private readonly directories: string[] = []
  private readonly disposalFailures: unknown[] = []

  /** Register a root before any plugin installation can fail. @returns the owned root. */
  context(): Context {
    const ctx = new Context()
    this.contexts.push({ ctx, hooks: [], agents: [] })
    return ctx
  }

  /**
   * Register a bridge disposer before awaiting plugin readiness; direct apply uses an effect group.
   * @param ctx - the root created by this fixture.
   * @param dispose - stops bridge listeners and joins its detached continuations.
   */
  hook(ctx: Context, dispose: () => void | Promise<void>): void {
    const owned = this.contexts.find(entry => entry.ctx === ctx)
    if (owned === undefined) throw new Error('Hook bridge requires a fixture-owned context')
    owned.hooks.push(dispose)
  }

  /**
   * Register the agent plugin owner before awaiting readiness.
   * @param ctx - the root created by this fixture.
   * @param dispose - drains agents and their writers without requiring durable checkpoints.
   */
  agentOwner(ctx: Context, dispose: () => void | Promise<void>): void {
    const owned = this.contexts.find(entry => entry.ctx === ctx)
    if (owned === undefined) throw new Error('Agent owner requires a fixture-owned context')
    owned.agents.push(dispose)
  }

  /** Allocate a private fixture directory. @param prefix - temporary directory prefix. @returns its path. */
  directory(prefix: string): string {
    const directory = mkdtempSync(join(tmpdir(), prefix))
    this.directories.push(directory)
    return directory
  }

  /**
   * Join every root's effects and observe errors that Cordis logs instead of rejecting.
   * @returns completion; any disposal failure rejects this and later calls, preserving directories.
   */
  async dispose(): Promise<void> {
    const restore: Array<() => void> = []
    try {
      for (const { ctx } of this.contexts) restore.push(observeDisposalErrors(ctx, this.disposalFailures))
      const outcomes = await Promise.allSettled(this.contexts.map(owned => this.stopContext(owned)))
      for (const outcome of outcomes) {
        if (outcome.status === 'rejected') this.disposalFailures.push(outcome.reason as unknown)
      }
    } finally {
      for (const reset of restore) reset()
    }
    // Disposers are single-shot; a later call cannot disprove an earlier cleanup failure.
    if (this.disposalFailures.length > 0) {
      throw new AggregateError(this.disposalFailures, 'Hook fixture contexts did not dispose')
    }
    this.contexts.length = 0
    for (const directory of this.directories) rmSync(directory, { recursive: true, force: true })
    this.directories.length = 0
  }

  private async stopContext({ ctx, hooks, agents }: OwnedContext): Promise<void> {
    const attempt = async (operation: () => unknown): Promise<void> => {
      try { await operation() } catch (error: unknown) { this.disposalFailures.push(error) }
    }
    await Promise.all(hooks.map(dispose => attempt(dispose)))
    await attempt(() => ctx.get('commandScopes')?.stopAll())
    // Persistence stays mounted until the agent owner has flushed and closed its writers.
    await Promise.all(agents.map(dispose => attempt(dispose)))
    await attempt(() => ctx.fiber.dispose())
  }
}

/** Cordis reports effect failures through the root logger while disposal itself resolves. */
function observeDisposalErrors(ctx: Context, failures: unknown[]): () => void {
  const logger = ctx.logger
  const descriptor = Object.getOwnPropertyDescriptor(logger, 'error')
  const original = logger.error
  logger.error = function (this: typeof logger, reason: unknown, ...parameters: unknown[]): void {
    failures.push(reason)
    try {
      Reflect.apply(original, this, [reason, ...parameters])
    } catch (reporterFailure) {
      // Report a broken logger after the other disposers finish, without interrupting them.
      failures.push(reporterFailure)
    }
  }
  // An effect-owned observer could be removed before another concurrent disposer fails.
  return () => {
    if (descriptor === undefined) Reflect.deleteProperty(logger, 'error')
    else Object.defineProperty(logger, 'error', descriptor)
  }
}
