/** Host owner of Session editing runtimes and Agent-scoped editing tools. */
import { Context, type Fiber } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { isAbsolute } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { connectMcpServer, type ConnectionHandle } from '@deepseek-ai/dsh-mcp-client'
import { startEditor, type EditorProcess, type EditorRuntime, type RuntimeConfig } from './runtime.ts'
import { resolvePackagedResources } from '@deepseek-ai/dsh-client-ui-mantur-editing/packaged-resources'
import type { EditingWorkspace } from './types.ts'

const EDITING_WORKFLOW = `Mantur Cut editing workflow

This Agent has opened the 漫途Cut workbench. Use its mcp__mantur_cut__ tools for editing; the workbench and this conversation share the project. Follow each tool's current schema and confirmation requirements.

Bind to the project shown in the workbench with target_project. Inspect list_edit_sessions before starting or recovering work. Use begin_edit_session to create a draft before read_project or draft edits; pass the returned editSessionId and the bound editorProjectId. Read the existing media pool and timeline before importing or placing clips. Match existing asset and timeline item identities to avoid duplicate imports or placements.

review_edit_session finishes drafting: manual mode awaits review, while auto mode applies the staged proposal. Use get_edit_session on that session, through its owning connection, to confirm the terminal result. Only applied confirms application; awaiting_review is not success. Never continue draft reads or edits with an applied, rejected, cancelled, stale or failed editSessionId. To inspect the saved project or make the next edit after application, start a new edit session and read its fresh draft.

If the connection expires or a session becomes stale, stop mutations and report the error. Do not blindly retry imports, placements or review. After the connection is restored, bind to the workbench project again, inspect its edit sessions, and read a fresh draft before deciding what remains. A new connection does not own the old connection's edit session; do not assume the old draft can resume or discard other active work.

Use the project's timeline fps for timeline frame positions and durations. Source-media fps is separate; read or probe source timing as needed, and do not treat source fps as project fps. Verify canvas dimensions, clip order, trims and original audio against the requested edit. Report only verified applied changes; project saving, preview checks and export are distinct results.`

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Session editing runtime owner. */
    manturEditing: ManturEditing
  }
}

/** Editing deployment configuration; no browser-visible credentials. */
export type Config = RuntimeConfig
/** Required paths and bounded subprocess/tool waits supplied by the profile. */
export const Config: z<Config> = z.object({
  runtimeMode: z.union(['development', 'packaged']).required(),
  editorRoot: z.string().required(), nodeExecutable: z.string().required(),
  startupTimeoutMs: z.number().step(1).min(1).max(2147483647).required(),
  stopTimeoutMs: z.number().step(1).min(1).max(2147483647).required(),
  toolCallTimeoutMs: z.number().step(1).min(1).max(2147483647).required(),
})

interface EditingOwner {
  readonly ready: PromiseWithResolvers<EditorRuntime>
  startup?: Promise<EditorRuntime>
  child?: Fiber
  runtime?: EditorRuntime
  process?: EditorProcess
  connection?: ConnectionHandle
  stopping?: Promise<void>
}

/** Runtime and tools share the exact Agent identity resolved by the authenticated Remote gateway. */
export class ManturEditing extends TypertRemoteService {
  static inject = ['typert', 'webServer', 'tools', 'systemPrompt']
  static Config = Config
  private readonly owners = new Map<Agent, EditingOwner>()
  private closing = false
  private shutdown: Promise<void> | undefined

  /** @param ctx - Host services. @param config - Explicit editor deployment. */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'manturEditing', { namespace: 'manturEditing' })
    if (!isAbsolute(config.editorRoot) || !isAbsolute(config.nodeExecutable)) throw new Error('Editing runtime paths must be absolute')
    if (config.runtimeMode === 'packaged') resolvePackagedResources(config.editorRoot)
    ctx.effect(() => () => this.stopForShutdown(), 'editing: drain session runtimes')
  }

  /**
   * Refuse new opens and MCP executions, then drain every acquired or opening editor before releasing its scope.
   * The Host must retain accepted execution signals, its model and attachment services, HTTP and editor windows until completion.
   * @returns The retained shutdown result; failed or unconfirmed work rejects and prevents installation.
   */
  stopForShutdown(): Promise<void> {
    if (this.shutdown) return this.shutdown
    this.closing = true
    const owners = [...this.owners.values()]
    const cutoff = Promise.allSettled(owners.flatMap(owner => owner.connection ? [owner.connection.stopAccepting()] : []))
    this.shutdown = (async () => {
      const started = await Promise.allSettled(owners.map(owner => owner.ready.promise))
      const cutoffs = await cutoff
      const stopped = await Promise.allSettled(owners.map(owner => this.stopOwner(owner)))
      const failures = [...started, ...cutoffs, ...stopped]
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map(result => result.reason as unknown)
      if (failures.length) throw new AggregateError(failures, 'Editing shutdown failed; installation is blocked')
      // oxlint-disable-next-line typescript/no-non-null-assertion -- launch assigns the child before its first await.
      await Promise.all(owners.map(owner => owner.child!.dispose()))
      this.owners.clear()
    })()
    return this.shutdown
  }

  /**
   * Open the Session's workspace and connect its tools only to that Agent.
   * @param agent - Live or resumed Agent resolved by the gateway from the Session id.
   * @param parentOrigin - Mantur browser origin, checked against this Host's listening port.
   * @returns Loopback editor address and canonical Session editing directory.
   */
  @Remote('open')
  async open(agent: Agent, parentOrigin: string): Promise<EditingWorkspace> {
    const parent = new URL(parentOrigin)
    if (parent.origin !== parentOrigin || parent.protocol !== 'http:'
      || !['127.0.0.1', 'localhost', '[::1]'].includes(parent.hostname)
      || Number(parent.port || 80) !== this.ctx.webServer.port) throw new Error('Editing requires this local Mantur origin')
    if (this.closing) throw new Error('Editing runtime owner is shutting down')
    let owner = this.owners.get(agent)
    if (owner === undefined) {
      owner = { ready: Promise.withResolvers<EditorRuntime>() }
      this.owners.set(agent, owner)
      void this.launch(agent, parentOrigin, owner).then(owner.ready.resolve, owner.ready.reject)
    }
    const runtime = await owner.ready.promise
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- Shutdown can start while readiness is awaited.
    if (this.closing) throw new Error('Editing runtime owner is shutting down')
    try { runtime.assertRunning() }
    catch (error) { await this.stopOwner(owner); throw error }
    return runtime.workspace
  }

  private stopOwner(owner: EditingOwner): Promise<void> {
    return owner.stopping ??= (async () => {
      const failures: unknown[] = []
      try { await owner.startup } catch { /* The open promise reports startup; acquired resources still require proven cleanup. */ }
      let disconnected = false
      try { await owner.connection?.dispose(); disconnected = true }
      catch (error) { failures.push(error) }
      if (disconnected) {
        try { await owner.process?.dispose() } catch (error) { failures.push(error) }
      }
      if (failures.length) throw new AggregateError(failures, 'Session editing cleanup failed')
    })()
  }

  private async launch(agent: Agent, parentOrigin: string, owner: EditingOwner): Promise<EditorRuntime> {
    const config = this.config
    const child = agent.ctx.plugin({
      name: 'mantur-session-editing',
      inject: ['systemPrompt', 'tools'],
      apply: async (ctx: Context) => {
        ctx.effect(() => async () => {
          await this.stopOwner(owner)
          if (!this.closing && this.owners.get(agent) === owner) this.owners.delete(agent)
        }, 'editing: owned runtime shutdown')
        owner.startup = (async () => {
          const runtime = await startEditor(config, agent.session.header.cwd, agent.id, parentOrigin, (process) => {
            owner.process = process
          })
          owner.runtime = runtime
          owner.process = runtime
          const connection = connectMcpServer(ctx, {
            transport: 'streamable-http', serverName: 'mantur_cut',
            url: new URL('/api/external-mcp/mcp', runtime.workspace.editorUrl).href,
            headers: { Authorization: `Bearer ${runtime.token}` },
            failOnStartupError: true, toolCallTimeoutMs: config.toolCallTimeoutMs,
          }, () => runtime.drainForShutdown())
          owner.connection = connection
          if (this.closing) await connection.stopAccepting()
          await connection.ready
          ctx.systemPrompt.section({
            name: 'mantur:editing-workflow',
            order: ctx.systemPrompt.getSectionOrder('TOOL_WORKFLOW'),
            text: EDITING_WORKFLOW,
          })
          return runtime
        })()
        await owner.startup
      },
    })
    owner.child = child
    await child.await()
    // oxlint-disable-next-line typescript/no-non-null-assertion -- child.await() completed the apply callback that assigns runtime.
    return owner.runtime!
  }
}

export default ManturEditing
