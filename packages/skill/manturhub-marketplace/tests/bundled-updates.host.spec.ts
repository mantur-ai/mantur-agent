/** Online releases remain immutable and exact references survive later updates. */
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { zipSync, strToU8 } from 'fflate'
import { afterEach, expect, it } from 'vitest'
import ManturHubMarketplace from '../src/index.ts'
import { bundledSkillDigest, bundledSkillDirectory } from '../src/bundled-manifest.ts'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
async function subject(names = ['example'], bundledUpdateNames?: string[]) {
  const home = await mkdtemp(join(tmpdir(), 'bundled-update-'))
  cleanup.push(() => rm(home, { recursive: true, force: true }))
  const resources = join(home, 'app')
  const markdown = (version: string, name = 'example') => `---\nname: ${name}\nversion: ${version}\ndescription: Example\n---\nVersion ${version}\n`
  const identities = []
  for (const name of names) {
    const original = markdown('1.0.0', name)
    const seed = { name, title: name, version: '1.0.0', files: [
      { path: 'SKILL.md', bytes: Buffer.byteLength(original), sha256: createHash('sha256').update(original).digest('hex') },
    ] }
    const identity = { ...seed, digest: bundledSkillDigest(seed) }
    identities.push(identity)
    await mkdir(join(resources, bundledSkillDirectory(identity)), { recursive: true })
    await writeFile(join(resources, bundledSkillDirectory(identity), 'SKILL.md'), original)
  }
  await writeFile(join(resources, 'manifest.json'), JSON.stringify({ formatVersion: 1, skills: identities }))
  const state = { version: '1.1.0', fail: false, badDigest: false, invalidName: false, requests: 0, downloads: 0,
    missing: new Set<string>(), offline: new Set<string>(), downloadFailure: false, abort: undefined as AbortController | undefined }
  const ctx = new Context()
  cleanup.push(() => ctx.fiber.dispose())
  ctx.provide('manturAccount', { request: async (path: string, options: { authenticated: boolean; signal: AbortSignal }) => {
    options.signal.throwIfAborted()
    expect(options.authenticated).toBe(false)
    state.requests++
    const name = path.split('/')[6]!
    state.abort?.abort()
    options.signal.throwIfAborted()
    if (state.fail || state.offline.has(name)) throw new Error('network unavailable')
    if (state.missing.has(name)) return new Response(null, { status: 404 })
    const zip = zipSync({ 'SKILL.md': strToU8(markdown(state.version, state.invalidName ? 'wrong' : name)) }, { mtime: new Date('2026-01-01T00:00:00Z') })
    if (path.endsWith('/bundle')) {
      state.downloads++
      if (state.downloadFailure) throw new Error('download unavailable')
      return new Response(zip)
    }
    return Response.json({ code: 0, data: { code: name, name, skillVersion: state.version,
      bundleDigest: state.badDigest ? '0'.repeat(64) : createHash('sha256').update(zip).digest('hex') } })
  } } as never)
  const service = new ManturHubMarketplace(ctx, { dshHome: home, bundledSkillDir: resources,
    ...(bundledUpdateNames === undefined ? {} : { bundledUpdateNames }) })
  return { service, state, home, resources, identities, signal: new AbortController().signal }
}

it('retains excluded packaged references without querying their retired releases', async () => {
  const s = await subject(['short-drama', 'mantur-smartclip', 'overseas-comic-script-studio'], ['overseas-comic-script-studio'])
  const original = (await s.service.bundled(s.signal))[0]!
  s.state.missing.add('short-drama')
  s.state.missing.add('mantur-smartclip')
  const first = await s.service.updateBundled(s.signal)
  expect(first.updates).toEqual([{ name: 'overseas-comic-script-studio', status: 'verified' }])
  expect(s.state.requests).toBe(2)
  await s.service.updateBundled(s.signal)
  expect(s.state.requests).toBe(3)
  expect(s.state.downloads).toBe(1)
  expect(await s.service.resolveBundled(original.reference, s.signal)).toEqual(original)
})

it('rejects configured update names absent from packaged resources before any request', async () => {
  const s = await subject(['example'], ['missing'])
  await expect(s.service.updateBundled(s.signal)).rejects.toThrow('Configured bundled update Skill is missing: missing')
  expect(s.state.requests).toBe(0)
})

it('updates recommended Skills, reuses verified releases, and resolves old references offline', async () => {
  const s = await subject()
  const original = (await s.service.bundled(s.signal))[0]!
  const first = (await s.service.updateBundled(s.signal)).skills[0]!
  expect(first.version).toBe('1.1.0')
  expect(first.reference).not.toBe(original.reference)
  await s.service.updateBundled(s.signal)
  expect(s.state.downloads).toBe(1)
  s.state.version = '1.2.0'
  expect((await s.service.updateBundled(s.signal)).skills[0]?.version).toBe('1.2.0')
  s.state.fail = true
  expect(await s.service.resolveBundled(first.reference, s.signal)).toEqual(first)
  expect(await s.service.resolveBundled(original.reference, s.signal)).toEqual(original)
  expect(await s.service.updateBundled(s.signal)).toMatchObject({ skills: [original], updates: [
    { name: 'example', status: 'failed', stage: 'metadata', error: 'network unavailable' },
  ] })
  expect(await readFile(join(s.home, 'manturhub-marketplace/bundled-updates/example@1.1.0', `example-${first.digest}`, 'SKILL.md'), 'utf8')).toContain('Version 1.1.0')
})

it.each(['badDigest', 'invalidName'] as const)('retains the verified seed after an invalid update: %s', async (key) => {
  const s = await subject()
  s.state[key] = true
  const result = await s.service.updateBundled(s.signal)
  expect(result.skills[0]?.version).toBe('1.0.0')
  expect(result.updates).toEqual([{ name: 'example', status: 'failed', stage: 'verification', error: key === 'badDigest' ? 'Skill archive digest differs: example' : 'App-bundled Skill name differs: example' }])
  expect(await readdir(join(s.home, 'manturhub-marketplace/bundled-updates'))).toEqual([])
  s.state[key] = false
  expect((await s.service.updateBundled(s.signal)).skills[0]?.version).toBe('1.1.0')
})

it('refuses modified cached resources and same-version replacements', async () => {
  const s = await subject()
  const first = (await s.service.updateBundled(s.signal)).skills[0]!
  s.state.badDigest = true
  expect((await s.service.updateBundled(s.signal)).updates).toMatchObject([{ status: 'failed', stage: 'verification', error: 'Published Skill changed without a new version: example@1.1.0' }])
  s.state.badDigest = false
  await writeFile(join(s.home, 'manturhub-marketplace/bundled-updates/example@1.1.0', `example-${first.digest}`, 'SKILL.md'), 'tampered')
  expect((await s.service.updateBundled(s.signal)).updates).toMatchObject([{ status: 'failed', stage: 'verification', error: 'Bundled skill file differs: SKILL.md' }])
  await expect(s.service.resolveBundled(first.reference, s.signal)).rejects.toThrow('file differs')
})

it('cancels before starting a download', async () => {
  const s = await subject()
  const abort = new AbortController(); abort.abort()
  await expect(s.service.updateBundled(abort.signal)).rejects.toThrow()
  expect(s.state.requests).toBe(0)
})

it('continues past 404 and network failures and returns exact usable references', async () => {
  const s = await subject(['missing', 'offline', 'example'])
  s.state.missing.add('missing')
  s.state.offline.add('offline')
  const result = await s.service.updateBundled(s.signal)
  expect(result.skills.map(skill => [skill.name, skill.version])).toEqual([
    ['missing', '1.0.0'], ['offline', '1.0.0'], ['example', '1.1.0'],
  ])
  expect(result.updates).toEqual([
    { name: 'missing', status: 'failed', stage: 'metadata', error: 'Skill update metadata failed: missing (HTTP 404)' },
    { name: 'offline', status: 'failed', stage: 'metadata', error: 'network unavailable' },
    { name: 'example', status: 'verified' },
  ])
  for (const skill of result.skills) expect(await s.service.resolveBundled(skill.reference, s.signal)).toEqual(skill)
})

it('excludes damaged packaged resources without suppressing other verified skills', async () => {
  const s = await subject(['missing', 'example'])
  s.state.missing.add('missing')
  await writeFile(join(s.resources, bundledSkillDirectory(s.identities[0]!), 'SKILL.md'), 'tampered')
  const result = await s.service.updateBundled(s.signal)
  expect(result.skills.map(skill => skill.name)).toEqual(['example'])
  expect(result.updates[0]).toMatchObject({ name: 'missing', status: 'failed', localError: 'Bundled skill file differs: SKILL.md' })
})

it('records download failures separately and retries successfully', async () => {
  const s = await subject()
  s.state.downloadFailure = true
  expect((await s.service.updateBundled(s.signal)).updates).toEqual([
    { name: 'example', status: 'failed', stage: 'download', error: 'download unavailable' },
  ])
  s.state.downloadFailure = false
  expect((await s.service.updateBundled(s.signal)).updates).toEqual([{ name: 'example', status: 'verified' }])
})

it('propagates cancellation during metadata instead of returning fallback success', async () => {
  const s = await subject(['example', 'second'])
  s.state.abort = new AbortController()
  await expect(s.service.updateBundled(s.state.abort.signal)).rejects.toThrow()
  expect(s.state.requests).toBe(1)
  expect(s.state.downloads).toBe(0)
})
