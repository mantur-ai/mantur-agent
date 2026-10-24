/** Explicit comparison of single-workbench Cut recordings; this module never executes a scenario. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { normalizeSessionSnapshot } from './normalize.ts'
import { formatSystemPromptSnapshot, formatToolSchemasSnapshot } from './suite.ts'

const EDITOR_URL = '{{cutEditorUrl:1}}'
const MANTUR_PROMPT_PREFIX = '你是ManTur Agent，由漫途（Mantur）打造，专门在用户电脑本地完成漫剧创作与生产。你的职责是围绕漫剧项目完成故事构思、剧本、分镜、视觉素材、音频、剪辑方案和制作交付。你应使用当前本地工作区与可用工具直接推进制作，在获得必要授权后执行本地操作，并保持项目文件清晰有序。你的工作目录是 '
const RUNTIME_CONTEXT_PREFIX = 'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\n\n'
const ARTIFACT_NAMES = ['session.jsonl', 'system-prompt.expected.md', 'tool-schemas.expected.json'] as const

/** Complete compared artifacts, including every request header's prompt and tool catalog. */
export type CutSessionArtifacts = Record<typeof ARTIFACT_NAMES[number], string>

/** Independently supplied identity of the raw recording and the source code it exercised. */
export interface CutRecordingSource {
  /** Full Git commit of the product used to produce the recording. */
  revision: string
  /** SHA256 of the unmodified raw session JSONL bytes. */
  sha256: string
}

function object(value: unknown, label: string): Record<string, unknown> {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value), label)
  return value as Record<string, unknown>
}

function string(value: unknown, label: string): string {
  assert(typeof value === 'string' && value.length > 0, label)
  return value
}

function one(value: unknown, label: string): Record<string, unknown> {
  assert(Array.isArray(value) && value.length === 1, label)
  return object(value[0], label)
}

function rowsOf(raw: string): Record<string, unknown>[] {
  return raw.trimEnd().split('\n').map(line => object(JSON.parse(line), 'Cut recording JSONL row'))
}

function digest(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

/** Validate the public runtime-context renderer before projecting its sandbox workspace slot. */
function projectSandboxContext(rows: Record<string, unknown>[], cwd: string): void {
  const policy = (root: string): string => `Current DSH file policy: workspace-write. Any available operation enforced by the DSH file sandbox may modify files under the session workspace: ${JSON.stringify(root)}. Some platform temporary areas may also be writable.`
  for (const row of rows) {
    if (row.type !== 'user/message') continue
    const message = object(row.data, 'Cut user message')
    const source = object(message.source, 'Cut user message source')
    if (source.kind !== 'plugin' || source.plugin !== '@deepseek-ai/dsh-system-prompt' || source.form !== 'snapshot') continue
    assert(Array.isArray(source.sections), 'Cut runtime-context snapshot requires named sections')
    const sections = source.sections.map(section => object(section, 'Cut runtime-context section'))
    const sandbox = sections.filter(section => section.name === 'sandbox:policy')
    if (sandbox.length === 0) continue
    const sandboxSection = one(sandbox, 'Cut runtime context requires one sandbox policy section')
    const texts = sections.map(section => string(section.text, 'Cut runtime-context section text'))
    const block = one(message.content, 'Cut runtime context requires one rendered text block')
    assert.equal(block.type, 'text', 'Cut runtime-context block type')
    assert.equal(block.text, RUNTIME_CONTEXT_PREFIX + texts.join('\n\n'),
      'Cut runtime-context content must render all attributed sections exactly')
    assert.equal(sandboxSection.text, policy(cwd), 'Cut sandbox policy must name the session workspace')
    sandboxSection.text = policy('{{cwd}}')
    block.text = RUNTIME_CONTEXT_PREFIX + sections.map(section => section.text).join('\n\n')
  }
}

/** Map only identities owned by the observed message, tool and inbox event schemas. */
function projectIdentities(rows: Record<string, unknown>[], header: Record<string, unknown>): void {
  const ids = new Map<string, string>()
  const kinds = new Map<string, string>()
  const counts = new Map<string, number>()
  function replace(row: Record<string, unknown>, field: string, kind: string): void {
    const value = string(row[field], `Cut ${kind} identity ${field}`)
    assert(!/^\{\{(?:session|message|rpc|id):/.test(value), 'Cut raw identities must not be snapshot tokens')
    assert(!kinds.has(value) || kinds.get(value) === kind, 'Cut identity must not be shared across kinds')
    kinds.set(value, kind)
    let token = ids.get(value)
    if (token === undefined) {
      const index = (counts.get(kind) ?? 0) + 1
      counts.set(kind, index)
      token = `{{${kind}:${index}}}`
      ids.set(value, token)
    }
    row[field] = token
  }
  function message(value: unknown): void {
    const record = object(value, 'Cut message')
    replace(record, 'id', 'message')
    const source = object(record.source, 'Cut message source')
    if (source.kind === 'user' && source.rpcId !== undefined) replace(source, 'rpcId', 'rpc')
    if (source.kind === 'tool') replace(source, 'callId', 'id')
    assert(Array.isArray(record.content), 'Cut message content must be an array')
    for (const content of record.content) {
      const block = object(content, 'Cut message content block')
      if (block.type === 'tool-call') replace(block, 'id', 'id')
      if (block.type === 'tool-result') replace(block, 'toolCallId', 'id')
    }
  }
  replace(header, 'id', 'session')
  for (const row of rows.slice(1)) {
    assert(row.type !== 'tool-call-chunks', 'Cut adapter requires unpacked tool-call chunks')
    const data = object(row.data, 'Cut event data')
    if (row.type === 'user/message') message(data)
    if (row.type === 'assistant/message' || row.type === 'tool/result') message(data.message)
    if (row.type === 'agent/inbox/spliced') {
      assert(Array.isArray(data.inserted), 'Cut inbox inserted messages must be an array')
      data.inserted.forEach(message)
    }
    if (row.type === 'tool/call') replace(data, 'callId', 'id')
    if (row.type === 'assistant/chunk') {
      const chunk = object(data.chunk, 'Cut assistant chunk')
      if (chunk.type === 'tool-call-delta' && chunk.id !== undefined) replace(chunk, 'id', 'id')
      if (chunk.type === 'block-end') {
        const block = object(chunk.block, 'Cut assistant block')
        if (block.type === 'tool-call') replace(block, 'id', 'id')
      }
    }
  }
}

/**
 * Project a raw single-root recording with exactly one successful workbench open.
 * Only its bound result's editor URLs and cwd-derived directories, session-header cwd,
 * the shipped Mantur persona's cwd slot, and the bound sandbox runtime-context cwd slot
 * receive Cut-specific substitutions.
 * This adapter maps observed identity fields; standard session normalization handles
 * persistence envelopes and chunk packing. All events and request headers remain compared.
 * @param raw - unmodified persisted session JSONL, with full prompts and schemas.
 * @returns complete session, prompt and schema artifacts without mutating the input.
 * @throws If call/result relationships, the allocated loopback URL, or full headers are invalid.
 */
export function createCutSessionArtifacts(raw: string): CutSessionArtifacts {
  const rows = rowsOf(raw)
  const header = object(rows[0], 'Cut recording session header')
  assert.equal(header.type, 'session', 'Cut recording must start with a session header')
  assert.equal(rows.filter(row => row.type === 'session').length, 1, 'Cut recording requires one session')
  assert.equal(header.parentSession, undefined, 'Cut recording requires a root session')
  const sessionId = string(header.id, 'Cut session id')
  assert(!/[\\/\0]/.test(sessionId) && sessionId !== '.' && sessionId !== '..',
    'Cut session id must be one safe directory segment')
  const cwd = string(header.cwd, 'Cut session cwd')
  assert(isAbsolute(cwd), 'Cut recording cwd must be absolute')
  const calls = rows.filter(row => row.type === 'tool/call')
  const matching = calls.filter(row => object(row.data, 'tool call data').name === 'open_editing_workbench')
  const call = one(matching, 'Cut recording requires exactly one workbench call')
  const callData = object(call.data, 'workbench call data')
  const callId = string(callData.callId, 'workbench call id')
  for (const field of ['turn', 'step']) {
    const value = callData[field]
    assert(typeof value === 'number' && Number.isSafeInteger(value) && value > 0,
      `Workbench call requires a positive ${field}`)
  }
  assert.equal(calls.filter(row => object(row.data, 'tool call data').callId === callId).length, 1,
    'Workbench call id must be unique')
  const results = rows.filter(row => row.type === 'tool/result')
  const boundResults = results.filter((row) => {
    const data = object(row.data, 'tool result data')
    const message = object(data.message, 'tool result message')
    const source = object(message.source, 'tool result source')
    if (Array.isArray(message.content)) {
      for (const content of message.content) {
        const block = object(content, 'tool result content')
        if (block.type === 'tool-result' && block.toolCallId === callId) {
          assert.equal(source.callId, callId, 'Workbench block and result source must bind the same call')
        }
      }
    }
    if (data.meta !== undefined && object(data.meta, 'tool result metadata').kind === 'mantur-editing-workspace') {
      assert.equal(source.callId, callId, 'Workbench metadata must bind the workbench call')
    }
    return source.callId === callId
  })
  const result = one(boundResults, 'Workbench call must have exactly one result')
  assert(rows.indexOf(result) > rows.indexOf(call), 'Workbench result must follow its call')
  const data = object(result.data, 'workbench result data')
  assert.equal(data.turn, callData.turn, 'Workbench result turn must match its call')
  assert.equal(data.step, callData.step, 'Workbench result step must match its call')
  const meta = object(data.meta, 'workbench result metadata')
  assert.equal(meta.kind, 'mantur-editing-workspace', 'Workbench result metadata kind')
  const message = object(data.message, 'workbench result message')
  assert.equal(message.role, 'user', 'Workbench result message role')
  assert.equal(object(message.source, 'workbench result source').kind, 'tool', 'Workbench result source kind')
  const block = one(message.content, 'Workbench result must have one content block')
  assert.equal(block.type, 'tool-result', 'Workbench result block type')
  assert.equal(block.toolCallId, callId, 'Workbench result block must match its call')
  assert.equal(block.isError, false, 'Workbench result must succeed')
  const textBlock = one(block.content, 'Workbench output must have one text block')
  assert.equal(textBlock.type, 'text', 'Workbench output block type')
  const text = string(textBlock.text, 'workbench JSON output')
  const value = object(JSON.parse(text), 'workbench JSON output')
  assert.equal(text, JSON.stringify(value), 'Workbench JSON output must be canonical')
  assert.deepEqual(Object.keys(value).sort(), ['directory', 'editorUrl', 'sessionId'], 'Workbench output fields')
  for (const field of ['directory', 'editorUrl', 'sessionId']) {
    assert.equal(value[field], meta[field], `Workbench output and metadata must agree: ${field}`)
  }
  assert.equal(value.sessionId, sessionId, 'Workbench output must belong to the recorded session')
  assert.equal(value.directory, join(cwd, '剪辑', sessionId), 'Workbench output directory must belong to the session')
  const editorUrl = string(value.editorUrl, 'workbench editor URL')
  const url = new URL(editorUrl)
  assert.equal(url.protocol, 'http:', 'Workbench URL must use HTTP')
  assert.equal(url.hostname, '127.0.0.1', 'Workbench URL must use IPv4 loopback')
  assert(Number(url.port) > 0 && url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password,
    'Workbench URL must be an allocated loopback root without credentials, query or fragment')
  assert.equal(editorUrl, url.href, 'Workbench URL must be canonical')
  assert.equal(editorUrl, `http://127.0.0.1:${url.port}/`, 'Workbench URL must contain only the allocated root')
  header.cwd = '{{cwd}}'
  meta.directory = '{{cwd}}/剪辑/{{session:1}}'
  value.directory = meta.directory
  meta.sessionId = '{{session:1}}'
  value.sessionId = '{{session:1}}'
  meta.editorUrl = EDITOR_URL
  value.editorUrl = EDITOR_URL
  textBlock.text = JSON.stringify(value)

  projectSandboxContext(rows, cwd)
  projectIdentities(rows, header)
  const projected = rows.map(row => JSON.stringify(row)).join('\n') + '\n'
  const prompts: string[] = []
  const schemas: unknown[][] = []
  for (const row of rows) {
    if (row.type !== 'request/header') continue
    const request = object(object(row.data, 'request header data').header, 'request header')
    const prompt = string(request.system, 'Cut request header requires a full system prompt')
    assert(Array.isArray(request.tools), 'Cut request header requires full tool schemas')
    const persona = `${MANTUR_PROMPT_PREFIX}${cwd}。`
    const end = prompt.slice(persona.length, persona.length + 1)
    prompts.push(prompt.startsWith(persona) && (end === '' || end === '\n')
      ? `${MANTUR_PROMPT_PREFIX}{{cwd}}。${prompt.slice(persona.length)}` : prompt)
    schemas.push(request.tools)
  }
  const initialPrompt = prompts[0]
  const initialSchemas = schemas[0]
  assert(initialPrompt !== undefined && initialSchemas !== undefined,
    'Cut recording must contain at least one complete request header')
  return {
    'session.jsonl': normalizeSessionSnapshot(projected, { cwd: '', sessionIds: [] }, {
      identityMode: 'preserve', payloadMode: 'verbatim',
    }),
    // Lengths preserve final newlines and disambiguate formatter markers inside prompt text.
    'system-prompt.expected.md': `<!-- cut prompt UTF-16 lengths: ${JSON.stringify(prompts.map(prompt => prompt.length))} -->\n`
      + formatSystemPromptSnapshot(initialPrompt, prompts.slice(1)),
    'tool-schemas.expected.json': formatToolSchemasSnapshot(initialSchemas, schemas.slice(1)),
  }
}

/**
 * Harvest a raw recording into a new directory with independently supplied provenance.
 * This records comparison inputs only; it does not execute Cut or assert workspace effects.
 * @param raw - unmodified persisted session JSONL.
 * @param directory - new artifact directory; an existing path is never overwritten.
 * @param source - recorded product revision and independently captured raw SHA256.
 * @returns when all artifacts and their hash manifest have been written.
 * @throws If source identity is invalid, projection fails, or the destination already exists.
 */
export async function harvestCutSessionArtifacts(
  raw: string,
  directory: string,
  source: CutRecordingSource,
): Promise<void> {
  assert(/^[0-9a-f]{40}$/.test(source.revision), 'Cut source revision must be a full Git hash')
  assert.equal(source.sha256, digest(raw), 'Cut raw recording must match the supplied SHA256')
  const artifacts = createCutSessionArtifacts(raw)
  await mkdir(directory, { mode: 0o700 })
  for (const name of ARTIFACT_NAMES) await writeFile(join(directory, name), artifacts[name], { flag: 'wx' })
  await writeFile(join(directory, 'provenance.json'), JSON.stringify({
    adapter: 'cut-single-workbench-v1',
    source: { revision: source.revision, sha256: source.sha256 },
    artifacts: Object.fromEntries(ARTIFACT_NAMES.map(name => [name, digest(artifacts[name])])),
  }, null, 2) + '\n', { flag: 'wx' })
}

/**
 * Compare a raw run with every harvested artifact after checking fixture inventory and hashes.
 * This compares existing evidence; it does not replay the recorded model or drive the UI.
 * @param raw - unmodified actual session JSONL with full headers.
 * @param directory - artifacts created by {@link harvestCutSessionArtifacts}.
 * @returns when all three complete artifacts match.
 * @throws If a fixture is missing, changed or symlinked, or any compared content differs.
 */
export async function compareCutSessionArtifacts(raw: string, directory: string): Promise<void> {
  assert((await lstat(directory)).isDirectory(), 'Cut artifact root must be a real directory')
  assert.deepEqual((await readdir(directory)).sort(), [...ARTIFACT_NAMES, 'provenance.json'].sort(),
    'Cut artifact inventory must be complete and contain no extra files')
  for (const name of [...ARTIFACT_NAMES, 'provenance.json']) {
    assert((await lstat(join(directory, name))).isFile(), `Cut artifact must be a regular file: ${name}`)
  }
  const provenance = object(JSON.parse(await readFile(join(directory, 'provenance.json'), 'utf8')), 'Cut provenance')
  assert.deepEqual(Object.keys(provenance).sort(), ['adapter', 'artifacts', 'source'], 'Cut provenance fields')
  assert.equal(provenance.adapter, 'cut-single-workbench-v1', 'Cut comparison adapter version')
  const source = object(provenance.source, 'Cut recording source')
  assert.deepEqual(Object.keys(source).sort(), ['revision', 'sha256'], 'Cut source fields')
  assert(/^[0-9a-f]{40}$/.test(string(source.revision, 'Cut source revision')), 'Cut source revision hash')
  assert(/^[0-9a-f]{64}$/.test(string(source.sha256, 'Cut source SHA256')), 'Cut raw source SHA256')
  const hashes = object(provenance.artifacts, 'Cut artifact hashes')
  assert.deepEqual(Object.keys(hashes).sort(), [...ARTIFACT_NAMES].sort(), 'Cut artifact hash inventory')
  const actual = createCutSessionArtifacts(raw)
  for (const name of ARTIFACT_NAMES) {
    const expected = await readFile(join(directory, name), 'utf8')
    assert.equal(digest(expected), hashes[name], `Cut fixture hash mismatch: ${name}`)
    assert.equal(actual[name], expected, `Cut complete artifact differs: ${name}`)
  }
}
