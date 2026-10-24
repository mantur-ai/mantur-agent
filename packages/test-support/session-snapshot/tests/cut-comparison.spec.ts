/** Synthetic adapter controls are not real Cut recordings or scenario execution evidence. */
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { compareCutSessionArtifacts, createCutSessionArtifacts, harvestCutSessionArtifacts } from '../src/cut-comparison.ts'

const PERSONA = '你是ManTur Agent，由漫途（Mantur）打造，专门在用户电脑本地完成漫剧创作与生产。你的职责是围绕漫剧项目完成故事构思、剧本、分镜、视觉素材、音频、剪辑方案和制作交付。你应使用当前本地工作区与可用工具直接推进制作，在获得必要授权后执行本地操作，并保持项目文件清晰有序。你的工作目录是 '

function recording(cwd = '/tmp/cut-record', port = 41001) {
  const header = { type: 'session', id: 'session-aaaaaaaa-1111-2222-3333-444444444444', cwd, createdAt: 1 }
  const request = { type: 'request/header', data: {
    reason: 'initial', header: { system: `${PERSONA}${cwd}。\n\nKeep every instruction.`, tools: [
      { name: 'open_editing_workbench', description: 'Open editor', parameters: { type: 'object' } },
    ], config: { model: 'recorded-model' } },
  } }
  const user = { type: 'user/message', data: {
    id: 'bbbbbbbb-1111-2222-3333-444444444444', role: 'user', source: { kind: 'user' },
    content: [{ type: 'text', text: 'Open the workbench.' }],
  } }
  const chunk = { type: 'assistant/chunk', data: { turn: 1, step: 1,
    chunk: { type: 'text-delta', index: 0, text: 'Opening.' } } }
  const call = { type: 'tool/call', data: {
    turn: 1, step: 1, callId: 'open-call', name: 'open_editing_workbench', arguments: {},
  } }
  const output = { directory: join(cwd, '剪辑', header.id), sessionId: header.id, editorUrl: `http://127.0.0.1:${port}/` }
  const textBlock = { type: 'text', text: JSON.stringify(output) }
  const resultBlock = { type: 'tool-result', toolCallId: call.data.callId, isError: false, content: [textBlock] }
  const result = { type: 'tool/result', data: {
    turn: 1, step: 1,
    message: { role: 'user', id: 'cccccccc-1111-2222-3333-444444444444',
      source: { kind: 'tool', callId: call.data.callId }, content: [resultBlock] },
    meta: { kind: 'mantur-editing-workspace', ...output },
  } }
  const rows: object[] = [header, request, user, chunk, call, result, { type: 'turn/end', data: { turn: 1 } }]
  return { header, request, user, chunk, call, output, textBlock, resultBlock, result, rows,
    raw: () => rows.map(row => JSON.stringify(row)).join('\n') + '\n',
    updateOutput: () => { Object.assign(result.data.meta, output); textBlock.text = JSON.stringify(output) },
  }
}

type Recording = ReturnType<typeof recording>

function runtimeContext(fixture: Recording) {
  const sandbox = { name: 'sandbox:policy', text: `Current DSH file policy: workspace-write. Any available operation enforced by the DSH file sandbox may modify files under the session workspace: ${JSON.stringify(fixture.header.cwd)}. Some platform temporary areas may also be writable.` }
  const approval = { name: 'approval:policy', text: 'Approval is required.' }
  const source = { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt', form: 'snapshot', sections: [sandbox, approval] }
  const block = { type: 'text', text: '' }
  const render = () => { block.text = 'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\n\n'
    + source.sections.map(section => section.text).join('\n\n') }
  render()
  fixture.rows.splice(3, 0, { type: 'user/message', data: { id: 'runtime-context', role: 'user', source, content: [block] } })
  return { sandbox, approval, source, block, render }
}

describe('Cut single-workbench comparison', () => {
  it('maps the bound loopback URL and persona cwd while retaining all three artifacts', () => {
    const expected = recording()
    const raw = expected.raw()
    const actual = recording('/tmp/cut-replay', 41002)
    expect(createCutSessionArtifacts(actual.raw())).toEqual(createCutSessionArtifacts(raw))
    expect(expected.raw()).toBe(raw)
    const artifacts = createCutSessionArtifacts(raw)
    expect(Object.keys(artifacts)).toEqual(['session.jsonl', 'system-prompt.expected.md', 'tool-schemas.expected.json'])
    expect(artifacts['session.jsonl'].match(/cutEditorUrl:1/g)).toHaveLength(2)
    expect(artifacts['system-prompt.expected.md']).toContain(`${PERSONA}{{cwd}}。`)
  })

  it('preserves relationships while mapping only schema-owned identities across runs', () => {
    const left = recording()
    const right = recording('/tmp/cut-replay', 41002)
    for (const [fixture, suffix] of [[left, 'left'], [right, 'right']] as const) {
      fixture.header.id = `session-${suffix}`
      fixture.output.sessionId = fixture.header.id
      fixture.output.directory = join(fixture.header.cwd, '剪辑', fixture.header.id)
      fixture.updateOutput()
      fixture.user.data.id = `user-${suffix}`
      Object.assign(fixture.user.data.source, { rpcId: `rpc-${suffix}` })
      fixture.call.data.callId = `call-${suffix}`
      fixture.resultBlock.toolCallId = fixture.call.data.callId
      fixture.result.data.message.source.callId = fixture.call.data.callId
      fixture.result.data.message.id = `result-${suffix}`
      fixture.rows.splice(2, 0, { type: 'agent/inbox/spliced', data: { inserted: [structuredClone(fixture.user.data)] } })
      fixture.rows.push({ type: 'assistant/message', data: { message: {
        id: `assistant-${suffix}`, role: 'assistant', source: { kind: 'model' },
        content: [{ type: 'tool-call', id: fixture.call.data.callId, name: 'open_editing_workbench', arguments: {} }],
      } } })
    }
    expect(createCutSessionArtifacts(left.raw())).toEqual(createCutSessionArtifacts(right.raw()))
    right.user.data.content[0]!.text = right.header.id
    expect(createCutSessionArtifacts(left.raw())).not.toEqual(createCutSessionArtifacts(right.raw()))
  })

  it('binds streamed tool identities to the final block and call without hiding a missing delta id', () => {
    const left = recording()
    const right = recording()
    const deltas = [left, right].map((fixture, index) => {
      const callId = `streamed-call-${index}`
      fixture.call.data.callId = callId
      fixture.result.data.message.source.callId = callId
      fixture.resultBlock.toolCallId = callId
      const delta = { type: 'tool-call-delta', index: 1, id: callId,
        name: 'open_editing_workbench', argumentsDelta: '{}' }
      fixture.rows.splice(fixture.rows.indexOf(fixture.call), 0,
        { type: 'assistant/chunk', data: { turn: 1, step: 1,
          chunk: { type: 'block-end', index: 0, block: { type: 'text', text: 'Opening.' } } } },
        { type: 'assistant/chunk', data: { turn: 1, step: 1, chunk: delta } },
        { type: 'assistant/chunk', data: { turn: 1, step: 1,
          chunk: { type: 'block-end', index: 1, block: {
            type: 'tool-call', id: callId, name: 'open_editing_workbench', arguments: {},
          } } } },
      )
      return delta
    })
    expect(createCutSessionArtifacts(left.raw())).toEqual(createCutSessionArtifacts(right.raw()))
    Reflect.deleteProperty(deltas[1]!, 'id')
    expect(createCutSessionArtifacts(left.raw())).not.toEqual(createCutSessionArtifacts(right.raw()))
  })

  it('maps only the attributed sandbox workspace slot and its exact rendered copy', () => {
    const left = recording()
    const right = recording('/tmp/cut-replay', 41002)
    runtimeContext(left)
    const context = runtimeContext(right)
    expect(createCutSessionArtifacts(left.raw())).toEqual(createCutSessionArtifacts(right.raw()))
    context.approval.text += right.header.cwd
    context.render()
    expect(createCutSessionArtifacts(left.raw())).not.toEqual(createCutSessionArtifacts(right.raw()))
  })

  it.each(['content', 'section', 'duplicate'])('rejects inconsistent sandbox runtime context: %s', (change) => {
    const fixture = recording()
    const context = runtimeContext(fixture)
    if (change === 'content') context.block.text += ' changed'
    if (change === 'section') { context.sandbox.text += ' changed'; context.render() }
    if (change === 'duplicate') { context.source.sections.push(structuredClone(context.sandbox)); context.render() }
    expect(() => createCutSessionArtifacts(fixture.raw())).toThrow(/runtime.context|sandbox policy/)
  })

  it.each(['kind', 'plugin', 'form', 'section name'])('does not map sandbox-like prose without matching %s', (field) => {
    const left = recording()
    const right = recording('/tmp/cut-replay', 41002)
    for (const fixture of [left, right]) {
      const context = runtimeContext(fixture)
      if (field === 'kind') context.source.kind = 'other'
      if (field === 'plugin') context.source.plugin = 'other'
      if (field === 'form') context.source.form = 'other'
      if (field === 'section name') context.sandbox.name = 'other'
    }
    expect(createCutSessionArtifacts(left.raw())).not.toEqual(createCutSessionArtifacts(right.raw()))
  })

  const invalid: [string, (fixture: Recording) => void, string][] = [
    ['missing call', f => f.rows.splice(4, 1), 'exactly one workbench call'],
    ['duplicate call', f => f.rows.push(structuredClone(f.call)), 'exactly one workbench call'],
    ['reused call id', f => f.rows.push({ ...f.call, data: { ...f.call.data, name: 'other' } }), 'call id must be unique'],
    ['missing result', f => f.rows.splice(5, 1), 'exactly one result'],
    ['duplicate result', f => f.rows.push(structuredClone(f.result)), 'exactly one result'],
    ['orphan source', (f) => { f.result.data.message.source.callId = 'orphan' }, 'bind the same call'],
    ['orphan block', (f) => { f.resultBlock.toolCallId = 'orphan' }, 'block must match its call'],
    ['orphan workbench result', (f) => {
      const orphan = structuredClone(f.result)
      orphan.data.message.source.callId = 'orphan'
      orphan.data.message.content[0]!.toolCallId = 'orphan'
      f.rows.push(orphan)
    }, 'metadata must bind'],
    ['result before call', (f) => { [f.rows[4], f.rows[5]] = [f.rows[5]!, f.rows[4]!] }, 'must follow its call'],
    ['different turn', (f) => { f.result.data.turn = 2 }, 'turn must match'],
    ['different step', (f) => { f.result.data.step = 2 }, 'step must match'],
    ['missing step', (f) => { Reflect.deleteProperty(f.call.data, 'step') }, 'positive step'],
    ['error result', (f) => { f.resultBlock.isError = true }, 'must succeed'],
    ['different metadata URL', (f) => { f.result.data.meta.editorUrl = 'http://127.0.0.1:41002/' }, 'must agree: editorUrl'],
    ['wrong metadata kind', (f) => { f.result.data.meta.kind = 'other' }, 'metadata kind'],
    ['wrong source kind', (f) => { f.result.data.message.source.kind = 'user' }, 'source kind'],
    ['wrong message role', (f) => { f.result.data.message.role = 'assistant' }, 'message role'],
    ['wrong block type', (f) => { f.resultBlock.type = 'text' }, 'block type'],
    ['wrong session', (f) => { f.output.sessionId = 'wrong'; f.updateOutput() }, 'recorded session'],
    ['wrong directory', (f) => { f.output.directory += '/extra'; f.updateOutput() }, 'directory must belong'],
    ['extra output field', (f) => { f.textBlock.text = JSON.stringify({ ...f.output, unexpected: true }) }, 'output fields'],
    ['noncanonical output', (f) => { f.textBlock.text = JSON.stringify(f.output, null, 2) }, 'must be canonical'],
    ['extra content', f => f.resultBlock.content.push({ type: 'text', text: 'extra' }), 'one text block'],
    ['non-array result content', (f) => { Object.assign(f.result.data.message, { content: {} }) }, 'one content block'],
    ['relative cwd', (f) => { f.header.cwd = 'relative' }, 'must be absolute'],
    ['child session', (f) => { Object.assign(f.header, { parentSession: 'parent' }) }, 'root session'],
    ['second session', f => f.rows.push(structuredClone(f.header)), 'requires one session'],
    ['missing prompt', (f) => { Reflect.deleteProperty(f.request.data.header, 'system') }, 'full system prompt'],
    ['missing schemas', (f) => { Reflect.deleteProperty(f.request.data.header, 'tools') }, 'full tool schemas'],
    ['no headers', f => f.rows.splice(1, 1), 'at least one complete request header'],
  ]
  it.each(invalid)('rejects %s before normalization', (_name, mutate, error) => {
    const fixture = recording()
    mutate(fixture)
    expect(() => createCutSessionArtifacts(fixture.raw())).toThrow(error)
  })

  it.each([
    'https://127.0.0.1:41001/', 'http://localhost:41001/', 'http://192.0.2.1:41001/',
    'http://127.0.0.1/', 'http://127.0.0.1:0/', 'http://127.0.0.1:41001/project', 'http://127.0.0.1:41001/?token=synthetic',
    'http://127.0.0.1:41001/#project', 'http://user:synthetic@127.0.0.1:41001/',
    'http://127.0.0.1:41001/?', 'http://127.0.0.1:41001/#',
    'http://127.0.0.1:41001', '{{cutEditorUrl:1}}',
  ])('rejects non-observed editor URL %s', (url) => {
    const fixture = recording()
    fixture.output.editorUrl = url
    fixture.updateOutput()
    expect(() => createCutSessionArtifacts(fixture.raw())).toThrow()
  })

  it.each(['../escaped', '/absolute', 'nested/session', 'nested\\session', '.', '..'])('rejects path-like session id %s', (id) => {
    const fixture = recording()
    fixture.header.id = id
    fixture.output.sessionId = id
    fixture.output.directory = join(fixture.header.cwd, '剪辑', id)
    fixture.updateOutput()
    expect(() => createCutSessionArtifacts(fixture.raw())).toThrow('safe directory segment')
  })

  const changed: [string, (fixture: Recording) => void][] = [
    ['user instruction', (f) => { f.user.data.content[0]!.text += ' changed' }],
    ['assistant chunk', (f) => { f.chunk.data.chunk.text += ' changed' }],
    ['assistant URL', (f) => { f.chunk.data.chunk.text = f.output.editorUrl }],
    ['tool arguments', (f) => { f.call.data.arguments = { changed: true } }],
    ['additional result metadata', (f) => { Object.assign(f.result.data.meta, { business: 'changed' }) }],
    ['lifecycle event added', (f) => { f.rows.push({ type: 'session/end-seed', data: {} }) }],
    ['lifecycle event removed', (f) => { f.rows.pop() }],
    ['model config', (f) => { f.request.data.header.config.model = 'different' }],
    ['prompt body', (f) => { f.request.data.header.system += '\nNew business instruction.' }],
    ['prompt final newline', (f) => { f.request.data.header.system += '\n' }],
    ['tool schema', (f) => { f.request.data.header.tools[0]!.description += ' changed' }],
    ['non-workbench URL', (f) => { f.user.data.content[0]!.text = f.output.editorUrl }],
    ['unowned URL metadata', (f) => { Object.assign(f.result.data.meta, { anotherUrl: f.output.editorUrl }) }],
    ['series prompt', (f) => { f.rows.push({ ...structuredClone(f.request), data: {
      reason: 'series', header: { ...f.request.data.header, system: 'Changed series prompt' },
    } }) }],
  ]
  it.each(changed)('keeps changed %s visible in the complete comparison', (_name, mutate) => {
    const fixture = recording()
    const expected = createCutSessionArtifacts(fixture.raw())
    mutate(fixture)
    expect(createCutSessionArtifacts(fixture.raw())).not.toEqual(expected)
  })

  it('retains the known cwd in business text, longer paths and tool schemas', () => {
    const left = recording()
    const right = recording('/tmp/cut-replay', 41002)
    for (const fixture of [left, right]) {
      fixture.request.data.header.system += `\nBusiness ${fixture.header.cwd}; ${fixture.header.cwd}-backup`
      fixture.request.data.header.tools[0]!.description += fixture.header.cwd
    }
    const a = createCutSessionArtifacts(left.raw())
    const b = createCutSessionArtifacts(right.raw())
    expect(a['system-prompt.expected.md']).toContain(`Business ${left.header.cwd}`)
    expect(a['system-prompt.expected.md']).not.toBe(b['system-prompt.expected.md'])
    expect(a['tool-schemas.expected.json']).not.toBe(b['tool-schemas.expected.json'])
  })

  it.each(['user', 'assistant', 'tool'])('preserves cwd, aliases and separators in %s business text', (location) => {
    const left = recording()
    const right = recording('/tmp/cut-replay', 41002)
    for (const fixture of [left, right]) {
      const text = `${fixture.header.cwd} /private${fixture.header.cwd} ${fixture.header.cwd}\\business`
      if (location === 'user') fixture.user.data.content[0]!.text = text
      if (location === 'assistant') fixture.chunk.data.chunk.text = text
      if (location === 'tool') Object.assign(fixture.result.data.meta, { business: text })
    }
    const a = createCutSessionArtifacts(left.raw())['session.jsonl']
    const b = createCutSessionArtifacts(right.raw())['session.jsonl']
    expect(a).toContain(left.header.cwd)
    expect(a).not.toBe(b)
  })

  it.each(['\n', '\r\n', '\n\n'])('preserves prompt final whitespace %j for every header', (suffix) => {
    const fixture = recording()
    const series = structuredClone(fixture.request)
    series.data.reason = 'series'
    fixture.rows.push(series)
    const initial = createCutSessionArtifacts(fixture.raw())['system-prompt.expected.md']
    series.data.header.system += suffix
    expect(createCutSessionArtifacts(fixture.raw())['system-prompt.expected.md']).not.toBe(initial)
  })

  it('does not substitute a persona-like sentence outside the owned first paragraph', () => {
    const fixture = recording()
    fixture.request.data.header.system = `Business preface\n${PERSONA}${fixture.header.cwd}。`
    expect(createCutSessionArtifacts(fixture.raw())['system-prompt.expected.md']).toContain(fixture.header.cwd)
  })

  it.each(['metadata', 'schema'])('preserves arbitrary business UUIDs in %s id fields', (location) => {
    const left = recording()
    const right = recording()
    for (const [fixture, id] of [[left, '11111111-1111-1111-1111-111111111111'],
      [right, '22222222-2222-2222-2222-222222222222']] as const) {
      if (location === 'metadata') Object.assign(fixture.result.data.meta, { businessId: id })
      else Object.assign(fixture.request.data.header.tools[0]!, { id })
    }
    expect(createCutSessionArtifacts(left.raw())).not.toEqual(createCutSessionArtifacts(right.raw()))
  })

  it.each([
    ['/tmp/dsh-acp-snap-abcdef123/session-abcdef123456/abcdef123456-output.txt',
      '/tmp/dsh-acp-snap-123456789/session-123456abcdef/123456abcdef-output.txt'],
    ['{{cwd}}/.spill/session-abcdef123456/abcdef123456-output.txt',
      '{{cwd}}/.spill/session-123456abcdef/123456abcdef-output.txt'],
    ['Session sample — sample\nTarget event seq 1:\n```json\n{\n  "time": 123,\n}\n```',
      'Session sample — sample\nTarget event seq 1:\n```json\n{\n  "time": 456,\n}\n```'],
  ])('preserves business text resembling general-normalizer tokens', (first, second) => {
    const left = recording()
    const right = recording()
    left.user.data.content[0]!.text = first
    right.user.data.content[0]!.text = second
    expect(createCutSessionArtifacts(left.raw())['session.jsonl'])
      .not.toBe(createCutSessionArtifacts(right.raw())['session.jsonl'])
  })

  it('preserves business usage fields and lifecycle payload clocks', () => {
    const left = recording()
    const right = recording()
    for (const [fixture, value] of [[left, 123], [right, 456]] as const) {
      Object.assign(fixture.result.data.meta, { business: { sessionUpdate: 'usage_update', used: value } })
      fixture.rows.push({ type: 'hook/result', data: { durationMs: value } })
      fixture.rows.push({ type: 'goal/change', data: { createdAt: value, updatedAt: value } })
    }
    expect(createCutSessionArtifacts(left.raw())['session.jsonl'])
      .not.toBe(createCutSessionArtifacts(right.raw())['session.jsonl'])
  })

  it('rejects identity reuse across kinds and unsupported packed tool-call chunks', () => {
    const fixture = recording()
    fixture.user.data.id = fixture.header.id
    expect(() => createCutSessionArtifacts(fixture.raw())).toThrow('shared across kinds')
    const packed = recording()
    packed.rows.push({ type: 'tool-call-chunks', data: {} })
    expect(() => createCutSessionArtifacts(packed.raw())).toThrow('unpacked tool-call chunks')
  })

  it('preserves packed assistant text while ignoring only persistence flush divisions', () => {
    const left = recording()
    const right = recording()
    left.rows.splice(3, 1, { type: 'text-chunks', seq0: 3, time0: 12,
      data: { turn: 1, step: 1, index: 0, dt: [4, 5], texts: ['a', 'b', 'c'] } })
    const tail = { type: 'text-chunks', seq0: 4, time0: 99,
      data: { turn: 1, step: 1, index: 0, dt: [6], texts: ['b', 'c'] } }
    right.rows.splice(3, 1, { type: 'assistant/chunk', seq: 3, time: 98,
      data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'a' } } }, tail)
    expect(createCutSessionArtifacts(left.raw())).toEqual(createCutSessionArtifacts(right.raw()))
    tail.data.texts[1] = 'changed'
    expect(createCutSessionArtifacts(left.raw())).not.toEqual(createCutSessionArtifacts(right.raw()))
  })

  it('compares every series header prompt and tool catalog, including repeated ones', () => {
    const fixture = recording()
    const series = structuredClone(fixture.request)
    series.data.reason = 'series'
    fixture.rows.push(series)
    const expected = createCutSessionArtifacts(fixture.raw())
    expect((JSON.parse(expected['tool-schemas.expected.json']) as { changes: unknown[] }).changes).toHaveLength(1)
    series.data.header.system += ' changed'
    expect(createCutSessionArtifacts(fixture.raw())['system-prompt.expected.md']).not.toBe(expected['system-prompt.expected.md'])
    series.data.header.tools[0]!.description += ' changed'
    expect(createCutSessionArtifacts(fixture.raw())['tool-schemas.expected.json']).not.toBe(expected['tool-schemas.expected.json'])
  })

  it('distinguishes prompt sequences whose text contains the sidecar delimiter', () => {
    const left = recording()
    const right = recording()
    const delimiter = '\n<!-- request/header change 1 -->\n\n'
    left.request.data.header.system = `first\n${delimiter}second`
    right.request.data.header.system = 'first'
    const series = structuredClone(right.request)
    series.data.reason = 'series'
    series.data.header.system = 'second'
    right.rows.push(series)
    expect(createCutSessionArtifacts(left.raw())['system-prompt.expected.md'])
      .not.toBe(createCutSessionArtifacts(right.raw())['system-prompt.expected.md'])
  })
})

describe('Cut artifact harvest and comparison', () => {
  const roots: string[] = []
  afterEach(async () => {
    await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  })
  async function directory(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'cut-artifacts-'))
    roots.push(root)
    return join(root, 'recording')
  }
  const source = (raw: string) => ({ revision: '1'.repeat(40), sha256: createHash('sha256').update(raw).digest('hex') })

  it('writes source and artifact hashes, then compares a complete new raw log', async () => {
    const dir = await directory()
    const raw = recording().raw()
    await harvestCutSessionArtifacts(raw, dir, source(raw))
    const provenance = JSON.parse(await readFile(join(dir, 'provenance.json'), 'utf8')) as {
      source: { revision: string; sha256: string }
      artifacts: Record<string, string>
    }
    expect(provenance.source).toEqual(source(raw))
    expect(Object.keys(provenance.artifacts)).toHaveLength(3)
    await compareCutSessionArtifacts(recording('/tmp/cut-replay', 41002).raw(), dir)
    await expect(harvestCutSessionArtifacts(raw, dir, source(raw))).rejects.toThrow()
  })

  it('rejects a raw-source hash mismatch before writing fixtures', async () => {
    const dir = await directory()
    const raw = recording().raw()
    await expect(harvestCutSessionArtifacts(raw, dir, { ...source(raw), sha256: '0'.repeat(64) })).rejects.toThrow('supplied SHA256')
    await expect(readFile(join(dir, 'session.jsonl'))).rejects.toThrow()
  })

  it('writes only the declared source revision and raw hash to provenance', async () => {
    const dir = await directory()
    const raw = recording().raw()
    const supplied = { ...source(raw), privatePath: '/synthetic/private/source' }
    await harvestCutSessionArtifacts(raw, dir, supplied)
    const provenance = JSON.parse(await readFile(join(dir, 'provenance.json'), 'utf8')) as {
      source: { revision: string; sha256: string }
    }
    expect(provenance.source).toEqual(source(raw))
  })

  it.each(['session.jsonl', 'system-prompt.expected.md', 'tool-schemas.expected.json'])('rejects changed fixture bytes: %s', async (name) => {
    const dir = await directory()
    const raw = recording().raw()
    await harvestCutSessionArtifacts(raw, dir, source(raw))
    await writeFile(join(dir, name), 'changed')
    await expect(compareCutSessionArtifacts(raw, dir)).rejects.toThrow(`fixture hash mismatch: ${name}`)
  })

  it.each(['session', 'prompt', 'schemas'])('fails the formal comparison on changed %s', async (kind) => {
    const dir = await directory()
    const fixture = recording()
    const raw = fixture.raw()
    await harvestCutSessionArtifacts(raw, dir, source(raw))
    if (kind === 'session') fixture.user.data.content[0]!.text += ' changed'
    if (kind === 'prompt') fixture.request.data.header.system += ' changed'
    if (kind === 'schemas') fixture.request.data.header.tools[0]!.description += ' changed'
    await expect(compareCutSessionArtifacts(fixture.raw(), dir)).rejects.toThrow('complete artifact differs')
  })

  it('rejects an extra file and a symlinked artifact', async () => {
    const dir = await directory()
    const raw = recording().raw()
    await harvestCutSessionArtifacts(raw, dir, source(raw))
    await writeFile(join(dir, 'extra'), 'extra')
    await expect(compareCutSessionArtifacts(raw, dir)).rejects.toThrow('inventory')
    await rm(join(dir, 'extra'))
    await rm(join(dir, 'session.jsonl'))
    await symlink('system-prompt.expected.md', join(dir, 'session.jsonl'))
    await expect(compareCutSessionArtifacts(raw, dir)).rejects.toThrow('regular file')
  })
})
