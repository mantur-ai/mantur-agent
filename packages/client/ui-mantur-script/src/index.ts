/** Session-bound script reads and guarded writes over the Harness filesystem. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import type { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import z from '@deepseek-ai/schemastery'
import type { ScriptDocument, ScriptEntry, ScriptSelection, ScriptWrite, ScriptVersion } from './types.ts'

/** Deployment limits for whole-document editing and directory discovery. */
export interface Config {
  /** Maximum UTF-8 bytes read or written for one script. */
  readonly maxBytes: number
  /** Maximum direct entries examined in one project folder. */
  readonly maxEntries: number
}
/** Required bounds supplied by the profile. */
export const Config: z<Config> = z.object({
  maxBytes: z.number().step(1).min(1).required(),
  maxEntries: z.number().step(1).min(1).required(),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Script file commands scoped by the gateway's owning Agent. */
    manturScript: ManturScript
  }
}

/** Remote operations never resolve paths against another Session or process cwd. */
export class ManturScript extends TypertRemoteService {
  static inject = ['typert', 'fs', 'tools']
  static Config = Config
  private readonly mutationPolicy: SandboxPolicyService | undefined

  /** @param ctx - Filesystem, tools, and Remote registry. @param config - Explicit document bounds. */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'manturScript', { namespace: 'manturScript' })
    this.mutationPolicy = ctx.fs.sandboxMode === undefined ? undefined : ctx.get('sandboxPolicy')
    if (ctx.fs.sandboxMode !== undefined && this.mutationPolicy === undefined) {
      throw new Error('Script workbench requires sandboxPolicy for the mounted filesystem')
    }
    ctx.tools.register(defineTool({
      name: 'replace_script_selection',
      description: 'Replace exactly the selected passage from a script rewrite request. Copy path, version, start, end and selected verbatim from that request; offsets are UTF-16 code units in LF-normalized text. Supply only the replacement text. A stale file or mismatched selection fails without writing: stop and ask the user to select the current passage again. Do not work around a conflict with another write tool. Success confirms a guarded file write, not any other production step.',
      parameters: {
        path: { type: 'string', required: true },
        version: { type: 'string', required: true },
        start: { type: 'integer', required: true },
        end: { type: 'integer', required: true },
        selected: { type: 'string', required: true },
        replacement: { type: 'string', required: true },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      execute: async (args, exec) => {
        if (exec.agent === undefined) throw new Error('Script replacement requires an owning Agent')
        const observed = await this.read(exec.agent, args.path)
        if (observed.version !== args.version) throw new FsError('The script changed. Select the current passage again.', 'FS_STALE_VERSION')
        const selection: ScriptSelection = { ...args, version: observed.version }
        if (!Number.isInteger(selection.start) || !Number.isInteger(selection.end)
          || selection.start < 0 || selection.end <= selection.start || selection.end > observed.content.length
          || observed.content.slice(selection.start, selection.end) !== selection.selected) {
          throw new FsError('The selection does not match this file generation.', 'FS_EDIT_NOT_FOUND')
        }
        const next = observed.content.slice(0, selection.start) + args.replacement + observed.content.slice(selection.end)
        const written = await this.write(exec.agent, observed.path, observed.version, next, exec.signal)
        return JSON.stringify({ path: written.path, version: written.version, replaced: selection.selected, replacement: args.replacement })
      },
      presentCall: args => ({ card: 'generic', title: 'Replace script selection', kind: 'other', subtitle: args.path }),
    }))
  }

  /**
   * List the selected project folder without recursive discovery.
   * @param agent - Owning Session.
   * @param directory - Project-relative or absolute folder.
   * @returns Direct script files and folders.
   */
  @Remote('list')
  async list(agent: Agent, directory: string): Promise<ScriptEntry[]> {
    const target = await this.target(agent, directory, false)
    const entries = await this.ctx.fs.listDir(target)
    if (entries.length > this.config.maxEntries) throw new Error('This folder exceeds the script entry limit. Choose a smaller folder.')
    const result: ScriptEntry[] = []
    const root = await this.ctx.fs.resolve(this.cwd(agent))
    for (const entry of entries) {
      if (entry.name.startsWith('.') || !this.ctx.fs.contains(root, entry.target)) continue
      if (entry.type === 'directory' || entry.type === 'file' && /\.(md|txt|fountain)$/i.test(entry.name)) {
        result.push({ path: entry.target.displayPath, name: entry.name, directory: entry.type === 'directory' })
      }
    }
    return result.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name))
  }

  /**
   * Read a bounded UTF-8 document from one observed file generation.
   * @param agent - Owning Session.
   * @param path - Script file within its project.
   * @returns Consistently observed text and version.
   */
  @Remote('read')
  async read(agent: Agent, path: string): Promise<ScriptDocument> {
    const target = await this.target(agent, path, true)
    const before = await this.ctx.fs.stat(target)
    if (before?.type !== 'file') throw new FsError('The script is not a regular file.', 'FS_NOT_REGULAR_FILE')
    const bytes = await this.ctx.fs.readBytes(target, undefined, this.config.maxBytes)
    const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\r\n?/g, '\n')
    const after = await this.ctx.fs.stat(target)
    if (before.version !== after?.version) throw new FsError('The script changed while reading.', 'FS_STALE_VERSION')
    return { path: target.displayPath, content, version: before.version as string as ScriptVersion }
  }

  /**
   * Save a draft only while its observed generation remains current.
   * @param agent - Owning Session.
   * @param request - Versioned full draft.
   * @returns Written text and new generation.
   */
  @Remote('save')
  async save(agent: Agent, request: ScriptWrite): Promise<ScriptDocument> {
    return this.write(agent, request.path, request.version, request.content)
  }

  private cwd(agent: Agent): string {
    const cwd = agent.session.header.cwd
    if (cwd === undefined) throw new Error('Select a project directory before opening scripts.')
    return cwd
  }

  private async target(agent: Agent, path: string, file: boolean): Promise<FsTarget> {
    const root = await this.ctx.fs.resolve(this.cwd(agent))
    const target = await this.ctx.fs.resolve(path || '.', { cwd: this.cwd(agent) })
    if (!this.ctx.fs.contains(root, target)) throw new FsError('Script paths must stay inside this project.', 'FS_PERMISSION_DENIED')
    if (file && !/\.(md|txt|fountain)$/i.test(target.displayPath)) throw new Error('Choose a Markdown, text, or Fountain script file.')
    return target
  }

  private async write(agent: Agent, path: string, version: ScriptVersion, content: string, signal?: AbortSignal): Promise<ScriptDocument> {
    if (new TextEncoder().encode(content).length > this.config.maxBytes) throw new FsError('The script exceeds the document size limit.', 'FS_TOO_LARGE')
    const target = await this.target(agent, path, true)
    const policy = this.mutationPolicy?.resolve({ session: agent.session })
    const observed = await this.ctx.fs.stat(target)
    if (observed === undefined || String(observed.version) !== version) throw new FsError('The script changed. Your draft was not written.', 'FS_STALE_VERSION')
    const result = await this.ctx.fs.writeText(target, content, { kind: 'replaceIfVersion', version: observed.version }, signal, policy)
    return { path: target.displayPath, version: result.version as string as ScriptVersion, content: result.after }
  }
}
export default ManturScript
