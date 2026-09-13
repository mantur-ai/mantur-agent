/** Project containment, media access and persisted asset-journal rejection. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import Tools from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Assets from '../src/index.ts'
import { fingerprint } from '../src/report.ts'

let ctx: Context
let root: string
let agent: Agent
let route: (request: Request) => Promise<Response>
let journal: string
const source = JSON.stringify({ schema_version: '1.0', 角色资产: [
  { 资产ID: 'CHAR-1', 角色名: '角色', 角色提示词: '原提示词', 负面提示词: '' },
], 场景资产: [], 道具资产: [] })
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mantur-assets-guard-'))
  ctx = new Context()
  await writeFile(join(root, 'assets.json'), source)
  journal = join(root, `.mantur-assets-${fingerprint(join(root, 'assets.json')).slice(0, 16)}.json`)
  ctx.provide('typert', {} as never)
  ctx.provide('connection', { fetch: { register: (entry: { fetch: typeof route }) => {
    route = entry.fetch
    return () => {}
  } } } as never)
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
  await ctx.plugin(Tools)
  await ctx.plugin(LocalFileSystem, { cwd: root })
  await ctx.plugin(Assets, { maxBytes: 4096, maxEntries: 20, maxMediaBytes: 64 })
  agent = { ctx, session: { id: 'assets-test', header: { cwd: root } } } as unknown as Agent
})
afterEach(async () => {
  vi.restoreAllMocks()
  try { await ctx.fiber.dispose() }
  finally { await rm(root, { recursive: true, force: true }) }
})

it('lists only direct visible assets and rejects excessive folders or missing project ownership', async () => {
  await mkdir(join(root, 'folder'))
  await writeFile(join(root, '.private.json'), '{}')
  await writeFile(join(root, 'script.md'), '# script')
  expect((await ctx.manturAssets.list(agent, '')).map(entry => entry.name).sort()).toEqual(['assets.json', 'folder'])
  await expect(ctx.manturAssets.list({ session: { header: {} } } as Agent, '')).rejects.toThrow('project directory')
  await expect(ctx.manturAssets.load(agent, '../outside.json')).rejects.toMatchObject({ code: 'FS_PERMISSION_DENIED' })
  await expect(ctx.manturAssets.load(agent, 'folder')).rejects.toThrow('not a file')
  await expect(ctx.manturAssets.preview(agent, 'missing.png')).rejects.toThrow('Load an asset project')
  for (let index = 0; index < 21; index++) await writeFile(join(root, `extra-${index}.json`), '{}')
  await expect(ctx.manturAssets.list(agent, '')).rejects.toThrow('entry limit')
  await ctx.manturAssets.load(agent, 'assets.json')
  await expect(ctx.manturAssets.candidates(agent, '')).rejects.toThrow('entry limit')
})

it.each([
  ['jpeg.jpg', [255, 216, 255], 'image/jpeg', 'image'],
  ['webp.webp', [...Buffer.from('RIFF0000WEBP')], 'image/webp', 'image'],
  ['gif.gif', [...Buffer.from('GIF89a')], 'image/gif', 'image'],
  ['video.webm', [26, 69, 223, 163], 'video/webm', 'video'],
  ['container.webm', [...Buffer.from('0000ftyp')], 'video/webm', 'video'],
] as const)('detects %s from bounded file bytes and reuses its preview token', async (name, bytes, type, kind) => {
  await writeFile(join(root, name), Buffer.from(bytes))
  await ctx.manturAssets.load(agent, 'assets.json')
  const first = await ctx.manturAssets.preview(agent, name)
  expect(first.kind).toBe(kind)
  expect((await ctx.manturAssets.preview(agent, name)).url).toBe(first.url)
  const response = await route(new Request(new URL(first.url, 'http://127.0.0.1')))
  expect(response.headers.get('content-type')).toBe(type)
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(Uint8Array.from(bytes))
})

it('rejects fake media and missing files while omitting over-limit candidate files', async () => {
  await ctx.manturAssets.load(agent, 'assets.json')
  await writeFile(join(root, 'fake.png'), 'not an image')
  await writeFile(join(root, 'large.png'), Buffer.alloc(65))
  await mkdir(join(root, 'nested'))
  await expect(ctx.manturAssets.preview(agent, 'fake.png')).rejects.toThrow('unsupported file format')
  await expect(ctx.manturAssets.preview(agent, 'missing.png')).rejects.toThrow('not a file')
  expect(await ctx.manturAssets.candidates(agent, '')).toEqual([])
  const real = ctx.fs.readBytes.bind(ctx.fs)
  const read = vi.spyOn(ctx.fs, 'readBytes')
  read.mockImplementation((target, ...args) => target.displayPath.endsWith('fake.png')
    ? Promise.reject(new Error('filesystem offline')) : real(target, ...args))
  await expect(ctx.manturAssets.candidates(agent, '')).rejects.toThrow('filesystem offline')
})

it.each([null, {}, [null], [{}], [{ clip_id: 'one', file: 'one.mp4' }],
  [{ clip_id: 'one', file: 'missing.mp4', sha256: '0'.repeat(64) }]])('rejects malformed media manifest %#', async (manifest) => {
  await writeFile(join(root, 'media.json'), JSON.stringify(manifest))
  await expect(ctx.manturAssets.load(agent, 'assets.json', undefined, 'media.json')).rejects.toThrow()
})

it('serves bounded byte ranges and withdraws missing or no-longer-readable media', async () => {
  await writeFile(join(root, 'image.png'), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  await ctx.manturAssets.load(agent, 'assets.json')
  const media = await ctx.manturAssets.preview(agent, 'image.png')
  const url = new URL(media.url, 'http://127.0.0.1')
  for (const range of ['items=0-1', 'bytes=-0', 'bytes=3-1', 'bytes=99-', 'bytes=-9999999999999999999999', 'bytes=0-9999999999999999999999']) {
    expect((await route(new Request(url, { headers: { range } }))).status).toBe(416)
  }
  const suffix = await route(new Request(url, { headers: { range: 'bytes=-2' } }))
  expect(suffix.headers.get('content-range')).toBe('bytes 6-7/8')
  expect(new Uint8Array(await suffix.arrayBuffer())).toEqual(Uint8Array.from([26, 10]))
  const open = await route(new Request(url, { method: 'HEAD', headers: { range: 'bytes=1-' } }))
  expect(open.status).toBe(206)
  expect(open.headers.get('content-length')).toBe('7')
  expect(await open.text()).toBe('')
  const read = vi.spyOn(ctx.fs, 'readBytes').mockRejectedValueOnce(new Error('read limit reached'))
  expect((await route(new Request(url))).status).toBe(413)
  read.mockRejectedValueOnce(new Error('filesystem offline'))
  expect((await route(new Request(url))).status).toBe(404)
  read.mockRestore()
  await rm(join(root, 'image.png'))
  expect((await route(new Request(url))).status).toBe(404)
  expect((await route(new Request('http://127.0.0.1/api/mantur-assets.media'))).status).toBe(404)
})

it.each([null, [], {}, { format: 2 }, { format: 1, drafts: [], proposals: [], history: [] }])('refuses invalid persisted journal %#', async (state) => {
  await writeFile(journal, JSON.stringify(state))
  await expect(ctx.manturAssets.load(agent, 'assets.json')).rejects.toThrow()
  expect(await readFile(join(root, 'assets.json'), 'utf8')).toBe(source)
})

it('refuses directory journals, absent proposals and stale journal writes without touching the report', async () => {
  await mkdir(journal)
  await expect(ctx.manturAssets.load(agent, 'assets.json')).rejects.toMatchObject({ code: 'FS_NOT_REGULAR_FILE' })
  await rm(journal, { recursive: true })
  const loaded = await ctx.manturAssets.load(agent, 'assets.json')
  await expect(ctx.manturAssets.apply(agent, 'missing')).rejects.toThrow('Only an Agent proposal')
  await expect(ctx.manturAssets.recover(agent, 'stale' as never)).rejects.toMatchObject({ code: 'FS_STALE_VERSION' })
  const saved = await ctx.manturAssets.saveDraft(agent, { source: loaded.source, stateVersion: loaded.stateVersion, edits: [] })
  if (saved.stateVersion === null) throw new Error('Expected a saved journal version')
  await expect(ctx.manturAssets.recover(agent, saved.stateVersion)).rejects.toThrow('No unfinished')
  await expect(ctx.manturAssets.saveDraft(agent, { source: loaded.source, stateVersion: 'stale' as never, edits: [] })).rejects.toMatchObject({ code: 'FS_STALE_VERSION' })
  const call = await ctx.tools.execute({ name: 'propose_asset_prompts', arguments: { requestId: 'missing', source: loaded.source.path, edits: '[]' },
    callId: ToolCallId('unknown-proposal'), agent, signal: new AbortController().signal })
  expect(call.isError).toBe(true)
  expect(await readFile(join(root, 'assets.json'), 'utf8')).toBe(source)
})

it('records only an exact requested proposal through the tool and renders its confirmation', async () => {
  const loaded = await ctx.manturAssets.load(agent, 'assets.json')
  const row = loaded.rows[0]!
  const edits = [{ key: row.key, fingerprint: row.fingerprint, prompt: 'new prompt', negative: '' }]
  const request = await ctx.manturAssets.prepare(agent, loaded.source, edits, 'revise')
  const tool = ctx.tools.get('propose_asset_prompts')!
  const args = { requestId: request.requestId, source: request.source.path, edits: JSON.stringify(edits) }
  expect(tool.presentCall?.(args)).toMatchObject({ title: 'Asset prompt proposal', subtitle: request.requestId })
  await expect(ctx.manturAssets.proposeRemote(agent, request.requestId, request.source.path, [])).rejects.toThrow('targets do not match')
  await expect(ctx.manturAssets.proposeRemote(agent, request.requestId, request.source.path, [
    { ...edits[0]!, fingerprint: 'stale' },
  ])).rejects.toThrow('targets do not match')
  const result = await ctx.tools.execute({ name: 'propose_asset_prompts', arguments: args,
    callId: ToolCallId('accepted-proposal'), agent, signal: new AbortController().signal })
  expect(result.isError).toBe(false)
  expect(JSON.stringify(result.content)).toContain('proposed')
  expect(await readFile(join(root, 'assets.json'), 'utf8')).toBe(source)
  const missingAgent = await ctx.tools.execute({ name: 'propose_asset_prompts', arguments: args,
    callId: ToolCallId('agent-required'), signal: new AbortController().signal })
  expect(missingAgent.isError).toBe(true)
  expect(JSON.stringify(missingAgent.content)).toContain('owning Agent')
})

it('requires the loaded source and bounds journal writes', async () => {
  const loaded = await ctx.manturAssets.load(agent, 'assets.json')
  await writeFile(join(root, 'other.json'), source)
  const other = await ctx.manturAssets.load({ ctx, session: { id: 'other-session', header: { cwd: root } } } as unknown as Agent, 'other.json')
  await expect(ctx.manturAssets.prepare(agent, other.source, [], 'wrong loaded source')).rejects.toThrow('Load the selected source')
  const row = loaded.rows[0]!
  await expect(ctx.manturAssets.saveDraft(agent, { source: loaded.source, stateVersion: null,
    edits: [{ key: row.key, fingerprint: row.fingerprint, prompt: 'x'.repeat(5000), negative: '' }],
  })).rejects.toMatchObject({ code: 'FS_TOO_LARGE' })
})

it.each(['drafts', 'proposals', 'history', 'pending', 'path'])('rejects an incompatible persisted %s field', async (field) => {
  const state: Record<string, unknown> = { format: 1, path: join(root, 'assets.json'), drafts: [], proposals: [], history: [], pending: null }
  if (field === 'pending') delete state.pending
  else state[field] = 7
  await writeFile(journal, JSON.stringify(state))
  await expect(ctx.manturAssets.load(agent, 'assets.json')).rejects.toThrow('Unsupported or mismatched')
})

it('withdraws media during report reload and rejects a disposed Session', async () => {
  await ctx.manturAssets.load(agent, 'assets.json')
  await expect(ctx.manturAssets.media(agent, 'missing')).rejects.toThrow('no explicit manifest')
  const pending = ctx.manturAssets.media(agent, 'missing')
  const rejected = expect(pending).rejects.toThrow('manifest changed')
  const reloaded = ctx.manturAssets.load(agent, 'assets.json')
  await rejected
  await reloaded
  ctx.emit('session/disposed', agent.session)
  await expect(ctx.manturAssets.load(agent, 'assets.json')).rejects.toThrow('disposed')
})

it.each(['source', 'journal'] as const)('refuses a %s changed between its byte read and final version observation', async (which) => {
  if (which === 'journal') await writeFile(journal, JSON.stringify({ format: 1, path: join(root, 'assets.json'), drafts: [], proposals: [], history: [], pending: null }))
  const path = which === 'source' ? join(root, 'assets.json') : journal
  const real = ctx.fs.readBytes.bind(ctx.fs)
  let changed = false
  vi.spyOn(ctx.fs, 'readBytes').mockImplementation(async (target, ...args) => {
    const bytes = await real(target, ...args)
    if (!changed && target.displayPath === path) {
      changed = true
      await writeFile(path, Buffer.concat([bytes, Buffer.from(' ')]))
    }
    return bytes
  })
  await expect(ctx.manturAssets.load(agent, 'assets.json')).rejects.toMatchObject({ code: 'FS_STALE_VERSION' })
  expect(changed).toBe(true)
})

it.each(['prepare', 'apply', 'snapshot'] as const)('rejects source replacement after the %s pin was observed', async (operation) => {
  const loaded = await ctx.manturAssets.load(agent, 'assets.json')
  const row = loaded.rows[0]!
  const edits = [{ key: row.key, fingerprint: row.fingerprint, prompt: 'new prompt', negative: '' }]
  const request = await ctx.manturAssets.prepare(agent, loaded.source, edits, 'revise')
  await ctx.manturAssets.proposeRemote(agent, request.requestId, request.source.path, edits)
  const real = ctx.fs.readBytes.bind(ctx.fs)
  let reads = 0
  vi.spyOn(ctx.fs, 'readBytes').mockImplementation(async (target, ...args) => {
    if (target.displayPath === loaded.source.path && ++reads === (operation === 'snapshot' ? 4 : 2)) {
      await writeFile(loaded.source.path, source.replace('原提示词', 'external replacement'))
    }
    return real(target, ...args)
  })
  const work = operation === 'snapshot' ? ctx.manturAssets.load(agent, 'assets.json')
    : operation === 'prepare' ? ctx.manturAssets.prepare(agent, loaded.source, edits, 'revise')
      : ctx.manturAssets.apply(agent, request.requestId)
  await expect(work).rejects.toMatchObject({ code: 'FS_STALE_VERSION' })
  expect(await readFile(loaded.source.path, 'utf8')).toContain('external replacement')
})
