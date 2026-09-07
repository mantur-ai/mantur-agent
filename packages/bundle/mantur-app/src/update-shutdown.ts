/** Ordered Host shutdown for an explicit desktop installation request. */
import type { Context } from '@deepseek-ai/cordis'
import { hasStartedWorkerPrograms } from '@deepseek-ai/dsh-code-runtime-worker-thread'
import { hasStartedDynamicPrograms } from '@deepseek-ai/dsh-cordis-host-runner'
import { errorChain } from '@deepseek-ai/dsh-llm'
import { livePresetMounts } from '@deepseek-ai/dsh-agent-presets'
import { stopUserPatchWatches } from '@deepseek-ai/dsh-app-boot'
import type AgentLoop from '@deepseek-ai/dsh-agent-loop'
import type AgentRegistry from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/cordis-plugin-hmr'
import type { DirectoryPickerCapability } from '@deepseek-ai/dsh-host-directory-picker'
import { supportedUpdateModules } from './update-policy.ts'
import { updateSaveRequest, type UpdateSaveReply, type UpdateSessionCheckpoint } from './update-protocol.ts'

interface StopOwner { stopForShutdown(): Promise<unknown> }
interface ProgramOwner { readonly hasStartedPrograms: boolean }
interface NativeOwner { stopNativeForShutdown(): Promise<void> }
interface PickerOwner { capability(): DirectoryPickerCapability }
interface OwnedService { readonly name: string; readonly value: unknown }

const producerNames = new Set(['goalRoundDriver', 'sessionTitle', 'jobs', 'terminals', 'workflowEngine', 'subagents', 'subprocess'])

function owners(ctx: Context): OwnedService[] {
  // Each root has its own reflection store, including every isolated service key.
  const store = ctx.root.reflect.store
  return Object.getOwnPropertySymbols(store).map((key) => {
    const impl = store[key] as NonNullable<(typeof store)[symbol]>
    return { name: impl.name, value: impl.value as unknown }
  })
}

function assertProgramHistory(ctx: Context, services: readonly OwnedService[]): void {
  if (hasStartedWorkerPrograms(ctx) || hasStartedDynamicPrograms(ctx)) {
    throw new Error('Update cannot verify shutdown of: previously executed programs: unmanaged operating-system descendants')
  }
  for (const owner of services) {
    if (owner.name === 'codeRuntime' || owner.name === 'dynamicCordisRunner'
      && (owner.value as Partial<ProgramOwner>).hasStartedPrograms !== false) {
      throw new Error(`Update cannot verify shutdown of: ${owner.name}: unmanaged operating-system descendants`)
    }
  }
}

function assertSupported(ctx: Context, services: readonly OwnedService[], priorUnsupported: ReadonlySet<string>): void {
  if (!ctx.get('agentLoop') || !ctx.get('agents')) throw new Error('Update saving requires AgentLoop and AgentRegistry')
  const entries = [...ctx.loader.entries(), ...livePresetMounts(ctx.root.fiber).flatMap(mount => [...mount.tree.entries()])]
  const unsupported = new Set(priorUnsupported)
  for (const entry of entries) {
    if (entry.disabled || entry.options.group || entry.options.name === 'cordis:include' || entry.options.name === 'cordis:group') continue
    if (!supportedUpdateModules.has(entry.options.name)) unsupported.add(entry.options.name)
  }
  for (const owner of services) {
    if (owner.name === 'hmr' && (owner.value as Context['hmr']).config.root.length > 0) unsupported.add('module HMR')
    if (owner.name === 'directoryPicker') {
      const kind = (owner.value as PickerOwner).capability().kind
      if (!new Set(['native', 'browse']).has(kind)) unsupported.add(`directoryPicker: ${kind}`)
    }
  }
  if (unsupported.size) throw new Error(`Update cannot verify shutdown of: ${[...unsupported].join(', ')}`)
  assertProgramHistory(ctx, services)
}

/**
 * Create one installation shutdown operation for the settled application root.
 * No work freezes until prepare is called; a failed stop stays failed for this Host.
 * @param ctx - settled Host root with the current Loader and AgentLoop.
 * @returns an explicit prepare operation which rechecks writer seals for every receipt.
 */
export function createHostUpdateShutdown(ctx: Context): { prepare(): Promise<readonly UpdateSessionCheckpoint[]> } {
  let stopping: Promise<void> | undefined
  const failures: unknown[] = []
  const retained = new Map<unknown, OwnedService>()
  const unsupportedHistory = new Set<string>()
  const quiescing = new Map<unknown, Promise<unknown>>()
  const invoked = new Map<unknown, Promise<unknown>>()
  const start = (owner: OwnedService, run: () => Promise<unknown>): Promise<unknown> => {
    const existing = invoked.get(owner.value)
    if (existing) return existing
    let pending: Promise<unknown>
    try { pending = run() } catch (error: unknown) { failures.push(error); pending = Promise.resolve() }
    const joined = pending.catch((error: unknown) => { failures.push(error) })
    invoked.set(owner.value, joined)
    return joined
  }
  const stopNamed = (services: readonly OwnedService[], names: ReadonlySet<string>): Promise<unknown>[] =>
    services.filter(owner => names.has(owner.name)).map(owner => start(owner, () => (owner.value as StopOwner).stopForShutdown()))
  const stopPickers = (services: readonly OwnedService[]): Promise<unknown>[] => services
    .filter(owner => owner.name === 'directoryPicker').flatMap((owner) => {
      const capability = (owner.value as PickerOwner).capability()
      return capability.kind === 'native' ? [start(owner, () => capability.stopForShutdown())] : []
    })
  const join = async (work: readonly Promise<unknown>[]): Promise<void> => {
    const results = await Promise.allSettled(work)
    for (const result of results) if (result.status === 'rejected') failures.push(result.reason as unknown)
  }
  const collect = (): OwnedService[] => {
    for (const owner of owners(ctx)) retained.set(owner.value, owner)
    const loader = ctx.get('loader')
    if (loader) {
      const entries = [...loader.entries(), ...livePresetMounts(ctx.root.fiber).flatMap(mount => [...mount.tree.entries()])]
      for (const entry of entries) {
        if (!entry.disabled && !entry.options.group && !['cordis:include', 'cordis:group'].includes(entry.options.name)
          && !supportedUpdateModules.has(entry.options.name)) unsupportedHistory.add(entry.options.name)
      }
    }
    return [...retained.values()]
  }
  collect()
  ctx.on('internal/status', () => { collect() })
  const freeze = (services: readonly OwnedService[]): Promise<unknown>[] => {
    for (const owner of services) if (owner.name === 'agents') (owner.value as AgentRegistry).freezeAdmission()
    const programs = stopNamed(services, new Set(['codeRuntime', 'dynamicCordisRunner']))
    return [...programs, ...services.filter(owner => owner.name === 'agentLoop').map((owner) => {
      let pending = quiescing.get(owner.value)
      if (pending === undefined) {
        try { pending = (owner.value as AgentLoop).quiesceForShutdown() }
        catch (error: unknown) { failures.push(error); pending = Promise.resolve() }
        pending = pending.catch((error: unknown) => { failures.push(error) })
        quiescing.set(owner.value, pending)
      }
      return pending
    })]
  }
  const verify = async (): Promise<readonly UpdateSessionCheckpoint[]> => {
    assertProgramHistory(ctx, [...retained.values()])
    const checkpoints = new Map<UpdateSessionCheckpoint['sessionId'], UpdateSessionCheckpoint>()
    for (const owner of retained.values()) {
      if (owner.name !== 'agentLoop') continue
      for (const checkpoint of await (owner.value as AgentLoop).verifyShutdown()) {
        const previous = checkpoints.get(checkpoint.sessionId)
        // One session can have several closed writer lifetimes in the same Host.
        if (!previous || previous.nextSeq < checkpoint.nextSeq) checkpoints.set(checkpoint.sessionId, checkpoint)
      }
    }
    return [...checkpoints.values()]
  }
  const perform = async (): Promise<void> => {
    const initial = collect()
    const drivers = freeze(initial)
    const topology = [stopUserPatchWatches(ctx), ...stopNamed(initial, new Set(['agentPresets']))]
    // Native cancellation must start before awaiting a pending picker RPC.
    const requests = [...stopPickers(initial), ...stopNamed(initial, new Set(['typertGateway', 'webServer']))]
    await join(topology)
    await join([ctx.loader.await()])
    try { assertSupported(ctx, collect(), unsupportedHistory) } catch (error: unknown) { failures.push(error) }
    let installed = collect()
    for (;;) {
      const remainingRequests = stopNamed(installed, new Set(['typertGateway', 'webServer']))
      const producers = stopNamed(installed, producerNames)
      const native = installed.filter(owner => owner.name === 'manturAccount')
        .map(owner => start(owner, () => (owner.value as NativeOwner).stopNativeForShutdown()))
      await join([...drivers, ...freeze(installed), ...requests, ...remainingRequests, ...stopPickers(installed), ...producers, ...native])
      const next = collect()
      if (next.length === installed.length) break
      installed = next
      await join(stopNamed(installed, new Set(['agentPresets'])))
      await join([ctx.loader.await()])
      try { assertSupported(ctx, installed, unsupportedHistory) } catch (error: unknown) { failures.push(error) }
    }
    await join(stopNamed(installed, new Set(['settings'])))
    await join(stopNamed(installed, new Set(['agentLoop'])))
    await join(stopNamed(installed, new Set(['sessionProjectionCache'])))
    await join(stopNamed(installed, new Set(['storageDomain'])))
    if (collect().length !== installed.length) failures.push(new Error('A new owner appeared after storage shutdown'))
    await join([verify()])
    if (failures.length) throw new AggregateError(failures, 'Host update shutdown failed')
  }
  return {
    async prepare() {
      if (stopping === undefined) {
        assertSupported(ctx, collect(), unsupportedHistory)
        stopping = perform()
      }
      await stopping
      return verify()
    },
  }
}

/**
 * Listen only on the inherited parent channel; normal application use and shutdown send no save request.
 * @param ctx - fully booted application root.
 * @param channel - the launcher's inherited parent IPC channel.
 * @returns disposer for the update request listener.
 */
export function installHostUpdateListener(
  ctx: Context, channel: Pick<NodeJS.Process, 'send' | 'connected' | 'on' | 'off' | 'disconnect' | 'exitCode'>,
): () => void {
  if (!channel.send || !channel.connected) throw new Error('Desktop update saving requires parent IPC')
  const coordinator = createHostUpdateShutdown(ctx)
  let prepared = false
  let exiting = false
  const onMessage = (value: unknown): void => {
    if (value && typeof value === 'object' && (value as Record<string, unknown>).type === 'mantur:update:exit') {
      if (!prepared || exiting) return
      exiting = true
      void coordinator.prepare().then(() => ctx.root.fiber.dispose()).then(() => coordinator.prepare()).then(
        () => { channel.exitCode = 0; channel.disconnect() },
        (error: unknown) => { console.error(error); channel.exitCode = 1; channel.disconnect() },
      )
      return
    }
    const request = updateSaveRequest(value)
    if (!request) return
    void coordinator.prepare().then(
      (checkpoints) => { prepared = true; send({ type: 'mantur:update:prepared', id: request.id, ok: true, checkpoints }) },
      (error: unknown) => { send({ type: 'mantur:update:prepared', id: request.id, ok: false, error: errorChain(error) }) },
    )
  }
  const send = (reply: UpdateSaveReply): void => {
    if (channel.connected) channel.send?.(reply, () => { /* Main rejects channel failure or a missing receipt. */ })
  }
  channel.on('message', onMessage)
  channel.send({ type: 'mantur:update:ready' }, () => { /* Main requires readiness before exposing the Host. */ })
  return () => { channel.off('message', onMessage) }
}
