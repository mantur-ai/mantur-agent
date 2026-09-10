/**
 * Connection supervisor: owns the MCP client/transport generations for one
 * plugin instance, keeps the harness tool registry in sync with the live
 * generation, and — when the connection drops — restarts the configured
 * server with bounded exponential backoff.
 *
 * One outage shares one attempt budget (`maxAttempts` consecutive failed
 * attempts, delays doubling from `initialDelayMs` up to `maxDelayMs`). A
 * connection that stays up past the stability window closes the outage, so
 * the next disconnect starts a fresh budget while a crash-looping server —
 * even one whose connects briefly succeed — still exhausts the cap instead of
 * restarting forever. Exhaustion unregisters the server's tools and stops;
 * disposal (including HMR) is the only way back from that state.
 *
 * @module
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js'
import type { Context } from '@deepseek-ai/cordis'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { createTransport, isExpiredHttpSession } from './transport.ts'
import { syncTools } from './tools.ts'
import type { ToolBridgeOptions, ToolDisposers } from './tools.ts'
import type { Config } from './index.ts'

/** Automatic reconnect policy for one MCP server connection. */
export interface ReconnectConfig {
  /** Reconnect automatically after a lost connection (default true). */
  enabled?: boolean
  /** First reconnect delay in milliseconds; doubles per consecutive failed attempt (default 500). */
  initialDelayMs?: number
  /** Backoff ceiling in milliseconds; also the uptime after which the attempt budget resets (default 30000). */
  maxDelayMs?: number
  /** Consecutive failed attempts per outage before giving up for good (default 10). */
  maxAttempts?: number
}

/** Defaults shared by the Config schema and {@link resolveReconnectPolicy}. */
export const RECONNECT_DEFAULTS: Required<ReconnectConfig> = Object.freeze({
  enabled: true,
  initialDelayMs: 500,
  maxDelayMs: 30_000,
  maxAttempts: 10,
})

// The SDK's stdio transport owns two two-second termination grace periods.
// Keep one additional second for the process-close event that proves the old
// generation is gone; timing out fails closed instead of overlapping children.
const GENERATION_CLOSE_TIMEOUT_MS = 5_000

/** Fully resolved reconnect policy captured at plugin load. */
export type ResolvedReconnectPolicy = Readonly<Required<ReconnectConfig>>

/**
 * The one explicit resolve step from raw reconnect config to the policy the
 * supervisor runs. Programmatic construction may bypass Schemastery
 * normalization, so every default and bound is re-judged here — misconfiguration
 * fails the plugin instance at load.
 *
 * @param config - Raw `reconnect` config; omission uses the defaults.
 * @param path - Diagnostic prefix naming the config location in thrown messages.
 * @returns The frozen resolved policy.
 */
export function resolveReconnectPolicy(config: ReconnectConfig | undefined, path: string): ResolvedReconnectPolicy {
  if (config !== undefined) {
    for (const key of Object.keys(config)) {
      if (!Object.hasOwn(RECONNECT_DEFAULTS, key)) throw new Error(`${path}.${key} is not a reconnect option`)
    }
  }
  const enabled = config?.enabled ?? RECONNECT_DEFAULTS.enabled
  const initialDelayMs = config?.initialDelayMs ?? RECONNECT_DEFAULTS.initialDelayMs
  const maxDelayMs = config?.maxDelayMs ?? RECONNECT_DEFAULTS.maxDelayMs
  const maxAttempts = config?.maxAttempts ?? RECONNECT_DEFAULTS.maxAttempts
  /* jscpd:ignore-start — domain-specific delay validation parallels llm retry-policy; not extractable */
  if (!Number.isFinite(initialDelayMs) || initialDelayMs <= 0 || initialDelayMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`${path}.initialDelayMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`)
  }
  if (!Number.isFinite(maxDelayMs) || maxDelayMs <= 0 || maxDelayMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`${path}.maxDelayMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`)
  }
  if (initialDelayMs > maxDelayMs) {
    throw new Error(`${path}.initialDelayMs must be less than or equal to maxDelayMs`)
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error(`${path}.maxAttempts must be a positive integer`)
  }
  /* jscpd:ignore-end */
  return Object.freeze({ enabled, initialDelayMs, maxDelayMs, maxAttempts })
}

/** Result from the initial connection attempt, for startup-await semantics. */
export interface ConnectionOutcome {
  /** If the initial connection or tool sync failed, the error; otherwise absent. */
  error?: unknown
}

/** Handle for one plugin instance's supervised connection. */
export interface ConnectionHandle {
  /**
   * Settles when the first connection attempt completes (success or failure).
   * The supervisor enters its reconnect loop regardless; the caller decides
   * whether a failed startup is fatal via `failOnStartupError`.
   */
  ready: Promise<ConnectionOutcome>
  /**
   * Freeze new executions and reconnection without cancelling accepted calls or their attachment writes.
   * @returns The retained drain result; an accepted failure or timeout rejects it.
   */
  stopAccepting(): Promise<void>
  /**
   * Drain accepted calls and the optional owner prerequisite before closing the transport and unregistering tools.
   * @returns The retained shutdown result; failure or unconfirmed completion rejects it.
   */
  dispose(): Promise<void>
}

/**
 * Start the supervised connection for one MCP server and keep it alive per
 * the reconnect policy.
 *
 * @param ctx - Cordis context providing the `tools` registry and logger.
 * @param config - Resolved plugin config selecting the transport and server identity.
 * @param policy - Resolved reconnect policy from {@link resolveReconnectPolicy}.
 * @param beforeClose - Owned remote work to drain after local executions and before transport close.
 * @returns Handle with a `ready` promise for startup-await and a `dispose` for teardown.
 */
export function startConnection(
  ctx: Context,
  config: Config,
  policy: ResolvedReconnectPolicy,
  beforeClose?: () => Promise<void>,
): ConnectionHandle {
  const label = `mcp-client(${config.serverName})`
  let stopping = false
  const executions = new Map<Promise<unknown>, unknown[]>()
  const runTool: ToolBridgeOptions['runTool'] = (work) => {
    if (stopping) return Promise.reject(new Error(`${label}: shutting down; this call was not accepted`))
    const failures: unknown[] = []
    const result = work(error => failures.push(error))
    executions.set(result, failures)
    void result.then(() => executions.delete(result), () => executions.delete(result))
    return result
  }
  const opts: Omit<ToolBridgeOptions, 'isCurrent'> = {
    runTool,
    registrationFailure: 'contain',
    serverName: config.serverName,
    toolCallTimeoutMs: config.toolCallTimeoutMs,
  }
  // The initial sync uses 'throw' when failOnStartupError is configured, so
  // a registration conflict propagates to the startup-await path. Re-syncs
  // and reconnect syncs always contain conflicts.
  const startupOpts: Omit<ToolBridgeOptions, 'isCurrent'> = config.failOnStartupError
    ? { ...opts, registrationFailure: 'throw' }
    : opts

  let disposed = false
  /** Current generation: the connecting or connected client; undefined during backoff waits and after final failure. */
  let client: Client | undefined
  /** Close signal paired with {@link client}; captured by dispose before current ownership is cleared. */
  let clientClosed: Promise<void> | undefined
  /** HTTP generation whose session expired and whose local close is still owned here. */
  let expiredClient: Client | undefined
  let retirement: Promise<void> = Promise.resolve()
  const closeFailures: unknown[] = []
  /** Live tool registrations owned by this server; only {@link enqueueSync} and dispose swap it. */
  let disposers: ToolDisposers = new Map()
  let reconnectTimer: NodeJS.Timeout | undefined
  /** Consecutive failed connection attempts within the current outage. */
  let failedAttempts = 0
  /** When the current generation finished connect + initial sync; undefined while down. */
  let connectedAt: number | undefined
  /** The real error from the first connection attempt, for startup-await diagnostics. */
  let firstAttemptError: unknown

  /** A generation may act only while it is the current one on a live plugin. */
  const ownsGeneration = (generation: Client): boolean => !disposed && client === generation
  const isCurrent = (generation: Client): boolean => ownsGeneration(generation) && expiredClient !== generation

  /**
   * Serializes every syncTools call — initial syncs and notification re-syncs
   * across all generations — so two syncs can never interleave their
   * dispose-previous/register-next swap (which would double-dispose one
   * generation and leak another).
   */
  let syncChain: Promise<void> = Promise.resolve()
  function enqueueSync(generation: Client, syncOpts = opts): Promise<void> {
    const run = syncChain.then(async () => {
      if (!isCurrent(generation)) return
      disposers = await syncTools(generation, ctx, { ...syncOpts, isCurrent: () => isCurrent(generation) }, disposers)
    })
    // The chain tail must survive a failed sync; the enqueuing caller owns reporting.
    syncChain = run.catch(() => {})
    return run
  }

  /** One disconnect decision per owned generation, including racing close/error signals. */
  function generationDown(generation: Client): void {
    if (!ownsGeneration(generation)) return
    client = undefined
    clientClosed = undefined
    scheduleReconnect()
  }

  /** Wait for the transport-owned close signal without letting a broken transport wedge teardown forever. */
  function waitForClose(closed: Promise<void>): Promise<boolean> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => { resolve(false) }, GENERATION_CLOSE_TIMEOUT_MS)
      timeout.unref()
      void closed.then(() => {
        clearTimeout(timeout)
        resolve(true)
      })
    })
  }

  function scheduleReconnect(): void {
    if (stopping || disposed) return
    const lostEstablishedConnection = connectedAt !== undefined
    if (!policy.enabled) {
      const message = lostEstablishedConnection
        ? 'connection lost and reconnect is disabled — reload the plugin or restart the Host to restore tools'
        : 'connection failed and reconnect is disabled — no tools were registered; reload the plugin or restart the Host to connect'
      ctx.logger.error(`${label}: ${message}`)
      return
    }
    // A connection that stayed up past the stability window (= maxDelayMs, the
    // longest backoff spacing) ended the previous outage: start a fresh budget.
    if (connectedAt !== undefined && Date.now() - connectedAt >= policy.maxDelayMs) failedAttempts = 0
    connectedAt = undefined
    failedAttempts += 1
    if (failedAttempts > policy.maxAttempts) {
      // Enqueue the give-up disposal so it cannot race an in-flight sync's
      // phase-2 swap (which checks isCurrent inside the queue).
      syncChain = syncChain.then(() => {
        for (const dispose of disposers.values()) dispose()
        disposers = new Map()
      })
      ctx.logger.error(`${label}: giving up after ${policy.maxAttempts} consecutive failed reconnect attempts — tools unregistered; reload the plugin or restart the Host to reconnect`)
      return
    }
    const delayMs = Math.min(policy.maxDelayMs, policy.initialDelayMs * 2 ** (failedAttempts - 1))
    const action = lostEstablishedConnection ? 'connection lost; reconnecting' : 'connection failed; retrying'
    ctx.logger.warn(`${label}: ${action} in ${delayMs}ms (attempt ${failedAttempts}/${policy.maxAttempts})`)
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined
      settling = connectGeneration(false)
    }, delayMs)
    // An armed reconnect timer must never hold the process open on its own.
    reconnectTimer.unref()
  }

  /**
   * One connection attempt: fresh transport + client (the MCP SDK binds a
   * Protocol to one transport for life), connect, then queue the initial tool
   * sync. The startup flag belongs to the attempt rather than the shared sync
   * queue, so an early notification cannot consume strict startup semantics.
   * Every failure funnels through {@link generationDown}; success arms the
   * onclose-driven disconnect path. Never rejects.
   *
   * @param startup - Whether this is the plugin's activation attempt.
   */
  async function connectGeneration(startup: boolean): Promise<void> {
    const generation = new Client(
      { name: 'dsh-mcp-client', version: '0.0.1' },
      { capabilities: {} },
    )
    const closed: PromiseWithResolvers<void> = Promise.withResolvers()
    let attemptSettled = false
    let closeObserved = false
    const hasClosed = (): boolean => closeObserved
    client = generation
    clientClosed = closed.promise
    generation.onclose = () => {
      closeObserved = true
      closed.resolve()
      // A failed connect owns its close barrier in the catch path below. An
      // established generation can transition down directly from this signal.
      if (attemptSettled && expiredClient !== generation) generationDown(generation)
    }
    // Registered before connect so a list change during the initial sync is
    // queued behind it rather than dropped.
    generation.setNotificationHandler(
      ToolListChangedNotificationSchema,
      async () => {
        if (!isCurrent(generation)) return
        ctx.logger.info(`${label}: tool list changed, re-syncing`)
        try {
          await enqueueSync(generation)
        } catch (error) {
          // Fetch-phase failure: the previous generation is still registered
          // and `disposers` still owns it — keep serving the last good list.
          if (!disposed) ctx.logger.error(`${label}: tool re-sync failed: ${String(error)}`)
        }
      },
    )
    try {
      const transport = createTransport(config)
      generation.onerror = (error) => {
        if (!attemptSettled || !isCurrent(generation) || !isExpiredHttpSession(transport, error)) return
        expiredClient = generation
        syncChain = syncChain.then(() => {
          for (const dispose of disposers.values()) dispose()
          disposers = new Map()
        })
        retirement = (async () => {
          // Both close completion and onclose must settle before a fresh initialize.
          const closing = generation.close().catch((error: unknown) => { closeFailures.push(error) })
          const quiesced = await waitForClose(Promise.all([closing, closed.promise]).then(() => {}))
          if (!quiesced) {
            closeFailures.push(new Error(`${label}: expired HTTP generation closure is unconfirmed`))
            ctx.logger.error(`${label}: expired HTTP generation did not close within ${GENERATION_CLOSE_TIMEOUT_MS}ms — reconnect stopped; reload the plugin or restart the Host to retry`)
            return
          }
          if (!ownsGeneration(generation)) return
          generationDown(generation)
        })()
      }
      await generation.connect(transport)
      if (hasClosed()) {
        attemptSettled = true
        generationDown(generation)
        return
      }
      await enqueueSync(generation, startup ? startupOpts : opts)
    } catch (error) {
      if (firstAttemptError === undefined) firstAttemptError = error
      // Disposal clears current ownership before it closes the generation, so
      // only a live supervisor reports an attempt failure.
      if (isCurrent(generation) && !stopping) ctx.logger.warn(`${label}: connection attempt failed: ${String(error)}`)
      try { await generation.close() } catch (closeError) { closeFailures.push(closeError) }
      const quiesced = hasClosed() || await waitForClose(closed.promise)
      attemptSettled = true
      if (!quiesced) {
        closeFailures.push(new Error(`${label}: failed generation closure is unconfirmed`))
        if (isCurrent(generation)) {
          client = undefined
          clientClosed = undefined
        }
        ctx.logger.error(`${label}: failed generation did not close within ${GENERATION_CLOSE_TIMEOUT_MS}ms — reconnect stopped to avoid overlapping server processes; reload the plugin or restart the Host to retry`)
        return
      }
      if (!isCurrent(generation)) return
      generationDown(generation)
      return
    }
    attemptSettled = true
    if (hasClosed()) {
      generationDown(generation)
      return
    }
    if (!isCurrent(generation)) return
    connectedAt = Date.now()
    if (failedAttempts > 0) ctx.logger.info(`${label}: reconnected and re-synced tools (attempt ${failedAttempts}/${policy.maxAttempts})`)
  }

  /** The in-flight (or last settled) connection attempt; dispose awaits it for quiescence. */
  let settling = connectGeneration(true)

  // The ready promise settles when the first attempt finishes (regardless of
  // success). If the first attempt fails and reconnect is enabled, the
  // supervisor is already scheduling a retry — ready just reports the outcome.
  const ready: Promise<ConnectionOutcome> = settling.then(() => {
    // After settling: if client is set the initial connect+sync succeeded.
    // If not, the supervisor either scheduled a retry (error logged) or gave
    // up (error logged). Either way the outcome is reported with the real error.
    // Note: settling.then() is a microtask; stdio onclose is a macrotask — so
    // a server that crashes AFTER a successful initial sync cannot flip client
    // to undefined before this continuation runs.
    if (client !== undefined) return {}
    /* v8 ignore next -- defensive: firstAttemptError is always set when connect/sync fails */
    return { error: firstAttemptError ?? new Error(`${label}: initial connection failed`) }
  })

  let draining: Promise<void> | undefined
  let disposal: Promise<void> | undefined
  function withinShutdownBudget(work: Promise<void>, timeoutMs = config.toolCallTimeoutMs): Promise<void> {
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { reject(new Error(`${label}: shutdown timed out; completion is unconfirmed`)) }, timeoutMs)
    })
    return Promise.race([work, timeout]).finally(() => { clearTimeout(timer) })
  }
  const stopAccepting = (): Promise<void> => {
    if (draining) return draining
    stopping = true
    if (reconnectTimer !== undefined) {
      clearTimeout(reconnectTimer)
      reconnectTimer = undefined
    }
    const accepted = [...executions]
    draining = withinShutdownBudget(Promise.allSettled(accepted.map(([work]) => work)).then((results) => {
      const errors = [
        ...accepted.flatMap(([, failures]) => failures),
        ...results.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map(result => result.reason as unknown),
      ]
      if (errors.length) throw new AggregateError(errors, `${label}: accepted execution failed during shutdown`)
    }))
    return draining
  }
  return {
    ready,
    stopAccepting,
    dispose(): Promise<void> {
      return disposal ??= (async () => {
        await stopAccepting()
        if (beforeClose) await withinShutdownBudget(beforeClose())
        disposed = true
        if (reconnectTimer !== undefined) {
          clearTimeout(reconnectTimer)
          reconnectTimer = undefined
        }
        const current = client
        const currentClosed = clientClosed
        client = undefined
        clientClosed = undefined
        if (current !== undefined && current !== expiredClient) {
          await withinShutdownBudget(Promise.all([current.close(), currentClosed]).then(() => {}), GENERATION_CLOSE_TIMEOUT_MS)
        }
        // Quiesce, don't just request it: the in-flight attempt enqueues its
        // sync before settling, so awaiting both leaves `disposers` final.
        await withinShutdownBudget(Promise.all([settling, retirement, syncChain]).then(() => {}))
        if (closeFailures.length) throw new AggregateError(closeFailures, `${label}: generation cleanup failed during shutdown`)
        for (const dispose of disposers.values()) dispose()
        disposers = new Map()
      })()
    },
  }
}
