/* oxlint-disable @stylistic/max-len -- compact transport handlers keep the guarded sequence visible. */
/** Production Mantur asset provider: report reads, guarded drafts, proposals, and writes. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { FsError } from '@deepseek-ai/dsh-fs'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import { randomUUID } from 'node:crypto'
import Schema from '@deepseek-ai/schemastery'
import type { AssetCommand, AssetEntry, AssetMedia, AssetProposal, ProposalId, AssetSnapshot, AssetState, AssetVersion, PromptEdit, SourcePin } from './types.ts'
import { fingerprint, report } from './report.ts'

export interface Config { readonly maxBytes: number; readonly maxEntries: number; readonly maxMediaBytes: number }
export const Config: Schema<Config> = Schema.object({
  maxBytes: Schema.number().step(1).min(1).required(),
  maxEntries: Schema.number().step(1).min(1).required(),
  maxMediaBytes: Schema.number().step(1).min(1).required(),
})
declare module '@deepseek-ai/cordis' { interface Context { manturAssets: ManturAssets } }

const emptyState = (path: string): AssetState => ({ format: 1, path, drafts: [], proposals: [], history: [], pending: null })

/** Host service. Each write is source-CAS guarded and journals recovery before replacement. */
export class ManturAssets extends TypertRemoteService {
  static inject = ['typert', 'fs', 'tools']
  static Config = Config
  private readonly sessions = new WeakMap<object, { source: SourcePin; stateFile: string; media: Map<string, { path: string; sha: string; type: string }> }>()
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'manturAssets', { namespace: 'manturAssets' })
    ctx.tools.register(defineTool({
      name: 'propose_asset_prompts', description: 'Record a text-only asset prompt proposal for the current requested source. This never generates media or writes a pipeline report.',
      parameters: { requestId: { type: 'string', required: true }, source: { type: 'string', required: true }, edits: { type: 'string', required: true } },
      output: { schema: { type: 'string' }, render: (_a, value) => [{ type: 'text', text: value }] },
      execute: async (args, exec) => JSON.stringify(await this.propose(exec.agent, args.requestId, args.source, JSON.parse(args.edits))),
      presentCall: args => ({ card: 'generic', title: 'Asset prompt proposal', kind: 'other', subtitle: args.requestId }),
    }))
  }
  @Remote('list') async list(agent: Agent, directory: string): Promise<AssetEntry[]> {
    const target = await this.target(agent, directory || '.', false); const entries = await this.ctx.fs.listDir(target)
    if (entries.length > this.config.maxEntries) throw new Error('Folder exceeds asset entry limit')
    return entries.filter(item => !item.name.startsWith('.') && (item.type === 'directory' || /\.(json|png|jpe?g|webp|mp4|webm)$/i.test(item.name))).map(item => ({ path: item.target.displayPath, name: item.name, directory: item.type === 'directory' }))
  }
  @Remote('load') async load(agent: Agent, assetsPath: string, _clipsPath?: string, mediaManifest?: string): Promise<AssetSnapshot> {
    const source = await this.pin(agent, assetsPath); const sourceText = await this.read(source.path, this.config.maxBytes)
    const parsed = report(sourceText); const root = await this.ctx.fs.resolve(this.cwd(agent)); const stateFile = `${root.displayPath}/.mantur-assets-${fingerprint(source.path).slice(0, 16)}.json`
    const state = await this.readState(stateFile, source.path); const media = new Map<string, { path: string; sha: string; type: string }>()
    if (mediaManifest !== undefined) {
      const manifest = JSON.parse(await this.read((await this.pin(agent, mediaManifest)).path, this.config.maxBytes)) as unknown
      if (!Array.isArray(manifest)) throw new Error('Media manifest must be an array')
      for (const item of manifest) { if (!item || typeof item !== 'object') throw new Error('Invalid media manifest row'); const row = item as Record<string, unknown>; if (typeof row.clip_id !== 'string' || typeof row.file !== 'string') throw new Error('Media manifest requires clip_id and file'); const target = await this.target(agent, row.file, true); const stat = await this.ctx.fs.stat(target); if (stat?.type !== 'file') throw new Error('Media file missing'); media.set(row.clip_id, { path: target.displayPath, sha: String(row.sha256 ?? ''), type: 'video/mp4' }) }
    }
    this.sessions.set(agent.session as object, { source, stateFile, media })
    return { source, stateVersion: (await this.ctx.fs.stat(await this.target(agent, stateFile, true)))?.version as AssetVersion | undefined ?? null, state, rows: parsed.rows, projectState: null }
  }
  @Remote('saveDraft') async saveDraft(agent: Agent, command: AssetCommand): Promise<AssetSnapshot> { const current = await this.require(agent, command.source); const snapshot = await this.snapshot(agent, current); if (snapshot.stateVersion !== command.stateVersion) throw new FsError('Asset journal changed; reload before saving.', 'FS_STALE_VERSION'); const draft = { revision: (snapshot.state.drafts.at(-1)?.revision ?? 0) + 1, source: current, edits: command.edits }; snapshot.state.drafts.push(draft); await this.writeState(agent, current, snapshot.state, snapshot.stateVersion); return this.snapshot(agent, current) }
  /**
   * Capture disk prompt fields separately from the user's proposed text.
   * @param agent - Owning Session.
   * @param source - Exact report observation.
   * @param edits - Selected prompt drafts.
   * @param instruction - User instruction for the original pipeline Skill.
   * @returns Request identity and selected draft fields for the Session message.
   */
  @Remote('prepare')
  async prepare(agent: Agent, source: SourcePin, edits: PromptEdit[], instruction: string): Promise<{
    requestId: string
    source: SourcePin
    edits: PromptEdit[]
  }> {
    const current = await this.require(agent, source)
    const info = await this.session(agent)
    if (current.path !== info.source.path) throw new Error('Load the selected source before preparing a request')
    const stateVersion = await this.stateVersion(agent)
    const state = await this.readState(info.stateFile, current.path)
    if (state.pending !== null) throw new Error('An unfinished source write requires recovery')
    const text = await this.read(current.path, this.config.maxBytes)
    if (fingerprint(text) !== current.sha256) throw new FsError('Source changed while preparing.', 'FS_STALE_VERSION')
    const parsed = report(text)
    // Validate the exact selected identities before persisting any request.
    parsed.replace(edits)
    const before = edits.map((edit) => {
      const row = parsed.rows.find(value => value.key === edit.key)
      if (row === undefined) throw new Error('Asset identity changed while preparing a request')
      return { key: row.key, fingerprint: row.fingerprint, prompt: row.prompt, negative: row.negative }
    })
    const id = randomUUID() as ProposalId
    state.proposals.push({
      id, session: agent.session.id, source: current,
      draftRevision: state.drafts.at(-1)?.revision ?? 0, instruction,
      before, edits, status: 'requested',
    })
    await this.writeState(agent, current, state, stateVersion)
    return { requestId: id, source: current, edits }
  }
  @Remote('apply') async apply(agent: Agent, requestId: string): Promise<AssetSnapshot> { const info = await this.session(agent); const source = info.source; const state = await this.readState(info.stateFile, source.path); const proposal = state.proposals.find(item => String(item.id) === requestId); if (!proposal || proposal.status !== 'proposed') throw new Error('Only an Agent proposal can be applied'); const current = await this.pin(agent, source.path); if (current.sha256 !== source.sha256 || current.version !== source.version) throw new FsError('Source changed; proposal was not applied.', 'FS_STALE_VERSION'); const text = await this.read(source.path, this.config.maxBytes); const next = report(text).replace(proposal.edits); const after = { ...await this.pin(agent, source.path), sha256: fingerprint(next) }; state.pending = { proposal: proposal.id, source: current, afterText: next, afterSha: after.sha256 }; const oldVersion = await this.stateVersion(agent); await this.writeState(agent, source, state, oldVersion); await this.ctx.fs.writeText(await this.target(agent, source.path, true), next, { kind: 'replaceIfVersion', version: current.version }); proposal.status = 'applied'; state.pending = null; state.history.push({ id: proposal.id, before: proposal.before, after: proposal.edits, beforeSha: source.sha256, afterSha: after.sha256 }); await this.writeState(agent, after, state, await this.stateVersion(agent)); return this.snapshot(agent, after) }
  @Remote('propose') async proposeRemote(agent: Agent, requestId: string, source: string, edits: PromptEdit[]): Promise<AssetProposal> { return this.propose(agent, requestId, source, edits) }
  @Remote('media') async media(agent: Agent, id: string): Promise<AssetMedia> { const row = (await this.session(agent)).media.get(id); if (!row) throw new Error('Media has no explicit manifest binding'); return { id, name: row.path.split('/').at(-1) ?? id, url: `/api/mantur-assets.media?id=${encodeURIComponent(id)}`, kind: 'video' } }
  private async propose(agent: Agent | undefined, requestId: string, source: string, edits: PromptEdit[]): Promise<AssetProposal> { if (!agent) throw new Error('Asset proposal requires an owning Agent'); const state = await this.readState((await this.session(agent)).stateFile, source); const proposal = state.proposals.find(item => String(item.id) === requestId); if (!proposal) throw new Error('Unknown asset request'); proposal.edits = edits; proposal.status = 'proposed'; await this.writeState(agent, proposal.source, state, await this.stateVersion(agent)); return proposal }
  private async snapshot(agent: Agent, source: SourcePin): Promise<AssetSnapshot> { const text = await this.read(source.path, this.config.maxBytes); const stateFile = (await this.session(agent)).stateFile; const state = await this.readState(stateFile, source.path); return { source: { ...source, sha256: fingerprint(text) }, stateVersion: await this.stateVersion(agent), state, rows: report(text).rows, projectState: null } }
  private async stateVersion(agent: Agent) { return (await this.ctx.fs.stat(await this.target(agent, (await this.session(agent)).stateFile, true)))?.version as AssetVersion | undefined ?? null }
  private async writeState(agent: Agent, _source: SourcePin, state: AssetState, expected: AssetVersion | null) { const path = (await this.session(agent)).stateFile; const target = await this.target(agent, path, true); const text = JSON.stringify(state, null, 2) + '\n'; if (expected === null) await this.ctx.fs.writeText(target, text, { kind: 'createIfAbsent' }); else await this.ctx.fs.writeText(target, text, { kind: 'replaceIfVersion', version: expected }) }
  private async readState(path: string, source: string): Promise<AssetState> {
    const target = await this.ctx.fs.resolve(path)
    const before = await this.ctx.fs.stat(target)
    if (before === undefined) return emptyState(source)
    if (before.type !== 'file') throw new FsError('Asset journal is not a regular file.', 'FS_NOT_REGULAR_FILE')
    const text = await this.read(path, this.config.maxBytes)
    const after = await this.ctx.fs.stat(target)
    if (after?.version !== before.version) throw new FsError('Asset journal changed while reading.', 'FS_STALE_VERSION')
    const value: unknown = JSON.parse(text)
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid asset journal')
    const state = value as Partial<AssetState>
    if (state.format !== 1 || state.path !== source || !Array.isArray(state.drafts)
      || !Array.isArray(state.proposals) || !Array.isArray(state.history)
      || state.pending === undefined) throw new Error('Unsupported or mismatched asset journal')
    return state as AssetState
  }
  private async pin(agent: Agent, path: string): Promise<SourcePin> {
    const target = await this.target(agent, path, true)
    const stat = await this.ctx.fs.stat(target)
    if (stat?.type !== 'file') throw new Error('Asset report is not a file')
    const text = await this.read(target.displayPath, this.config.maxBytes)
    if ((await this.ctx.fs.stat(target))?.version !== stat.version) {
      throw new FsError('Asset report changed while reading.', 'FS_STALE_VERSION')
    }
    return { path: target.displayPath, version: stat.version, sha256: fingerprint(text) }
  }
  private async read(path: string, max: number) { const target = await this.ctx.fs.resolve(path); return new TextDecoder('utf-8', { fatal: true }).decode(await this.ctx.fs.readBytes(target, undefined, max)) }
  private cwd(agent: Agent) { const cwd = agent.session.header.cwd; if (!cwd) throw new Error('Select a project directory first'); return cwd }
  private async target(agent: Agent, path: string, file: boolean) { const root = await this.ctx.fs.resolve(this.cwd(agent)); const target = await this.ctx.fs.resolve(path, { cwd: this.cwd(agent) }); if (!this.ctx.fs.contains(root, target)) throw new FsError('Asset path is outside the selected project.', 'FS_PERMISSION_DENIED'); if (file && target.displayPath.endsWith('/')) throw new Error('Asset path must be a file'); return target }
  private async session(agent: Agent) { const found = this.sessions.get(agent.session as object); if (!found) throw new Error('Load an asset project first'); return found }
  private async require(agent: Agent, source: SourcePin) { const current = await this.pin(agent, source.path); if (current.sha256 !== source.sha256 || current.version !== source.version) throw new FsError('Source changed; reload before editing.', 'FS_STALE_VERSION'); return current }
}
export default ManturAssets
