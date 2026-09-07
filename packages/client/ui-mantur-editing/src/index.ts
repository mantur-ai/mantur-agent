/** Host owner of Session editing runtimes and Agent-scoped editing tools. */
import { Context, type Fiber } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { isAbsolute } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'
import { startEditor, type EditorRuntime, type RuntimeConfig } from './runtime.ts'
import type { EditingWorkspace } from './types.ts'

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
  static inject = ['typert', 'webServer', 'tools']
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
