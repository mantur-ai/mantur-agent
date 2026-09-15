/** Pipeline field preservation and rejection of ambiguous asset identities. */
import { describe, expect, it } from 'vitest'
import { report, imageReferences } from '../src/report.ts'
import type { AssetRow, PromptEdit } from '../src/types.ts'

function assets(row: Record<string, unknown> = {}) {
  return { schema_version: '1.0', 角色资产: [{ 资产ID: 'CHAR-1', 角色名: '角色', 角色提示词: '原提示词', 负面提示词: '原负面', ...row }], 场景资产: [], 道具资产: [] }
}
function clips(row: Record<string, unknown> = {}, request: Record<string, unknown> = {}) {
  return { schema_version: 'drama-storyboard-seedance-v2',
    Clip总表: [{ 'Clip ID': 'CLIP-1', 场景: { name: '庭院' }, 最终提示词: '镜头提示词', ...row }],
    'Seedance2.0请求体': [{ 'Clip ID': 'CLIP-1', 最终提示词: '镜头提示词', 成片URL: 'https://example.com/clip.mp4',
      请求体模板JSON: { model: 'seedance' }, 实际请求体JSON: 'retained request', 实际提示词: 'submitted prompt', ...request }],
  }
}
function edit(row: AssetRow): PromptEdit { return { key: row.key, fingerprint: row.fingerprint, prompt: '新提示词', negative: row.negative } }

describe('pipeline reports', () => {
  it('updates both clip prompt copies while preserving request and media observations', () => {
    const source = clips()
    const parsed = report(JSON.stringify(source))
    expect(parsed.rows[0]).toMatchObject({ id: 'CLIP-1', kind: 'video', name: JSON.stringify({ name: '庭院' }, null, 2),
      media: 'https://example.com/clip.mp4', template: JSON.stringify({ model: 'seedance' }, null, 2),
      actualRequest: 'retained request', actualPrompt: 'submitted prompt', negative: '' })
    const changed = JSON.parse(parsed.replace([edit(parsed.rows[0]!)])) as typeof source
    expect(changed.Clip总表[0]!.最终提示词).toBe('新提示词')
    expect(changed['Seedance2.0请求体'][0]).toEqual({ ...source['Seedance2.0请求体'][0], 最终提示词: '新提示词' })
  })

  it('preserves image bindings and updates only editable prompt fields', () => {
    const source = assets({ 图片URL: 'https://example.com/a.png', extra: 'retained' })
    const parsed = report(JSON.stringify(source))
    expect(parsed.rows[0]).toMatchObject({ kind: 'image', media: 'https://example.com/a.png', template: '', actualRequest: '', actualPrompt: '' })
    const changed = JSON.parse(parsed.replace([{ ...edit(parsed.rows[0]!), negative: '新负面' }])) as typeof source
    expect(changed.角色资产[0]).toEqual({ ...source.角色资产[0], 角色提示词: '新提示词', 负面提示词: '新负面' })
    const unnamed = assets()
    delete (unnamed.角色资产[0] as Record<string, unknown>).角色名
    expect(report(JSON.stringify(unnamed)).rows[0]!.name).toBe('')
    expect(report(JSON.stringify(clips({}, { 实际提示词: undefined }))).rows[0]!.actualPrompt).toBe('')
  })

  it.each([
    [null, 'JSON object'], [[], 'JSON object'], [1, 'JSON object'], [{}, 'schema_version'],
    [assets({ 资产ID: '' }), 'Empty asset'], [assets({ 角色提示词: 7 }), 'Missing report field'],
    [assets({ 图片URL: 7 }), 'Missing report field'], [{ ...assets(), 场景资产: null }, 'Missing report table'],
    [{ ...assets(), 道具资产: [null] }, 'JSON object'],
    [{ ...assets(), 角色资产: [...assets().角色资产, ...assets().角色资产] }, 'Duplicate asset'],
    [clips({}, { 最终提示词: 'different' }), 'copies disagree'],
    [{ ...clips(), 'Seedance2.0请求体': [] }, 'counts disagree'],
    [clips({}, { 'Clip ID': 'another' }), 'exactly one'],
    [clips({ 'Clip ID': undefined }), 'Missing report field'],
  ])('rejects malformed or ambiguous report %#', (source, message) => {
    expect(() => report(JSON.stringify(source))).toThrow(message)
  })

  it('rejects empty selections, duplicates, stale identities and clip negative edits', () => {
    const image = report(JSON.stringify(assets()))
    const selected = edit(image.rows[0]!)
    expect(() => image.replace([])).toThrow('distinct rows')
    expect(() => image.replace([selected, selected])).toThrow('distinct rows')
    expect(() => image.replace([{ ...selected, key: 'missing' as PromptEdit['key'] }])).toThrow('fingerprint changed')
    expect(() => image.replace([{ ...selected, fingerprint: 'stale' }])).toThrow('fingerprint changed')
    const video = report(JSON.stringify(clips()))
    expect(() => video.replace([{ ...edit(video.rows[0]!), negative: 'unrequested field' }])).toThrow('no editable negative')
  })
})

it('joins compiler image references by exact identity and rejects conflicting or invalid links', () => {
  const source = clips({}, { 图片引用: [{ asset_id: 'CHAR-1', url: 'https://example.com/one.png' }] })
  expect([...imageReferences(JSON.stringify(source))]).toEqual([['CHAR-1', 'https://example.com/one.png']])
  expect(() => imageReferences(JSON.stringify(assets()))).toThrow('storyboard report')
  for (const references of [null, [{ asset_id: 'CHAR-1', url: 'javascript:alert(1)' }], [
    { asset_id: 'CHAR-1', url: 'https://example.com/one.png' }, { asset_id: 'CHAR-1', url: 'https://example.com/two.png' },
  ]]) expect(() => imageReferences(JSON.stringify(clips({}, { 图片引用: references })))).toThrow()
})
