/** Immutable bundled resources reject altered inventories and files before loading instructions. */
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { agentEvents, Inbox, type Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, type UserMessage } from '@deepseek-ai/dsh-session'
import ManturHubMarketplace from '../src/index.ts'
import { loadBundledSkill } from '../src/bundled-catalog.ts'
import { bundledSkillDigest, bundledSkillDirectory, bundledSkillReference, parseBundledManifest, verifyBundledSkill } from '../src/bundled-manifest.ts'

const markdown = '---\nname: example\ndescription: Test skill\nversion: 1.0.0\n---\nInstructions\n'
const identity = {
  name: 'example', title: '示例', version: '1.0.0',
  files: [{ path: 'SKILL.md', bytes: Buffer.byteLength(markdown), sha256: createHash('sha256').update(markdown).digest('hex') }],
}
const skill = { ...identity, digest: bundledSkillDigest(identity) }
const temporary: string[] = []
afterEach(async () => {
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
    const decision = await invoke([user])
    if (decision.kind !== 'enter') throw new Error('Expected admitted bundled instructions')
    expect(decision.messages).toHaveLength(2)
    const injection = decision.messages[1]!
    expect(injection.source).toEqual({ kind: 'skill-invocation', name: skill.name, form: 'instructions',
      bundled: { version: skill.version, digest: skill.digest } })
    expect(injection.content).toEqual([{ type: 'text', text: expect.stringContaining('Instructions') }])
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
    const unconfigured = new ManturHubMarketplace(unconfiguredContext, { dshHome: root })
    await expect(unconfigured.bundled(signal)).rejects.toThrow('not configured')
  } finally {
    await ctx.fiber.dispose()
    await unconfiguredContext.fiber.dispose()
  }
})
