/** Immutable bundled resources reject altered inventories and files before loading instructions. */
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import * as fsPromises from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { agentEvents, Inbox, type Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, type UserMessage } from '@deepseek-ai/dsh-session'
import ManturHubMarketplace from '../src/index.ts'
import { loadBundledSkill, readBundledCatalog } from '../src/bundled-catalog.ts'
import { bundledSkillDigest, bundledSkillDirectory, bundledSkillReference, parseBundledManifest, verifyBundledSkill } from '../src/bundled-manifest.ts'

vi.mock('node:fs/promises', async importOriginal => ({ ...await importOriginal<typeof import('node:fs/promises')>() }))

const markdown = '---\nname: example\ndescription: Test skill\nversion: 1.0.0\n---\nInstructions\n'
const identity = {
  name: 'example', title: '示例', version: '1.0.0',
  files: [{ path: 'SKILL.md', bytes: Buffer.byteLength(markdown), sha256: createHash('sha256').update(markdown).digest('hex') }],
}
const skill = { ...identity, digest: bundledSkillDigest(identity) }
const temporary: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true })))
})
async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'bundled-manifest-'))
  temporary.push(root)
  await writeFile(join(root, 'SKILL.md'), markdown)
  return root
}

it('returns precisely the verified Markdown bytes', async () => {
  expect(parseBundledManifest({ formatVersion: 1, skills: [skill] }).skills).toEqual([skill])
  expect(await verifyBundledSkill(await fixture(), skill)).toBe(markdown)
})

it('rejects a version changed without updating its identity', () => {
  expect(() => parseBundledManifest({ formatVersion: 1, skills: [{ ...skill, version: '1.0.1' }] })).toThrow('identity mismatch')
})

it('rejects duplicate Skill names', () => {
  expect(() => parseBundledManifest({ formatVersion: 1, skills: [skill, skill] })).toThrow('Duplicate bundled skill')
})

it.each(['../SKILL.md', '/SKILL.md', 'a\\SKILL.md', 'a/./SKILL.md'])('rejects unsafe inventory path %s', (path) => {
  expect(() => parseBundledManifest({ formatVersion: 1, skills: [{ ...skill, files: [{ ...skill.files[0], path }] }] })).toThrow()
})

it('rejects same-size modified instructions', async () => {
  const root = await fixture()
  await writeFile(join(root, 'SKILL.md'), markdown.replace('Instructions', 'instructions'))
  await expect(verifyBundledSkill(root, skill)).rejects.toThrow('file differs')
})

it('rejects missing and extra resources', async () => {
  const root = await fixture()
  await writeFile(join(root, 'extra.md'), 'Unexpected')
  await expect(verifyBundledSkill(root, skill)).rejects.toThrow('files differ')
  await rm(join(root, 'extra.md'))
  await rm(join(root, 'SKILL.md'))
  await expect(verifyBundledSkill(root, skill)).rejects.toThrow('files differ')
})

it('rejects a linked resource instead of following user-controlled contents', async () => {
  const root = await fixture()
  await symlink(join(root, 'SKILL.md'), join(root, 'linked.md'))
  await expect(verifyBundledSkill(root, skill)).rejects.toThrow('Unsupported bundled skill entry')
})

it('honors cancellation before filesystem access', async () => {
  const controller = new AbortController()
  controller.abort(new Error('Cancelled load'))
  await expect(verifyBundledSkill('/not-opened', skill, controller.signal)).rejects.toThrow('Cancelled load')
})

it('rejects a newly hashed manifest whose version disagrees with its packaged frontmatter', async () => {
  const root = await fixture()
  const wrong = { ...skill, version: '2.0.0' }
  wrong.digest = bundledSkillDigest(wrong)
  const directory = join(root, bundledSkillDirectory(wrong))
  await mkdir(directory)
  await writeFile(join(directory, 'SKILL.md'), markdown)
  await writeFile(join(root, 'manifest.json'), JSON.stringify({ formatVersion: 1, skills: [wrong] }))
  await expect(loadBundledSkill(root, wrong, { maxMetadataBytes: 65536, maxFiles: 10, maxUnpackedBytes: 65536 }))
    .rejects.toThrow('frontmatter version differs')
})

it('serves local identities without calling account methods or reading same-name user copies', async () => {
  const root = await fixture()
  const resources = join(root, 'bundled')
  await mkdir(resources)
  const directory = join(resources, bundledSkillDirectory(skill))
  await mkdir(directory)
  await writeFile(join(directory, 'SKILL.md'), markdown)
  await writeFile(join(resources, 'manifest.json'), JSON.stringify({ formatVersion: 1, skills: [skill] }))
  await mkdir(join(root, 'skills', skill.name), { recursive: true })
  await writeFile(join(root, 'skills', skill.name, 'SKILL.md'), 'User-owned older version; do not replace')
  const ctx = new Context()
  const unconfiguredContext = new Context()
  try {
    ctx.provide('manturAccount', {
      request: () => { throw new Error('Unexpected network request') },
      status: () => { throw new Error('Unexpected account lookup') },
    } as never)
    const service = new ManturHubMarketplace(ctx, { dshHome: root, bundledSkillDir: resources })
    const expected = { name: skill.name, title: skill.title, version: skill.version, digest: skill.digest,
      reference: bundledSkillReference(skill), source: 'app-bundled' }
    const signal = new AbortController().signal
    await expect(service.bundled(signal)).resolves.toEqual([expected])
    await expect(service.resolveBundled(bundledSkillReference(skill), signal)).resolves.toEqual(expected)
    await expect(service.resolveBundled(bundledSkillReference({ ...skill, version: '0.0.1' }), signal)).rejects.toThrow('identity is unavailable')
    const id = SessionId('bundled-skill-invocation')
    const session = Session.create(id, [], { version: 0, id, createdAt: 0, cwd: root, isSeeded: false })
    const agent: Agent = {
      ctx, id, session, options: {}, status: 'idle',
      inbox: new Inbox(session, { inserted() {}, discarded() {}, claimed() {} }),
      send() {}, followup() {}, steer() {}, inject() {}, cancel() {},
      runMaintenance: task => task(new AbortController().signal), whenIdle: () => Promise.resolve(),
    }
    const user = createUserMessage({ source: { kind: 'user' },
      content: [{ type: 'text', text: `/mantur-builtin:${bundledSkillReference(skill)} write the episode` }] })
    const invoke = (messages: UserMessage[]) => agentEvents(ctx, agent).waterfall('agent/pre-step',
      { messages, turn: 1, step: 1, signal: new AbortController().signal },
      () => Promise.resolve({ kind: 'enter' as const, messages }))
    const rejected = await agentEvents(ctx, agent).waterfall('agent/pre-step',
      { messages: [user], turn: 1, step: 1, signal }, () => Promise.resolve({ kind: 'reject' as const }))
    expect(rejected).toEqual({ kind: 'reject' })
    const image = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'image', attachment: { attachmentId: `sha256:${'a'.repeat(64)}` as never, mediaType: 'image/png', bytes: 1, width: 1, height: 1 } }] })
    await expect(invoke([image])).resolves.toMatchObject({ messages: [image] })
    const decision = await invoke([user])
    if (decision.kind !== 'enter') throw new Error('Expected admitted bundled instructions')
    expect(decision.messages).toHaveLength(2)
    const injection = decision.messages[1]!
    expect(injection.source).toEqual({ kind: 'skill-invocation', name: skill.name, form: 'instructions',
      bundled: { version: skill.version, digest: skill.digest } })
    expect(injection.content).toHaveLength(1)
    const content = injection.content[0]!
    expect(content.type).toBe('text')
    if (content.type !== 'text') throw new Error('Expected bundled instruction text')
    expect(content.text).toContain('Instructions')
    session.append('turn/start', { turn: 1 })
    for (const message of decision.messages) session.append('user/message', message, { surfaceOp: 'append' })
    const replay = session.snapshotEvents().filter(event => event.type === 'user/message')
    expect(replay.map(event => event.data.source)).toEqual([user.source, injection.source])
    const ordinary = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '/example' }] })
    await expect(invoke([ordinary])).resolves.toMatchObject({ messages: [ordinary] })
    const external = createUserMessage({ source: injection.source, content: user.content })
    await expect(invoke([external])).resolves.toMatchObject({ messages: [external] })
    const invalid = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '/mantur-builtin:example@0.0.0#bad' }] })
    await expect(invoke([invalid])).rejects.toThrow('Invalid App-bundled Skill reference')
    const restricted = await catalog(markdown.replace('version: 1.0.0', 'version: 1.0.0\nuser-invocable: false'))
    const restrictedContext = new Context()
    try {
      new ManturHubMarketplace(restrictedContext, { dshHome: root, bundledSkillDir: restricted.root })
      const restrictedUser = createUserMessage({ source: { kind: 'user' }, content: [
        { type: 'text', text: `/mantur-builtin:${bundledSkillReference(restricted.pinned)}` },
      ] })
      await expect(agentEvents(restrictedContext, { ...agent, ctx: restrictedContext }).waterfall('agent/pre-step',
        { messages: [restrictedUser], turn: 1, step: 1, signal },
        () => Promise.resolve({ kind: 'enter' as const, messages: [restrictedUser] }))).rejects.toThrow('not user-invocable')
    } finally { await restrictedContext.fiber.dispose() }
    const unconfigured = new ManturHubMarketplace(unconfiguredContext, { dshHome: root })
    await expect(unconfigured.bundled(signal)).rejects.toThrow('not configured')
  } finally {
    await ctx.fiber.dispose()
    await unconfiguredContext.fiber.dispose()
  }
})


const limits = { maxMetadataBytes: 65536, maxFiles: 10, maxUnpackedBytes: 65536 }
async function catalog(text = markdown) {
  const root = await fixture()
  const item = { ...identity, files: [{ path: 'SKILL.md', bytes: Buffer.byteLength(text),
    sha256: createHash('sha256').update(text).digest('hex') }] }
  const pinned = { ...item, digest: bundledSkillDigest(item) }
  const directory = join(root, bundledSkillDirectory(pinned))
  await mkdir(directory)
  await writeFile(join(directory, 'SKILL.md'), text)
  await writeFile(join(root, 'manifest.json'), JSON.stringify({ formatVersion: 1, skills: [pinned] }))
  return { root, pinned, directory }
}

it('rejects resource and metadata limits before reading bundled instructions', async () => {
  const { root } = await catalog()
  for (const bound of [{ maxMetadataBytes: 1 }, { maxFiles: 0 }, { maxUnpackedBytes: 1 }]) {
    await expect(readBundledCatalog(root, { ...limits, ...bound })).rejects.toThrow(/limit/)
  }
  await expect(loadBundledSkill(undefined, skill, limits)).rejects.toThrow('not configured')
})

it.each([
  ['missing frontmatter', 'no frontmatter', 'missing YAML frontmatter'],
  ['invalid frontmatter', '---\nname: [invalid\n---\nbody', 'Invalid App-bundled'],
  ['mismatched name', markdown.replace('name: example', 'name: another'), 'name differs'],
] as const)('rejects %s even when its file digest is valid', async (_name, text, error) => {
  const { root, pinned } = await catalog(text)
  await expect(loadBundledSkill(root, pinned, limits)).rejects.toThrow(error)
})

it.each([
  ['SKILL.md', 'SKILL.md'], ['SKILL.md', 'skill.md'], ['z.txt', 'SKILL.md'], ['other.txt'],
])('rejects an invalid ordered inventory %o', (...paths) => {
  const files = paths.map(path => ({ ...skill.files[0]!, path }))
  const item = { ...skill, files }
  item.digest = bundledSkillDigest(item)
  expect(() => parseBundledManifest({ formatVersion: 1, skills: [item] })).toThrow('Invalid bundled skill inventory')
})

it('rejects a file in place of the bundle root and a bundle lacking instructions', async () => {
  const root = await fixture()
  await expect(verifyBundledSkill(join(root, 'SKILL.md'), skill)).rejects.toThrow('root must be a directory')
  const empty = { ...skill, files: [] }
  await rm(join(root, 'SKILL.md'))
  await expect(verifyBundledSkill(root, empty)).rejects.toThrow('no SKILL.md')
})

it('verifies nested resources and rejects a resized file', async () => {
  const root = await fixture()
  await mkdir(join(root, 'references'))
  await writeFile(join(root, 'references', 'sample.txt'), 'sample')
  const nested = { ...skill, files: [...skill.files, { path: 'references/sample.txt', bytes: 6,
    sha256: createHash('sha256').update('sample').digest('hex') }] }
  expect(await verifyBundledSkill(root, nested)).toBe(markdown)
  await writeFile(join(root, 'references', 'sample.txt'), 'resized sample')
  await expect(verifyBundledSkill(root, nested)).rejects.toThrow('file differs')
})


it('rejects a manifest that grows after its initial size observation', async () => {
  const { root } = await catalog()
  const open = fsPromises.open
  vi.spyOn(fsPromises, 'open').mockImplementationOnce(async (...args) => {
    const handle = await open(...args)
    const stat = handle.stat.bind(handle)
    vi.spyOn(handle, 'stat').mockImplementationOnce(async () => {
      const before = await stat()
      await fsPromises.appendFile(join(root, 'manifest.json'), ' ')
      return before
    })
    return handle
  })
  await expect(readBundledCatalog(root, limits)).rejects.toThrow('changed during its read')
})
