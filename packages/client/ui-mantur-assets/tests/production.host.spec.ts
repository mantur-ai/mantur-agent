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
import { expect, it } from 'vitest'

const real = '/Volumes/新磁盘/dsh/青春里的甜蜜风暴2_EP31_验收_2026-09-06'
const assets = join(real, '资产/资产提取结果/assets-report.json')

it('reads real reports, saves a guarded draft, applies a proposal, and refuses a stale source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-assets-production-'))
  const ctx = new Context()
  try {
    await cp(assets, join(root, 'assets-report.json'))
    ctx.provide('typert', {} as never); await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false }); await ctx.plugin(Tools)
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
    ctx.provide('typert', {} as never); await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false }); await ctx.plugin(Tools)
    await ctx.plugin(LocalFileSystem, { cwd: root }); await ctx.plugin(Assets, { maxBytes: 9_000_000, maxEntries: 100, maxMediaBytes: 50_000_000 })
    const absolute = join(root, 'assets-report.json')
    await writeFile(join(root, `.mantur-assets-${fingerprint(absolute).slice(0, 16)}.json`), '{broken')
    const agent = { ctx, session: { id: 'journal-session', header: { cwd: root } } } as never
    await expect(ctx.manturAssets.load(agent, 'assets-report.json')).rejects.toThrow(/JSON/)
  } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
})
