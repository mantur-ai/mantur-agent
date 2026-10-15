/** Online releases remain immutable and exact references survive later updates. */
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { zipSync, strToU8 } from 'fflate'
import { afterEach, expect, it } from 'vitest'
import ManturHubMarketplace from '../src/index.ts'
import { bundledSkillDigest, bundledSkillDirectory } from '../src/bundled-manifest.ts'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
async function subject() {
  const home = await mkdtemp(join(tmpdir(), 'bundled-update-'))
  cleanup.push(() => rm(home, { recursive: true, force: true }))
  const resources = join(home, 'app')
  const markdown = (version: string) => `---\nname: example\nversion: ${version}\ndescription: Example\n---\nVersion ${version}\n`
  const original = markdown('1.0.0')
  const seed = { name: 'example', title: 'Example', version: '1.0.0', files: [
    { path: 'SKILL.md', bytes: Buffer.byteLength(original), sha256: createHash('sha256').update(original).digest('hex') },
  ] }
  const identity = { ...seed, digest: bundledSkillDigest(seed) }
  await mkdir(join(resources, bundledSkillDirectory(identity)), { recursive: true })
  await writeFile(join(resources, bundledSkillDirectory(identity), 'SKILL.md'), original)
  await writeFile(join(resources, 'manifest.json'), JSON.stringify({ formatVersion: 1, skills: [identity] }))
  const state = { version: '1.1.0', fail: false, badDigest: false, invalidName: false, requests: 0, downloads: 0 }
  const ctx = new Context()
  cleanup.push(() => ctx.fiber.dispose())
  ctx.provide('manturAccount', { request: async (path: string, options: { authenticated: boolean; signal: AbortSignal }) => {
    options.signal.throwIfAborted()
    expect(options.authenticated).toBe(false)
    state.requests++
    if (state.fail) throw new Error('network unavailable')
    const zip = zipSync({ 'SKILL.md': strToU8(markdown(state.version).replace('name: example', state.invalidName ? 'name: wrong' : 'name: example')) }, { mtime: new Date('2026-01-01T00:00:00Z') })
    if (path.endsWith('/bundle')) { state.downloads++; return new Response(zip) }
    return Response.json({ code: 0, data: { code: 'example', name: 'Example', skillVersion: state.version,
      bundleDigest: state.badDigest ? '0'.repeat(64) : createHash('sha256').update(zip).digest('hex') } })
  } } as never)
  const service = new ManturHubMarketplace(ctx, { dshHome: home, bundledSkillDir: resources })
  return { service, state, home, signal: new AbortController().signal }
}

it('updates recommended Skills, reuses verified releases, and resolves old references offline', async () => {
  const s = await subject()
  const original = (await s.service.bundled(s.signal))[0]!
  const first = (await s.service.updateBundled(s.signal))[0]!
  expect(first.version).toBe('1.1.0')
  expect(first.reference).not.toBe(original.reference)
  await s.service.updateBundled(s.signal)
  expect(s.state.downloads).toBe(1)
  s.state.version = '1.2.0'
  expect((await s.service.updateBundled(s.signal))[0]?.version).toBe('1.2.0')
  s.state.fail = true
  expect(await s.service.resolveBundled(first.reference, s.signal)).toEqual(first)
  expect(await s.service.resolveBundled(original.reference, s.signal)).toEqual(original)
  await expect(s.service.updateBundled(s.signal)).rejects.toThrow('network unavailable')
  expect(await readFile(join(s.home, 'manturhub-marketplace/bundled-updates/example@1.1.0', `example-${first.digest}`, 'SKILL.md'), 'utf8')).toContain('Version 1.1.0')
})

it.each(['badDigest', 'invalidName'] as const)('rejects an invalid update: %s', async (key) => {
  const s = await subject()
  s.state[key] = true
  await expect(s.service.updateBundled(s.signal)).rejects.toThrow()
  s.state[key] = false
  expect((await s.service.updateBundled(s.signal))[0]?.version).toBe('1.1.0')
})

it('refuses modified cached resources and same-version replacements', async () => {
  const s = await subject()
  const first = (await s.service.updateBundled(s.signal))[0]!
  s.state.badDigest = true
  await expect(s.service.updateBundled(s.signal)).rejects.toThrow('without a new version')
  s.state.badDigest = false
  await writeFile(join(s.home, 'manturhub-marketplace/bundled-updates/example@1.1.0', `example-${first.digest}`, 'SKILL.md'), 'tampered')
  await expect(s.service.updateBundled(s.signal)).rejects.toThrow('file differs')
})

it('cancels before starting a download', async () => {
  const s = await subject()
  const abort = new AbortController(); abort.abort()
  await expect(s.service.updateBundled(abort.signal)).rejects.toThrow()
  expect(s.state.requests).toBe(0)
})
