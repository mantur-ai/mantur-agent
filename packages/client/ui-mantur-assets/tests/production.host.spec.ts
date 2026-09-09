/* oxlint-disable @stylistic/max-len -- acceptance setup keeps source paths explicit. */
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import Tools from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Assets from '../src/index.ts'
import { fingerprint } from '../src/report.ts'
import { expect, it, vi } from 'vitest'

const real = '/Volumes/新磁盘/dsh/青春里的甜蜜风暴2_EP31_验收_2026-09-06'
const assets = join(real, '资产/资产提取结果/assets-report.json')
function connection() {
  let route: { fetch: (request: Request) => Promise<Response> } | undefined
  return { service: { fetch: { register: (value: { fetch: (request: Request) => Promise<Response> }) => { route = value; return () => { route = undefined } } } }, get: () => route }
}

it('reads real reports, saves a guarded draft, applies a proposal, and refuses a stale source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-assets-production-'))
  const ctx = new Context()
  try {
    await cp(assets, join(root, 'assets-report.json'))
    const transport = connection(); ctx.provide('connection', transport.service as never); ctx.provide('typert', {} as never); await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false }); await ctx.plugin(Tools)
    await ctx.plugin(LocalFileSystem, { cwd: root }); await ctx.plugin(Assets, { maxBytes: 9_000_000, maxEntries: 100, maxMediaBytes: 50_000_000 })
    const agent = { ctx, session: { header: { cwd: root } } } as never
    const first = await ctx.manturAssets.load(agent, 'assets-report.json')
    expect(first.rows).toHaveLength(43); expect(first.rows.every(row => row.media === '')).toBe(true)
    const row = first.rows.find(value => value.table === '角色资产')!
    const draft = await ctx.manturAssets.saveDraft(agent, { source: first.source, stateVersion: first.stateVersion, edits: [{ key: row.key, fingerprint: row.fingerprint, prompt: `${row.prompt}，保持验收构图`, negative: row.negative }] })
    const request = await ctx.manturAssets.prepare(agent, draft.source, draft.state.drafts.at(-1)!.edits, '只提出提示词修改，不生成媒体')
    const proposal = await ctx.manturAssets.proposeRemote(agent, request.requestId, request.source.path, request.edits.map(edit => ({ ...edit, prompt: `${edit.prompt}，提案版` })))
    expect(proposal.status).toBe('proposed')
    const applied = await ctx.manturAssets.apply(agent, request.requestId)
    expect(applied.rows.find(value => value.key === row.key)?.prompt).toContain('提案版')
    await writeFile(join(root, 'assets-report.json'), (await readFile(join(root, 'assets-report.json'), 'utf8')).replace('提案版', '外部修改'))
    await expect(ctx.manturAssets.saveDraft(agent, { source: applied.source, stateVersion: applied.stateVersion, edits: [] })).rejects.toMatchObject({ code: 'FS_STALE_VERSION' })
  } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
})

it('fails loudly on a malformed journal instead of replacing it with an empty state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-assets-journal-'))
  const ctx = new Context()
  try {
    await cp(assets, join(root, 'assets-report.json'))
    const transport = connection(); ctx.provide('connection', transport.service as never); ctx.provide('typert', {} as never); await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false }); await ctx.plugin(Tools)
    await ctx.plugin(LocalFileSystem, { cwd: root }); await ctx.plugin(Assets, { maxBytes: 9_000_000, maxEntries: 100, maxMediaBytes: 50_000_000 })
    const absolute = join(root, 'assets-report.json')
    await writeFile(join(root, `.mantur-assets-${fingerprint(absolute).slice(0, 16)}.json`), '{broken')
    const agent = { ctx, session: { id: 'journal-session', header: { cwd: root } } } as never
    await expect(ctx.manturAssets.load(agent, 'assets-report.json')).rejects.toThrow(/JSON/)
  } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
})

it('serves only explicitly manifested media and rejects unknown tokens and changed bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-assets-media-'))
  const ctx = new Context()
  try {
    const media = join(root, 'CLIP-001.mp4'); const bytes = Buffer.from('isolated-media')
    await writeFile(media, bytes); await writeFile(join(root, 'assets-report.json'), JSON.stringify({ schema_version: '1.0', '角色资产': [], '场景资产': [], '道具资产': [] }))
    await writeFile(join(root, 'manifest.json'), JSON.stringify([{ clip_id: 'CLIP-001', file: media, sha256: fingerprint(bytes) }]))
    const transport = connection(); ctx.provide('connection', transport.service as never); ctx.provide('typert', {} as never); await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false }); await ctx.plugin(Tools); await ctx.plugin(LocalFileSystem, { cwd: root }); await ctx.plugin(Assets, { maxBytes: 100_000, maxEntries: 10, maxMediaBytes: 100_000 })
    const agent = { ctx, session: { id: 'media-session', header: { cwd: root } } } as never
    await ctx.manturAssets.load(agent, 'assets-report.json', undefined, 'manifest.json')
    const descriptor = await ctx.manturAssets.media(agent, 'CLIP-001')
    const url = new URL(descriptor.url, 'http://127.0.0.1')
    const route = transport.get()!
    expect((await route.fetch(new Request(url))).status).toBe(200)
    expect(await (await route.fetch(new Request(url))).text()).toBe('isolated-media')
    expect((await route.fetch(new Request(url, { headers: { range: 'bytes=-5' } }))).status).toBe(206)
    expect(await (await route.fetch(new Request(url, { headers: { range: 'bytes=-5' } }))).text()).toBe('media')
    expect((await route.fetch(new Request(url, { headers: { range: 'bytes=0-999' } }))).status).toBe(206)
    expect((await route.fetch(new Request(url, { method: 'HEAD', headers: { range: 'bytes=0-1' } }))).headers.get('content-length')).toBe('2')
    expect((await route.fetch(new Request(url, { headers: { range: 'bytes=5-2' } }))).status).toBe(416)
    expect((await route.fetch(new Request('http://127.0.0.1/api/mantur-assets.media?token=unknown'))).status).toBe(404)
    await writeFile(media, 'changed')
    expect((await route.fetch(new Request(url))).status).toBe(409)
    await ctx.manturAssets.load(agent, 'assets-report.json', undefined, 'manifest.json')
    expect((await route.fetch(new Request(url))).status).toBe(404)
  } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
})

it('applies a controlled Agent batch for two rows or rejects the whole batch on a source conflict', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-assets-batch-')); const ctx = new Context()
  try {
    await cp(assets, join(root, 'assets-report.json'))
    const transport = connection(); ctx.provide('connection', transport.service as never); ctx.provide('typert', {} as never); await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false }); await ctx.plugin(Tools); await ctx.plugin(LocalFileSystem, { cwd: root }); await ctx.plugin(Assets, { maxBytes: 9_000_000, maxEntries: 100, maxMediaBytes: 50_000_000 })
    const agent = { ctx, session: { id: 'batch-session', header: { cwd: root } } } as never
    const loaded = await ctx.manturAssets.load(agent, 'assets-report.json'); const rows = loaded.rows.filter(row => row.table === '角色资产').slice(0, 2)
    const edits = rows.map((row, index) => ({ key: row.key, fingerprint: row.fingerprint, prompt: `${row.prompt}，受控批量${index + 1}`, negative: row.negative }))
    const request = await ctx.manturAssets.prepare(agent, loaded.source, edits, '受控 Agent 批量提案；不生成媒体')
    const result = await ctx.manturAssets.proposeRemote(agent, request.requestId, request.source.path, request.edits)
    expect(result.status).toBe('proposed')
    const applied = await ctx.manturAssets.apply(agent, request.requestId)
    expect(applied.rows.filter(row => rows.some(selected => selected.key === row.key)).map(row => row.prompt)).toEqual(edits.map(edit => edit.prompt))
    const next = await ctx.manturAssets.load(agent, 'assets-report.json'); const second = next.rows.find(row => row.key === rows[0]!.key)!
    const conflictRequest = await ctx.manturAssets.prepare(agent, next.source, [{ ...second, negative: second.negative }], '受控冲突')
    await writeFile(join(root, 'assets-report.json'), (await readFile(join(root, 'assets-report.json'), 'utf8')).replace(second.prompt, '外部新版本'))
    await ctx.manturAssets.proposeRemote(agent, conflictRequest.requestId, conflictRequest.source.path, conflictRequest.edits)
    await expect(ctx.manturAssets.apply(agent, conflictRequest.requestId)).rejects.toMatchObject({ code: 'FS_STALE_VERSION' })
  } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
})

it.each(['source', 'finalize', 'conflict'])('reopens an interrupted %s write without reporting success early', async (mode) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-assets-recovery-')); const ctx = new Context()
  try {
    await cp(assets, join(root, 'assets-report.json')); const transport = connection(); ctx.provide('connection', transport.service as never); ctx.provide('typert', {} as never); await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false }); await ctx.plugin(Tools); await ctx.plugin(LocalFileSystem, { cwd: root }); await ctx.plugin(Assets, { maxBytes: 9_000_000, maxEntries: 100, maxMediaBytes: 50_000_000 })
    const agent = { ctx, session: { id: 'recover-session', header: { cwd: root } } } as never; const loaded = await ctx.manturAssets.load(agent, 'assets-report.json'); const row = loaded.rows.find(value => value.table === '角色资产')!
    const request = await ctx.manturAssets.prepare(agent, loaded.source, [{ key: row.key, fingerprint: row.fingerprint, prompt: `${row.prompt}，恢复版`, negative: row.negative }], '恢复测试')
    await ctx.manturAssets.proposeRemote(agent, request.requestId, request.source.path, request.edits)
    const original = ctx.fs.writeText.bind(ctx.fs); let journalWrites = 0
    const write = vi.spyOn(ctx.fs, 'writeText').mockImplementation(async (target, text, intent, signal, policy) => {
      const isSource = target.displayPath.endsWith('assets-report.json')
      if (!isSource) journalWrites += 1
      if ((mode !== 'finalize' && isSource) || (mode === 'finalize' && journalWrites === 2)) throw new Error('controlled interruption')
      return original(target, text, intent, signal, policy)
    })
    try { await expect(ctx.manturAssets.apply(agent, request.requestId)).rejects.toThrow('controlled interruption') } finally { write.mockRestore() }
    if (mode === 'conflict') await writeFile(join(root, 'assets-report.json'), (await readFile(join(root, 'assets-report.json'), 'utf8')).replace(row.prompt, '外部新内容'))
    const reopenedAgent = { ctx, session: { id: 'reopened-session', header: { cwd: root } } } as never
    const reopened = await ctx.manturAssets.load(reopenedAgent, 'assets-report.json')
    expect(reopened.state.pending?.proposal).toBe(request.requestId)
    expect(reopened.state.proposals.find(item => item.id === request.requestId)?.status).toBe('proposed')
    expect(reopened.state.history).toHaveLength(0)
    if (mode === 'conflict') {
      const before = await readFile(join(root, 'assets-report.json'), 'utf8')
      await expect(ctx.manturAssets.recover(reopenedAgent, reopened.stateVersion!)).rejects.toMatchObject({ code: 'FS_STALE_VERSION' })
      expect(await readFile(join(root, 'assets-report.json'), 'utf8')).toBe(before)
      return
    }
    const recovered = await ctx.manturAssets.recover(reopenedAgent, reopened.stateVersion!)
    expect(recovered.state.history).toHaveLength(1)
    await expect(ctx.manturAssets.recover(reopenedAgent, recovered.stateVersion!)).rejects.toThrow('No unfinished asset write')
    expect(recovered.state.pending).toBeNull(); expect(recovered.rows.find(value => value.key === row.key)?.prompt).toContain('恢复版')
  } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
})

it('allows only one of two first journal writers to win the create-if-absent race', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-assets-race-')); const ctx = new Context()
  try {
    await cp(assets, join(root, 'assets-report.json')); const transport = connection(); ctx.provide('connection', transport.service as never); ctx.provide('typert', {} as never); await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false }); await ctx.plugin(Tools); await ctx.plugin(LocalFileSystem, { cwd: root }); await ctx.plugin(Assets, { maxBytes: 9_000_000, maxEntries: 100, maxMediaBytes: 50_000_000 })
    const first = { ctx, session: { id: 'race-a', header: { cwd: root } } } as never; const second = { ctx, session: { id: 'race-b', header: { cwd: root } } } as never
    const [a, b] = await Promise.all([ctx.manturAssets.load(first, 'assets-report.json'), ctx.manturAssets.load(second, 'assets-report.json')]); const rowA = a.rows[0]!; const rowB = b.rows[1]!
    const original = ctx.fs.writeText.bind(ctx.fs); let arrivals = 0
    const barrier = Promise.withResolvers<undefined>()
    const write = vi.spyOn(ctx.fs, 'writeText').mockImplementation(async (target, text, intent, signal, policy) => {
      arrivals += 1
      if (arrivals === 2) barrier.resolve(undefined)
      await barrier.promise
      return original(target, text, intent, signal, policy)
    })
    try {
      const outcomes = await Promise.allSettled([
        ctx.manturAssets.saveDraft(first, { source: a.source, stateVersion: a.stateVersion, edits: [{ key: rowA.key, fingerprint: rowA.fingerprint, prompt: '竞争甲', negative: rowA.negative }] }),
        ctx.manturAssets.saveDraft(second, { source: b.source, stateVersion: b.stateVersion, edits: [{ key: rowB.key, fingerprint: rowB.fingerprint, prompt: '竞争乙', negative: rowB.negative }] }),
      ])
      expect(arrivals).toBe(2)
      expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1)
      expect(outcomes.filter(result => result.status === 'rejected')).toHaveLength(1)
      const state = await ctx.manturAssets.load(first, 'assets-report.json'); expect(state.state.drafts).toHaveLength(1)
    } finally { write.mockRestore() }
  } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
})
