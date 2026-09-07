/** Asynchronous command identity preparation and whole-process-tree ownership above the synchronous subprocess primitive. */
import { Context, Service } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import type {
  SubprocessHandle, SubprocessSpawnSpec, SubprocessTerminalHandle, SubprocessTerminalSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'

/** Deployment choice; required identity never silently becomes an unscoped command. */
export interface Config {
  /** Whether commands require one registered identity provider; defaults to none. */
  readonly identity?: 'none' | 'required'
}

/** One identity owner's environment and cancellation, retained until real process cleanup is confirmed. */
export interface CommandIdentityLease {
  readonly environment: Readonly<Record<string, string>>
  readonly signal: AbortSignal
  /** Release private authority only after the complete process tree or terminal session is gone. */
  release(): Promise<void>
}

/** Identity implementation selected once per admitted command. */
export interface CommandIdentityProvider {
  /**
   * Prepare authority before allocating any command process.
   * @param signal - preparation and whole-command cancellation.
   * @returns a lease whose release must follow complete process cleanup.
   */
  prepare(signal: AbortSignal): Promise<CommandIdentityLease>
}

/** Real process handle with an independent whole-tree and identity-release completion. */
export interface CommandProcess extends SubprocessHandle {
  /** Combined caller, owner and identity cancellation for result classification. */
  readonly signal: AbortSignal
  /** Resolves only after every owned process has exited and private authority has been released. */
  readonly cleanup: Promise<void>
}

interface OwnedCommand {
  readonly provider: CommandIdentityProvider | undefined
  readonly abort: AbortController
  readonly done: PromiseWithResolvers<undefined>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Async command preparation and leases; protocol processes may still use ctx.subprocess directly. */
    commandScopes: CommandScopes
  }
}

/** Keeps identity scopes alive across executor reloads and direct-child exit until the entire owned tree is gone. */
export class CommandScopes extends Service {
  static inject = ['subprocess']
  static Config: s<Config> = s.object({ identity: s.union(['none', 'required']).default('none') })
  private readonly identity: 'none' | 'required'
  private provider: CommandIdentityProvider | undefined
  private readonly commands = new Set<OwnedCommand>()
  private closing = false
  private closed: Promise<void> | undefined

  /**
   * @param ctx - composition carrying the real subprocess provider.
   * @param config - explicit identity policy, resolved before command admission.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'commandScopes')
    // Schemastery resolves the deployment policy before constructing the service.
    this.identity = (config as Required<Config>).identity
    ctx.effect(() => () => this.stopAll(), 'command-scopes: stop owned commands')
  }

  /**
   * Register the single identity owner for this required-identity composition.
   * @param provider - prepares private authority without creating a command process.
   * @returns a disposer that stops admission, aborts this provider's commands and awaits their cleanup.
   */
  register(provider: CommandIdentityProvider): () => Promise<void> {
    if (this.closing || this.identity !== 'required' || this.provider !== undefined) throw new Error('Command identity cannot be registered')
    this.provider = provider
    return async () => {
      if (this.provider === provider) this.provider = undefined
      await this.stop([...this.commands].filter(command => command.provider === provider))
    }
  }

  /**
   * Prepare identity, then synchronously allocate and own a real subprocess handle.
   * @param spec - complete subprocess request, including caller cancellation and environment.
   * @returns the real live handle after preparation; its direct-child done remains distinct from scope cleanup.
   */
  async spawn(spec: SubprocessSpawnSpec): Promise<CommandProcess> {
    const command = this.admit()
    const signal = AbortSignal.any([command.abort.signal, ...(spec.signal === undefined ? [] : [spec.signal])])
    let lease: CommandIdentityLease | undefined
    let owned = false
    try {
      lease = await this.prepare(command, signal)
      const lifetime = lease === undefined ? signal : AbortSignal.any([signal, lease.signal])
      lifetime.throwIfAborted()
      const handle = this.ctx.subprocess.spawn({ ...spec, signal: lifetime, env: { ...spec.env, ...lease?.environment } })
      owned = true
      const abort = (): void => { handle.terminate() }
      lifetime.addEventListener('abort', abort, { once: true })
      if (lifetime.aborted) abort()
      const finished = (async () => {
        try {
          // A spawn failure still requires the primitive's explicit no-live-tree proof.
          await handle.done.catch(() => { /* Spawn failure still proceeds to the primitive's tree-exit check. */ })
          if (!await handle.waitForExit()) throw new Error('Command process-tree exit was not confirmed')
          await lease?.release()
        } finally { lifetime.removeEventListener('abort', abort) }
      })()
      this.observe(command, finished)
      if (lifetime.aborted) { await command.done.promise; lifetime.throwIfAborted() }
      return {
        pid: handle.pid, stdin: handle.stdin, stdout: handle.stdout, stderr: handle.stderr,
        collected: handle.collected, done: handle.done, cleanup: command.done.promise, signal: lifetime,
        terminate: () => { handle.terminate() }, waitForExit: signal => handle.waitForExit(signal),
      }
    } catch (error) {
      if (!owned) await this.releaseUnallocated(command, lease)
      throw error
    }
  }

  /**
   * Own both asynchronous PTY allocation and the complete terminal session.
   * @param spec - terminal request whose cancellation also covers identity preparation.
   * @returns a real terminal handle only if allocation wins cancellation; late terminals are terminated before rejection.
   */
  async spawnTerminal(spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> {
    const command = this.admit()
    const signal = AbortSignal.any([command.abort.signal, ...(spec.signal === undefined ? [] : [spec.signal])])
    let lease: CommandIdentityLease | undefined
    let owned = false
    try {
      lease = await this.prepare(command, signal)
      const lifetime = lease === undefined ? signal : AbortSignal.any([signal, lease.signal])
      lifetime.throwIfAborted()
      const terminal = await this.ctx.subprocess.spawnTerminal({ ...spec, signal: lifetime, env: { ...spec.env, ...lease?.environment } })
      owned = true
      let cleanup: Promise<void> | undefined
      const terminate = (): Promise<void> => {
        if (cleanup === undefined) {
          cleanup = (async () => {
            try { await terminal.terminate(); await lease?.release() }
            finally { lifetime.removeEventListener('abort', abort) }
          })()
          this.observe(command, cleanup)
        }
        return cleanup
      }
      const abort = (): void => {
        void terminate().catch(() => { /* command.done and stopAll report failed terminal cleanup. */ })
      }
      lifetime.addEventListener('abort', abort, { once: true })
      void terminal.done.then(terminate, terminate).catch(() => { /* command.done reports failed cleanup, including transport failure. */ })
      if (lifetime.aborted) { abort(); await command.done.promise; lifetime.throwIfAborted() }
      return {
        pid: terminal.pid, output: terminal.output, done: terminal.done,
        write: data => terminal.write(data), inspectForeground: () => terminal.inspectForeground(),
        signalForeground: signal => terminal.signalForeground(signal), terminate,
      }
    } catch (error) {
      if (!owned) await this.releaseUnallocated(command, lease)
      throw error
    }
  }

  /**
   * Reject new work, abort admitted preparation and commands, and await actual cleanup.
   * @returns completion only after every lease is released; missing whole-tree proof or a release failure rejects.
   */
  stopAll(): Promise<void> {
    this.closing = true
    this.closed ??= this.stop([...this.commands])
    return this.closed
  }

  private admit(): OwnedCommand {
    if (this.closing) throw new Error('Command scope admission is closed')
    if (this.identity === 'required' && this.provider === undefined) throw new Error('Required command identity provider is unavailable')
    const command: OwnedCommand = { provider: this.provider, abort: new AbortController(), done: Promise.withResolvers<undefined>() }
    this.commands.add(command)
    void command.done.promise.catch(() => { /* stopAll or provider disposal reports unconfirmed cleanup. */ })
    return command
  }

  private async prepare(command: OwnedCommand, signal: AbortSignal): Promise<CommandIdentityLease | undefined> {
    signal.throwIfAborted()
    return await command.provider?.prepare(signal)
  }

  private async releaseUnallocated(command: OwnedCommand, lease: CommandIdentityLease | undefined): Promise<void> {
    const released = (async () => { await lease?.release() })()
    this.observe(command, released)
    await released
  }

  private observe(command: OwnedCommand, completion: Promise<void>): void {
    void completion.then(() => {
      this.commands.delete(command)
      command.done.resolve(undefined)
    }, (error: unknown) => { command.done.reject(error) })
  }

  private async stop(commands: readonly OwnedCommand[]): Promise<void> {
    for (const command of commands) command.abort.abort()
    const outcomes = await Promise.allSettled(commands.map(command => command.done.promise))
    if (outcomes.some(result => result.status === 'rejected')) throw new Error('Command scope cleanup could not be confirmed')
  }
}

export default CommandScopes
