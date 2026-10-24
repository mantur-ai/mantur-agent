/** Update publication keeps verified winners and reports filesystem and metadata failures. */
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { strToU8, zipSync } from 'fflate'
import { afterEach, expect, it, vi } from 'vitest'
import { updateBundledSkills, updatedSkillRoot } from '../src/bundled-updates.ts'
import { bundledSkillDigest, bundledSkillDirectory, type BundledSkillManifest } from '../src/bundled-manifest.ts'
import { loadBundledSkill } from '../src/bundled-catalog.ts'
import { downloadBundle } from '../src/installer.ts'
import { SkillPreferences } from '../src/skill-preferences.ts'

const faults = vi.hoisted(() => ({
  inspect: undefined as string | undefined,
  commit: undefined as ((from: string, to: string) => Promise<void>) | undefined,
  open: undefined as string | undefined,
  read: undefined as string | undefined,
  unsupportedEntry: false,
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    lstat: async (path: string) => {
      if (path === faults.inspect) throw Object.assign(new Error('release inspection denied'), { code: 'EACCES' })
      return await actual.lstat(path)
    },
    open: async (...args: Parameters<typeof actual.open>) => {
      if (args[0] === faults.open) throw 'packaged read failed'
      return await actual.open(...args)
    },
    readFile: async (...args: Parameters<typeof actual.readFile>) => {
      if (args[0] === faults.read) throw Object.assign(new Error('preferences read denied'), { code: 'EACCES' })
      return await actual.readFile(...args)
    },
    readdir: async (...args: Parameters<typeof actual.readdir>) => {
      const entries = await actual.readdir(...args)
      if (faults.unsupportedEntry && basename(String(args[0])) === 'resources') {
        return [...entries, { name: 'unexpected-link', isDirectory: () => false, isFile: () => false }]
      }
      return entries
    },
    rename: async (from: string, to: string) => {
      if (basename(from) === 'release') await faults.commit?.(from, to)
      await actual.rename(from, to)
    },
  }
})

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => {
  faults.inspect = undefined
  faults.commit = undefined
  faults.open = undefined
  faults.read = undefined
  faults.unsupportedEntry = false
  vi.unstubAllGlobals()
  for (const close of cleanup.splice(0).reverse()) await close()
})

async function subject(files: Record<string, string> = {}) {
  const home = await mkdtemp(join(tmpdir(), 'bundled-failures-'))
  cleanup.push(() => rm(home, { recursive: true, force: true }))
  const resources = join(home, 'app')
  const root = join(home, 'updates')
  const markdown = (version: string) => `---\nname: example\nversion: ${version}\ndescription: Example\n---\nVersion ${version}\n`
  const original = markdown('1.0.0')
  const seed = { name: 'example', title: 'Example', version: '1.0.0', files: [
    { path: 'SKILL.md', bytes: Buffer.byteLength(original), sha256: createHash('sha256').update(original).digest('hex') },
  ] }
  const identity = { ...seed, digest: bundledSkillDigest(seed) }
  await mkdir(join(resources, bundledSkillDirectory(identity)), { recursive: true })
  await writeFile(join(resources, bundledSkillDirectory(identity), 'SKILL.md'), original)
  await writeFile(join(resources, 'manifest.json'), JSON.stringify({ formatVersion: 1, skills: [identity] }))
  const archive = zipSync(Object.fromEntries(Object.entries({ 'SKILL.md': markdown('1.1.0'), ...files })
    .map(([name, text]) => [name, strToU8(text)])))
  const digest = createHash('sha256').update(archive).digest('hex')
  const state = { metadataName: 'example', missing: false, error: undefined as string | undefined, requests: 0 }
  const ctx = new Context()
  cleanup.push(() => ctx.fiber.dispose())
  ctx.provide('manturAccount', { request: async (path: string) => {
    state.requests++
    if (state.error !== undefined) throw state.error
    if (state.missing) return undefined
    if (path.endsWith('/bundle')) return new Response(archive)
    return Response.json({ code: 0, data: { code: state.metadataName, name: 'Example', skillVersion: '1.1.0', bundleDigest: digest } })
  } } as never)
  const config = { dshHome: home, skillsRoot: join(home, 'skills'), maxBundleBytes: 1024 * 1024,
    maxFiles: 100, maxUnpackedBytes: 1024 * 1024, maxMetadataBytes: 1024 * 1024,
    metadataTimeoutMs: 1000, downloadTimeoutMs: 1000 }
  const signal = new AbortController().signal
  const run = () => updateBundledSkills(ctx, [identity], root, config, signal, resources)
  return { home, root, resources, identity, archive, digest, state, ctx, config, signal, run,
    destination: updatedSkillRoot(root, { name: 'example', version: '1.1.0' }) }
}

it('inventories nested resources with a reflexive, antisymmetric comparator and canonical path order', async () => {
  const s = await subject({ 'a/nested.txt': 'nested', 'a.txt': 'sibling', 'z.txt': 'last', 'B.txt': 'first' })
  const originalSort = Array.prototype.sort
  let checkedInventories = 0
  // Array.sort may compare an element with itself even when filesystem paths are unique.
  const sort = vi.spyOn(Array.prototype, 'sort').mockImplementation(function (
    this: unknown[], compare?: (a: unknown, b: unknown) => number,
  ) {
    if (compare !== undefined && this.length > 0 && this.every((entry): entry is BundledSkillManifest['files'][number] =>
      typeof entry === 'object' && entry !== null && 'path' in entry && typeof entry.path === 'string'
      && 'bytes' in entry && typeof entry.bytes === 'number' && 'sha256' in entry && typeof entry.sha256 === 'string')) {
      checkedInventories++
      for (const a of this) {
        expect(compare(a, a)).toBe(0)
        for (const b of this) expect(Math.sign(compare(a, b)) + Math.sign(compare(b, a))).toBe(0)
      }
    }
    originalSort.call(this, compare)
    return this
  })
  try {
    const result = await s.run()
    expect(result.updates).toEqual([{ name: 'example', status: 'verified' }])
    expect(checkedInventories).toBeGreaterThan(0)
    const identity = result.skills[0]!
    expect(identity.files.map(file => file.path)).toEqual(['B.txt', 'SKILL.md', 'a.txt', 'a/nested.txt', 'z.txt'])
    const loaded = await loadBundledSkill(s.destination, identity, s.config, s.signal)
    expect(await readFile(join(loaded.directory, 'a/nested.txt'), 'utf8')).toBe('nested')
    expect(await s.run()).toEqual(result)
  } finally {
    sort.mockRestore()
  }
})

it.each([
  ['missing response', 'Skill update metadata failed: example (HTTP unavailable)'],
  ['different name', 'Skill update returned a different name'],
  ['string rejection', 'metadata failed'],
])('retains the verified packaged identity after metadata %s', async (kind, error) => {
  const s = await subject()
  if (kind === 'missing response') s.state.missing = true
  if (kind === 'different name') s.state.metadataName = 'different'
  if (kind === 'string rejection') s.state.error = 'metadata failed'
  expect(await s.run()).toEqual({ skills: [s.identity], updates: [{ name: 'example', status: 'failed', stage: 'metadata', error }] })
  expect(s.state.requests).toBe(1)
})

it('reports a non-Error packaged read failure without returning an unverified fallback', async () => {
  const s = await subject()
  s.state.error = 'metadata failed'
  faults.open = join(s.resources, 'manifest.json')
  expect(await s.run()).toEqual({ skills: [], updates: [{ name: 'example', status: 'failed', stage: 'metadata',
    error: 'metadata failed', localError: 'packaged read failed' }] })
})

it.each(['file', 'denied'] as const)('refuses an update destination that is %s', async (kind) => {
  const s = await subject()
  await mkdir(s.root)
  if (kind === 'file') await writeFile(s.destination, 'user data')
  else faults.inspect = s.destination
  expect((await s.run()).updates).toEqual([{ name: 'example', status: 'failed', stage: 'verification',
    error: kind === 'file' ? 'Skill update store is not a real directory' : 'release inspection denied' }])
  expect(s.state.requests).toBe(1)
  if (kind === 'file') expect(await readFile(s.destination, 'utf8')).toBe('user data')
})

it.each(['empty', 'multiple', 'name', 'version'] as const)('rejects cached release identity mismatch: %s', async (kind) => {
  const s = await subject()
  const installed = (await s.run()).skills[0]!
  const changed = { ...installed, ...(kind === 'name' ? { name: 'different' } : {}), ...(kind === 'version' ? { version: '2.0.0' } : {}) }
  const identity = { ...changed, digest: bundledSkillDigest(changed) }
  const skills = kind === 'empty' ? [] : kind === 'multiple' ? [installed, s.identity] : [identity]
  // A distinct second name keeps the manifest valid while violating the one-release store requirement.
  if (kind === 'multiple') {
    const second = { ...s.identity, name: 'second' }
    skills[1] = { ...second, digest: bundledSkillDigest(second) }
  }
  await writeFile(join(s.destination, 'manifest.json'), JSON.stringify({ formatVersion: 1, skills }))
  expect((await s.run()).updates).toEqual([{ name: 'example', status: 'failed', stage: 'verification', error: 'Stored Skill release identity differs' }])
  expect(s.state.requests).toBe(3)
})

it('rejects an expanded inventory manifest that exceeds the metadata bound', async () => {
  const s = await subject(Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`resource-${i}.txt`, 'data'])))
  s.config.maxMetadataBytes = 1024
  expect((await s.run()).updates).toEqual([{ name: 'example', status: 'failed', stage: 'verification', error: 'Skill update manifest exceeds metadata limit' }])
  expect(await readdir(s.root)).toEqual([])
})

it('rejects an unexpected filesystem node introduced after extraction', async () => {
  const s = await subject()
  faults.unsupportedEntry = true
  expect((await s.run()).updates).toEqual([{ name: 'example', status: 'failed', stage: 'verification', error: 'Unsupported updated Skill entry: unexpected-link' }])
  expect(await readdir(s.root)).toEqual([])
})

it.each(['EEXIST', 'ENOTEMPTY'] as const)('accepts only identical verified bytes when another publisher wins: %s', async (code) => {
  const s = await subject()
  faults.commit = async (from, to) => {
    await cp(from, to, { recursive: true, errorOnExist: true })
    throw Object.assign(new Error('another publisher committed'), { code })
  }
  const result = await s.run()
  expect(result.updates).toEqual([{ name: 'example', status: 'verified' }])
  expect(await readFile(join(s.destination, 'archive.sha256'), 'utf8')).toBe(s.digest)
  expect((await loadBundledSkill(s.destination, result.skills[0]!, s.config, s.signal)).skill.content).toContain('Version 1.1.0')
  expect(await readdir(s.root)).toEqual(['example@1.1.0'])
})

it.each(['digest', 'resource'] as const)('rejects a competing publication with different %s bytes', async (kind) => {
  const s = await subject()
  faults.commit = async (from, to) => {
    await cp(from, to, { recursive: true, errorOnExist: true })
    if (kind === 'digest') await writeFile(join(to, 'archive.sha256'), '0'.repeat(64))
    else {
      const manifest = JSON.parse(await readFile(join(to, 'manifest.json'), 'utf8')) as { skills: typeof s.identity[] }
      await writeFile(join(to, bundledSkillDirectory(manifest.skills[0]!), 'SKILL.md'), 'tampered')
    }
    throw Object.assign(new Error('another publisher committed'), { code: 'EEXIST' })
  }
  expect(await s.run()).toEqual({ skills: [s.identity], updates: [{ name: 'example', status: 'failed', stage: 'verification',
    error: kind === 'digest' ? 'another publisher committed' : 'Bundled skill file differs: SKILL.md' }] })
  expect(await readdir(s.root)).toEqual(['example@1.1.0'])
})

it.each([undefined, 'EACCES'])('preserves publication errors without a collision code: %s', async (code) => {
  const s = await subject()
  faults.commit = async () => { throw Object.assign(new Error('commit denied'), { code }) }
  expect(await s.run()).toEqual({ skills: [s.identity], updates: [{ name: 'example', status: 'failed', stage: 'verification', error: 'commit denied' }] })
  expect(await readdir(s.root)).toEqual([])
})

it('forwards caller cancellation to a redirected download without authorization', async () => {
  const s = await subject()
  const abort = new AbortController()
  const request = vi.fn(async (_url: string | URL | Request, options?: RequestInit) => {
    expect(options?.headers).toBeUndefined()
    expect(options?.redirect).toBe('error')
    expect(options?.signal?.aborted).toBe(false)
    abort.abort(new Error('caller cancelled'))
    expect(options?.signal?.aborted).toBe(true)
    options?.signal?.throwIfAborted()
    return new Response(s.archive)
  })
  vi.stubGlobal('fetch', request)
  const ctx = new Context()
  cleanup.push(() => ctx.fiber.dispose())
  ctx.provide('manturAccount', { request: async () => new Response(null, { status: 302, headers: { location: 'https://bundles.example/skill.zip' } }) } as never)
  await expect(downloadBundle(ctx, 'example', join(s.home, 'bundle.zip'), s.config, abort.signal)).rejects.toThrow('caller cancelled')
  expect(request).toHaveBeenCalledOnce()
})

it('propagates preferences read errors rather than treating unreadable state as enabled', async () => {
  const s = await subject()
  const path = join(s.home, 'preferences.json')
  const persisted = JSON.stringify({ disabled: ['example'] })
  await writeFile(path, persisted)
  faults.read = path
  const preferences = new SkillPreferences(path)
  await expect(preferences.enabled('example')).rejects.toMatchObject({ code: 'EACCES' })
  await expect(preferences.set('example', true)).rejects.toMatchObject({ code: 'EACCES' })
  faults.read = undefined
  expect(await readFile(path, 'utf8')).toBe(persisted)
})
