/* oxlint-disable @stylistic/max-len -- compact transport handlers keep the guarded sequence visible. */
/** Production Mantur asset provider: report reads, guarded drafts, proposals, and writes. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { FsError } from '@deepseek-ai/dsh-fs'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import { randomUUID } from 'node:crypto'
import Schema from '@deepseek-ai/schemastery'
import type { AssetCandidate, AssetCommand, AssetEntry, AssetMedia, AssetProposal, ProposalId, AssetSnapshot, AssetState, AssetVersion, PromptEdit, SourcePin } from './types.ts'
import { fingerprint, report } from './report.ts'

/** Size and listing limits for report, journal, and media reads. */
export interface Config { readonly maxBytes: number; readonly maxEntries: number; readonly maxMediaBytes: number }
export const Config: Schema<Config> = Schema.object({
  maxBytes: Schema.number().step(1).min(1).required(),
  maxEntries: Schema.number().step(1).min(1).required(),
  maxMediaBytes: Schema.number().step(1).min(1).required(),
})
declare module '@deepseek-ai/cordis' { interface Context { manturAssets: ManturAssets } }

const emptyState = (path: string): AssetState => ({ format: 1, path, drafts: [], proposals: [], history: [], pending: null })
const mediaKind = (name: string): 'image' | 'video' | undefined => /\.(png|jpe?g|webp|gif)$/i.test(name) ? 'image' : /\.(mp4|webm|mov)$/i.test(name) ? 'video' : undefined
function mediaType(bytes: Uint8Array, name: string): { kind: 'image' | 'video'; type: string } | undefined {
  if (bytes.length >= 8 && bytes.slice(0, 8).every((value, index) => value === [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][index])) return { kind: 'image', type: 'image/png' }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { kind: 'image', type: 'image/jpeg' }
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return { kind: 'image', type: 'image/webp' }
  if (bytes.length >= 6 && String.fromCharCode(...bytes.slice(0, 6)).startsWith('GIF8')) return { kind: 'image', type: 'image/gif' }
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return { kind: 'video', type: 'video/webm' }
  if (bytes.length >= 8 && String.fromCharCode(...bytes.slice(4, 8)) === 'ftyp') return { kind: 'video', type: name.toLowerCase().endsWith('.webm') ? 'video/webm' : 'video/mp4' }
  return undefined
}

/** Host service. Each write is source-CAS guarded and journals recovery before replacement. */
export class ManturAssets extends TypertRemoteService {
  static inject = ['typert', 'fs', 'tools', 'connection']
  static Config = Config
  private readonly sessions = new WeakMap<object, { source: SourcePin; stateFile: string; media: Map<string, { path: string; sha: string; type: string }>; tokens: Map<string, string> }>()
  private readonly mediaTokens = new Map<string, { session: object; path: string; sha: string; type: string }>()
  private readonly disposedSessions = new WeakSet<object>()
  private closed = false
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'manturAssets', { namespace: 'manturAssets' })
    ctx.effect(() => this.registerMediaRoute(ctx), 'manturAssets: media route')
    ctx.effect(() => () => { this.closed = true; this.mediaTokens.clear() }, 'manturAssets: media tokens')
    ctx.on('session/disposed', (session) => { this.disposedSessions.add(session); this.invalidateMedia(session) })
    ctx.tools.register(defineTool({
      name: 'propose_asset_prompts', description: 'Record a text-only asset prompt proposal for the current requested source. This never generates media or writes a pipeline report.',
      parameters: { requestId: { type: 'string', required: true }, source: { type: 'string', required: true }, edits: { type: 'string', required: true } },
      output: { schema: { type: 'string' }, render: (_a, value) => [{ type: 'text', text: value }] },
      execute: async (args, exec) => JSON.stringify(await this.propose(exec.agent, args.requestId, args.source, JSON.parse(args.edits))),
      presentCall: args => ({ card: 'generic', title: 'Asset prompt proposal', kind: 'other', subtitle: args.requestId }),
    }))
  }
  /**
   * List project-local report and media files for manual selection.
   * @param agent - Owning Session.
   * @param directory - Project-local folder path.
   * @returns Direct visible child entries.
   */
  @Remote('list') async list(agent: Agent, directory: string): Promise<AssetEntry[]> {
    const target = await this.target(agent, directory || '.', false); const entries = await this.ctx.fs.listDir(target)
    if (entries.length > this.config.maxEntries) throw new Error('Folder exceeds asset entry limit')
    return entries.filter(item => !item.name.startsWith('.') && (item.type === 'directory' || /\.(json|png|jpe?g|webp|mp4|webm)$/i.test(item.name))).map(item => ({ path: item.target.displayPath, name: item.name, directory: item.type === 'directory' }))
  }
  /**
   * Discover previewable media candidates in one project-local folder.
   * @param agent - Owning Session with a loaded report.
   * @param directory - Project-local candidate folder.
   * @returns Direct child media files whose bytes match a supported media signature.
   */
  @Remote('candidates') async candidates(agent: Agent, directory: string): Promise<AssetCandidate[]> {
    const info = await this.session(agent); const source = await this.require(agent, info.source)
    const rows = report(await this.read(source.path, this.config.maxBytes)).rows
    const knownIds = rows.map(row => row.id)
    const target = await this.target(agent, directory || '.', false); const entries = await this.ctx.fs.listDir(target)
    if (entries.length > this.config.maxEntries) throw new Error('Folder exceeds asset entry limit')
    const candidates: AssetCandidate[] = []
    for (const item of entries.filter(value => value.type === 'file' && !value.name.startsWith('.') && mediaKind(value.name) !== undefined)) {
      let detected: { kind: 'image' | 'video'; type: string } | undefined
      try {
        detected = mediaType(await this.ctx.fs.readBytes(item.target, undefined, this.config.maxMediaBytes), item.name)
      } catch (error) {
        if (!(error instanceof FsError) || error.code !== 'FS_TOO_LARGE') throw error
      }
      if (detected === undefined) continue
      candidates.push({
        assetId: knownIds.filter(id => item.name === id || item.name.startsWith(`${id}-`)).sort((a, b) => b.length - a.length)[0] ?? null,
        path: item.target.displayPath, name: item.name, kind: detected.kind, size: item.size ?? 0,
      })
    }
    return candidates
  }
  /**
   * Load one pipeline report and optional explicit media manifest.
   * @param agent - Owning Session.
   * @param assetsPath - Project-local report path.
   * @param _clipsPath - Reserved clip-report path kept for Remote compatibility.
   * @param mediaManifest - Optional project-local manifest with SHA-256 pinned files.
   * @returns Current report rows plus journal state.
   */
  @Remote('load') async load(agent: Agent, assetsPath: string, _clipsPath?: string, mediaManifest?: string): Promise<AssetSnapshot> {
    this.assertLive(agent.session)
    this.invalidateMedia(agent.session)
    const source = await this.pin(agent, assetsPath); const sourceText = await this.read(source.path, this.config.maxBytes)
    report(sourceText); const root = await this.ctx.fs.resolve(this.cwd(agent)); const stateFile = `${root.displayPath}/.mantur-assets-${fingerprint(source.path).slice(0, 16)}.json`
    const media = new Map<string, { path: string; sha: string; type: string }>()
    if (mediaManifest !== undefined) {
      const manifest = JSON.parse(await this.read((await this.pin(agent, mediaManifest)).path, this.config.maxBytes)) as unknown
      if (!Array.isArray(manifest)) throw new Error('Media manifest must be an array')
      for (const item of manifest) { if (!item || typeof item !== 'object') throw new Error('Invalid media manifest row'); const row = item as Record<string, unknown>; if (typeof row.clip_id !== 'string' || typeof row.file !== 'string') throw new Error('Media manifest requires clip_id and file'); if (typeof row.sha256 !== 'string' || !/^[a-fA-F0-9]{64}$/.test(row.sha256)) throw new Error('Media manifest requires a SHA-256 digest'); const target = await this.target(agent, row.file, true); const stat = await this.ctx.fs.stat(target); if (stat?.type !== 'file') throw new Error('Media file missing'); media.set(row.clip_id, { path: target.displayPath, sha: row.sha256.toLowerCase(), type: 'video/mp4' }) }
    }
    this.assertLive(agent.session)
    this.sessions.set(agent.session as object, { source, stateFile, media, tokens: new Map() })
    return this.snapshot(agent, source)
  }
  /**
   * Persist selected prompt edits without modifying the source report.
   * @param agent - Owning Session.
   * @param command - Source pin, journal version, and selected edits.
   * @returns Updated report and journal observation.
   */
  @Remote('saveDraft') async saveDraft(agent: Agent, command: AssetCommand): Promise<AssetSnapshot> { const current = await this.require(agent, command.source); const snapshot = await this.snapshot(agent, current); if (snapshot.stateVersion !== command.stateVersion) throw new FsError('Asset journal changed; reload before saving.', 'FS_STALE_VERSION'); if (snapshot.state.pending !== null) throw new Error('An unfinished source write requires recovery'); const draft = { revision: (snapshot.state.drafts.at(-1)?.revision ?? 0) + 1, source: current, edits: command.edits }; snapshot.state.drafts.push(draft); await this.writeState(agent, current, snapshot.state, snapshot.stateVersion); return this.snapshot(agent, current) }
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
  /**
   * Commit an approved proposal with an exclusive journal generation.
   * @param agent - Owning Session.
   * @param requestId - Proposal to apply.
   * @returns Current disk observation after both writes complete.
   */
  @Remote('apply')
  async apply(agent: Agent, requestId: string): Promise<AssetSnapshot> {
    const info = await this.session(agent)
    const version = await this.stateVersion(agent)
    const state = await this.readState(info.stateFile, info.source.path)
    if (state.pending !== null) throw new Error('An unfinished source write requires recovery')
    const proposal = state.proposals.find(item => item.id === requestId)
    if (proposal?.status !== 'proposed') throw new Error('Only an Agent proposal can be applied')
    const current = await this.require(agent, proposal.source)
    const text = await this.read(current.path, this.config.maxBytes)
    if (fingerprint(text) !== current.sha256) throw new FsError('Source changed before applying.', 'FS_STALE_VERSION')
    const next = report(text).replace(proposal.edits)
    state.pending = { proposal: proposal.id, source: current, afterText: next, afterSha: fingerprint(next) }
    const reserved = await this.writeState(agent, current, state, version)
    await this.ctx.fs.writeText(await this.target(agent, current.path, true), next, {
      kind: 'replaceIfVersion', version: current.version,
    })
    return this.finishWrite(agent, state, reserved)
  }

  /**
   * Retry only the exact pending write or finalize its already-written bytes.
   * @param agent - Session reopening the selected report.
   * @param expected - Journal generation shown by the recovery UI.
   * @returns Completed state; conflicting source bytes remain untouched.
   */
  @Remote('recover')
  async recover(agent: Agent, expected: AssetVersion): Promise<AssetSnapshot> {
    const info = await this.session(agent)
    if (await this.stateVersion(agent) !== expected) throw new FsError('Asset journal changed.', 'FS_STALE_VERSION')
    const state = await this.readState(info.stateFile, info.source.path)
    const pending = state.pending
    if (pending === null) throw new Error('No unfinished asset write')
    if (pending.source.path !== state.path || fingerprint(pending.afterText) !== pending.afterSha) {
      throw new Error('Invalid pending asset write')
    }
    const current = await this.pin(agent, state.path)
    if (current.sha256 !== pending.afterSha && (current.sha256 !== pending.source.sha256
      || current.version !== pending.source.version)) {
      throw new FsError('Source changed outside the pending write; recovery refused.', 'FS_STALE_VERSION')
    }
    // Reserve this journal generation before either retrying or completing it.
    const reserved = await this.writeState(agent, current, state, expected)
    if (current.sha256 !== pending.afterSha) {
      await this.ctx.fs.writeText(await this.target(agent, state.path, true), pending.afterText, {
        kind: 'replaceIfVersion', version: current.version,
      })
    }
    return this.finishWrite(agent, state, reserved)
  }

  private async finishWrite(agent: Agent, state: AssetState, reserved: AssetVersion): Promise<AssetSnapshot> {
    const pending = state.pending
    if (pending === null) throw new Error('Missing pending asset write')
    const current = await this.pin(agent, state.path)
    if (current.sha256 !== pending.afterSha) throw new FsError('Written source changed before completion.', 'FS_STALE_VERSION')
    const proposal = state.proposals.find(item => item.id === pending.proposal)
    if (proposal?.status !== 'proposed') throw new Error('Pending proposal is unavailable')
    proposal.status = 'applied'
    state.history.push({ id: proposal.id, before: proposal.before, after: proposal.edits,
      beforeSha: pending.source.sha256, afterSha: pending.afterSha })
    state.pending = null
    await this.writeState(agent, current, state, reserved)
    return this.snapshot(agent, current)
  }
  /**
   * Record the Agent's text-only response to a prepared proposal request.
   * @param agent - Owning Session.
   * @param requestId - Prepared proposal id.
   * @param source - Source report path echoed by the request.
   * @param edits - Prompt edits returned by the Agent.
   * @returns Proposal after validation.
   */
  @Remote('propose') async proposeRemote(agent: Agent, requestId: string, source: string, edits: PromptEdit[]): Promise<AssetProposal> { return this.propose(agent, requestId, source, edits) }
  /**
   * Resolve explicitly manifested media by asset or clip id.
   * @param agent - Owning Session.
   * @param id - Manifest id to preview.
   * @returns Session-scoped media URL.
   */
  @Remote('media') async media(agent: Agent, id: string): Promise<AssetMedia> {
    const info = await this.session(agent)
    this.assertLive(agent.session)
    if (this.sessions.get(agent.session) !== info) throw new Error('Media manifest changed; reload media')
    const row = info.media.get(id)
    if (!row) throw new Error('Media has no explicit manifest binding')
    const token = info.tokens.get(id) ?? randomUUID()
    info.tokens.set(id, token)
    this.mediaTokens.set(token, { session: agent.session as object, ...row })
    return { id, name: row.path.split('/').at(-1) ?? id, url: `/api/mantur-assets.media?token=${encodeURIComponent(token)}`, kind: row.type.startsWith('image/') ? 'image' : 'video' }
  }
  /**
   * Resolve one discovered candidate path into a validated preview URL.
   * @param agent - Owning Session.
   * @param path - Project-local candidate file path.
   * @returns Session-scoped media URL.
   */
  @Remote('preview') async preview(agent: Agent, path: string): Promise<AssetMedia> {
    const info = await this.session(agent); const target = await this.target(agent, path, true); const stat = await this.ctx.fs.stat(target)
    if (stat?.type !== 'file') throw new Error('Media candidate is not a file')
    const bytes = await this.ctx.fs.readBytes(target, undefined, this.config.maxMediaBytes)
    const detected = mediaType(bytes, target.displayPath)
    if (detected === undefined) throw new Error('Media candidate has an unsupported file format')
    const key = `path:${target.displayPath}`; const token = info.tokens.get(key) ?? randomUUID(); info.tokens.set(key, token)
    this.mediaTokens.set(token, { session: agent.session as object, path: target.displayPath, sha: fingerprint(bytes), type: detected.type })
    return { id: null, name: target.displayPath.split('/').at(-1) ?? target.displayPath, url: `/api/mantur-assets.media?token=${encodeURIComponent(token)}`, kind: detected.kind }
  }
  private registerMediaRoute(ctx: Context): () => void {
    const connection = Reflect.get(ctx, 'connection') as {
      fetch: { register: (route: { path: string; methods: readonly ('GET' | 'HEAD')[]; fetch: (request: Request) => Promise<Response> }) => () => void }
    }
    return connection.fetch.register({
      path: '/api/mantur-assets.media', methods: ['GET', 'HEAD'],
      fetch: async request => this.mediaResponse(ctx, request),
    })
  }
  private async mediaResponse(ctx: Context, request: Request): Promise<Response> {
    const token = new URL(request.url).searchParams.get('token')
    const entry = token === null ? undefined : this.mediaTokens.get(token)
    if (entry === undefined) return new Response('media token is invalid', { status: 404 })
    try {
      const target = await ctx.fs.resolve(entry.path)
      const stat = await ctx.fs.stat(target)
      if (stat?.type !== 'file') return new Response('media is unavailable', { status: 404 })
      const bytes = await ctx.fs.readBytes(target, undefined, this.config.maxMediaBytes)
      if (!this.mediaTokens.has(token ?? '') ) return new Response('media token is invalid', { status: 404 })
      if (fingerprint(bytes) !== entry.sha) return new Response('media fingerprint changed', { status: 409 })
      const type = entry.type || 'application/octet-stream'
      const range = request.headers.get('range')
      let start = 0; let end = bytes.byteLength - 1; let status = 200
      if (range !== null) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range)
        if (!match) return new Response('invalid range', { status: 416 })
        const first = match[1] ?? ''; const last = match[2] ?? ''
        if (first === '') {
          const suffix = Number(last)
          if (!Number.isSafeInteger(suffix) || suffix <= 0) return new Response('range is unsatisfiable', { status: 416 })
          start = Math.max(0, bytes.byteLength - suffix)
        } else {
          start = Number(first)
          const requestedEnd = last === '' ? end : Number(last)
          if (!Number.isSafeInteger(requestedEnd) || requestedEnd < start) return new Response('range is unsatisfiable', { status: 416 })
          end = Math.min(end, requestedEnd)
        }
        if (!Number.isSafeInteger(start) || start < 0 || start > end) return new Response('range is unsatisfiable', { status: 416 })
        status = 206
      }
      const body = bytes.slice(start, end + 1)
      const headers = new Headers({ 'content-type': type, 'content-length': String(body.byteLength), 'accept-ranges': 'bytes' })
      if (status === 206) headers.set('content-range', `bytes ${start}-${end}/${bytes.byteLength}`)
      if (request.method === 'HEAD') return new Response(null, { status, headers })
      return new Response(body as BodyInit, { status, headers })
    } catch (error) {
      if (error instanceof Error && /too large|limit/i.test(error.message)) return new Response('media exceeds the configured size limit', { status: 413 })
      return new Response('media is unavailable', { status: 404 })
    }
  }
  private async propose(agent: Agent | undefined, requestId: string, source: string, edits: PromptEdit[]): Promise<AssetProposal> {
    if (!agent) throw new Error('Asset proposal requires an owning Agent')
    const info = await this.session(agent); const expected = await this.stateVersion(agent)
    const state = await this.readState(info.stateFile, source)
    if (state.pending !== null) throw new Error('An unfinished source write requires recovery')
    const proposal = state.proposals.find(item => String(item.id) === requestId)
    if (!proposal || proposal.status !== 'requested') throw new Error('Unknown or completed asset request')
    if (edits.length !== proposal.before.length || new Set(edits.map(edit => edit.key)).size !== edits.length
      || edits.some(edit => proposal.before.every(before => before.key !== edit.key || before.fingerprint !== edit.fingerprint))) {
      throw new Error('Agent proposal targets do not match the requested rows')
    }
    proposal.edits = edits; proposal.status = 'proposed'
    await this.writeState(agent, proposal.source, state, expected); return proposal
  }
  private async snapshot(agent: Agent, source: SourcePin): Promise<AssetSnapshot> {
    const current = await this.pin(agent, source.path)
    const text = await this.read(current.path, this.config.maxBytes)
    if (fingerprint(text) !== current.sha256) throw new FsError('Source changed while reading.', 'FS_STALE_VERSION')
    const stateFile = (await this.session(agent)).stateFile
    const version = await this.stateVersion(agent)
    const state = await this.readState(stateFile, current.path)
    if (await this.stateVersion(agent) !== version) throw new FsError('Journal changed while reading.', 'FS_STALE_VERSION')
    return { source: current, stateVersion: version, state, rows: report(text).rows, projectState: null }
  }
  private async stateVersion(agent: Agent) {
    return (await this.ctx.fs.stat(await this.target(agent, (await this.session(agent)).stateFile, true)))?.version ?? null
  }
  private async writeState(agent: Agent, _source: SourcePin, state: AssetState, expected: AssetVersion | null): Promise<AssetVersion> {
    const target = await this.target(agent, (await this.session(agent)).stateFile, true)
    const text = JSON.stringify(state, null, 2) + '\n'
    if (Buffer.byteLength(text) > this.config.maxBytes) throw new FsError('Asset journal exceeds its size limit.', 'FS_TOO_LARGE')
    const result = await this.ctx.fs.writeText(target, text, expected === null
      ? { kind: 'createIfAbsent' } : { kind: 'replaceIfVersion', version: expected })
    return result.version
  }
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
  private assertLive(session: object) {
    if (this.closed || this.disposedSessions.has(session)) throw new Error('Asset Session or provider is disposed')
  }
  private invalidateMedia(session: object) {
    const info = this.sessions.get(session)
    if (info) for (const token of info.tokens.values()) this.mediaTokens.delete(token)
    this.sessions.delete(session)
  }
  private async session(agent: Agent) { this.assertLive(agent.session); const found = this.sessions.get(agent.session as object); if (!found) throw new Error('Load an asset project first'); return found }
  private async require(agent: Agent, source: SourcePin) { const current = await this.pin(agent, source.path); if (current.sha256 !== source.sha256 || current.version !== source.version) throw new FsError('Source changed; reload before editing.', 'FS_STALE_VERSION'); return current }
}
export default ManturAssets
