/** Host owner of Session editing runtimes and Agent-scoped editing tools. */
import { Context, type Fiber } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { isAbsolute } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { apply as applyMcpClient, Config as McpClientConfig, inject as mcpClientInject, name as mcpClientName } from '@deepseek-ai/dsh-mcp-client'
import { startEditor, type EditorRuntime, type RuntimeConfig } from './runtime.ts'
import type { EditingWorkspace } from './types.ts'

const McpClient = { apply: applyMcpClient, Config: McpClientConfig, inject: mcpClientInject, name: mcpClientName }

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
  editorRoot: z.string().required(), nodeExecutable: z.string().required(),
  startupTimeoutMs: z.number().step(1).min(1).max(2147483647).required(),
  stopTimeoutMs: z.number().step(1).min(1).max(2147483647).required(),
  toolCallTimeoutMs: z.number().step(1).min(1).max(2147483647).required(),
})

/** Runtime and tools share the exact Agent identity resolved by the authenticated Remote gateway. */
export class ManturEditing extends TypertRemoteService {
  static inject = ['typert', 'webServer', 'tools', 'systemPrompt']
  static Config = Config
  private readonly opening = new Map<Agent, Promise<EditorRuntime>>()
  private readonly children = new Map<Agent, Fiber>()
  private closing = false

  /** @param ctx - Host services. @param config - Explicit editor deployment. */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'manturEditing', { namespace: 'manturEditing' })
    if (!isAbsolute(config.editorRoot) || !isAbsolute(config.nodeExecutable)) throw new Error('Editing runtime paths must be absolute')
    ctx.effect(() => async () => {
      this.closing = true
      await Promise.allSettled(this.opening.values())
      await Promise.all([...this.children.values()].map(child => child.dispose()))
    }, 'editing: drain session runtimes')
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
    let opening = this.opening.get(agent)
    if (opening === undefined) {
      opening = this.launch(agent, parentOrigin)
      this.opening.set(agent, opening)
      void opening.catch(() => { if (this.opening.get(agent) === opening) this.opening.delete(agent) })
    }
    const runtime = await opening
    try { runtime.assertRunning() }
    catch (error) { await this.children.get(agent)?.dispose(); throw error }
    return runtime.workspace
  }

  private async launch(agent: Agent, parentOrigin: string): Promise<EditorRuntime> {
    let runtime: EditorRuntime | undefined
    const config = this.config
    const release = () => {
      this.opening.delete(agent)
      this.children.delete(agent)
    }
    const fiber = agent.ctx.plugin({
      name: 'mantur-session-editing',
      inject: ['systemPrompt'],
      async apply(ctx: Context) {
        runtime = await startEditor(config, agent.session.header.cwd, agent.id, parentOrigin)
        const owned = runtime
        ctx.effect(() => release, 'editing: release session binding')
        ctx.effect(() => () => owned.dispose(), 'editing: subprocess')
        await ctx.plugin(McpClient, {
          transport: 'streamable-http', serverName: 'mantur_cut',
          url: new URL('/api/external-mcp/mcp', runtime.workspace.editorUrl).href,
          headers: { Authorization: `Bearer ${runtime.token}` },
          failOnStartupError: true, toolCallTimeoutMs: config.toolCallTimeoutMs,
        }).await()
        ctx.systemPrompt.section({
          name: 'mantur:editing-workflow',
          order: ctx.systemPrompt.getSectionOrder('TOOL_WORKFLOW'),
          text: EDITING_WORKFLOW,
        })
      },
    })
    this.children.set(agent, fiber)
    try {
      await fiber.await()
      if (this.closing) throw new Error('Editing runtime owner is shutting down')
      if (runtime === undefined) throw new Error('Editing runtime did not start')
      return runtime
    } catch (error) {
      await fiber.dispose()
      this.children.delete(agent)
      throw error
    }
  }
}

export default ManturEditing
