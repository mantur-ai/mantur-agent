/** Parse real pipeline reports without inventing asset or media bindings. */
import { createHash } from 'node:crypto'
import type { AssetKey, AssetRow, PromptEdit } from './types.ts'

const record = (value: unknown): Row => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Pipeline report must be a JSON object')
  return value as Row
}
type Row = Record<string, unknown>
interface Located { row: Row; mirror?: Row; prompt: string; negative?: string; view: AssetRow }

/**
 * Hash text or bytes for source and media freshness checks.
 * @param text - Exact file bytes decoded as UTF-8, or raw media bytes.
 * @returns SHA-256 fingerprint.
 */
export function fingerprint(text: string | Uint8Array): string { return createHash('sha256').update(text).digest('hex') }

/**
 * Parse a supported Mantur pipeline report and expose guarded prompt replacement.
 * @param text - Pipeline JSON.
 * @returns Parsed rows with field-local replacement.
 */
export function report(text: string): { rows: AssetRow[]; replace: (edits: PromptEdit[]) => string } {
  const doc = record(JSON.parse(text))
  const located: Located[] = []
  function rows(table: string): Row[] { const value = doc[table]; if (!Array.isArray(value)) throw new Error(`Missing report table: ${table}`); return value.map(record) }
  function required(row: Row, key: string): string { if (typeof row[key] !== 'string') throw new Error(`Missing report field: ${key}`); return row[key] }
  function optional(row: Row, key: string): string { return row[key] === undefined ? '' : required(row, key) }
  function display(value: unknown): string { return value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value, null, 2) }
  function add(row: Row, table: string, idField: string, nameField: string, prompt: string, negative?: string, mirror?: Row) {
    const id = required(row, idField)
    if (!id) throw new Error('Empty asset identity')
    const key = JSON.stringify([table, id]) as AssetKey
    if (located.some(item => item.view.key === key)) throw new Error(`Duplicate asset identity: ${id}`)
    const kind = mirror === undefined ? 'image' : 'video'
    const value = required(row, prompt)
    if (mirror !== undefined && required(mirror, prompt) !== value) throw new Error(`Clip prompt copies disagree: ${id}`)
    const locatedItem: Located = { row, prompt, view: {
      key, id, name: display(row[nameField]), table, kind, prompt: value,
      negative: negative === undefined ? '' : required(row, negative),
      fingerprint: fingerprint(JSON.stringify({ row, mirror })),
      media: optional(mirror ?? row, kind === 'video' ? '成片URL' : '图片URL'),
      template: display(mirror?.['请求体模板JSON']), actualRequest: display(mirror?.['实际请求体JSON']),
      actualPrompt: mirror === undefined ? '' : optional(mirror, '实际提示词'),
    } }
    if (mirror !== undefined) locatedItem.mirror = mirror
    if (negative !== undefined) locatedItem.negative = negative
    located.push(locatedItem)
  }
  if (doc['schema_version'] === '1.0') {
    for (const [table, name, prompt] of [
      ['角色资产', '角色名', '角色提示词'], ['场景资产', '场景名', '场景提示词'], ['道具资产', '道具名', '道具提示词'],
    ] as const) for (const row of rows(table)) add(row, table, '资产ID', name, prompt, '负面提示词')
  } else if (doc['schema_version'] === 'drama-storyboard-seedance-v2') {
    const requests = rows('Seedance2.0请求体')
    const clips = rows('Clip总表')
    if (clips.length !== requests.length) throw new Error('Clip and request counts disagree')
    for (const row of clips) {
      const matches = requests.filter(request => required(request, 'Clip ID') === required(row, 'Clip ID'))
      if (matches.length !== 1) throw new Error('Each Clip requires exactly one matching request')
      add(row, 'Clip总表', 'Clip ID', '场景', '最终提示词', undefined, matches[0])
    }
  } else throw new Error('Unsupported pipeline report schema_version')
  return { rows: located.map(item => item.view), replace(edits) {
    if (!edits.length || new Set(edits.map(edit => edit.key)).size !== edits.length) throw new Error('Select distinct rows')
    for (const edit of edits) {
      const item = located.find(value => value.view.key === edit.key)
      if (item === undefined || item.view.fingerprint !== edit.fingerprint) throw new Error('Asset identity or fingerprint changed')
      if (item.negative === undefined && edit.negative !== '') throw new Error('Clip reports have no editable negative prompt field')
      item.row[item.prompt] = edit.prompt
      if (item.negative !== undefined) item.row[item.negative] = edit.negative
      if (item.mirror !== undefined) item.mirror[item.prompt] = edit.prompt
    }
    return JSON.stringify(doc, null, 2) + '\n'
  } }
}
