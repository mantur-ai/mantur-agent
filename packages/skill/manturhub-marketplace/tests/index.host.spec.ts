import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { ManturHubRequestOptions } from '@deepseek-ai/dsh-authorization-manturhub'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ManturHubMarketplace from '../src/index.ts'

const { lstatFixture } = vi.hoisted(() => ({ lstatFixture: vi.fn() }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  lstatFixture.mockImplementation(actual.lstat)
  return { ...actual, lstat: lstatFixture }
})

const skill = {
  code: 'story-director',
  name: '故事导演',
  description: '把故事变成分镜',
  category: '剧本创作',
  skillVersion: '1.2.3',
  triggers: ['写分镜'],
  dependencies: ['op.text.generate'],
  readme: null,
  coverUrl: 'https://cdn.example/story.png',
}

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  vi.clearAllMocks()
  while (cleanups.length > 0) await cleanups.pop()!()
})

async function subject(
  request: (pathname: string, options: ManturHubRequestOptions) => Promise<Response | undefined>,
  options: { readonly signedIn?: boolean; readonly maxMetadataBytes?: number } = {},
): Promise<{ readonly home: string; readonly service: ManturHubMarketplace }> {
  const home = await mkdtemp(join(tmpdir(), 'dsh-mantur-index-'))
  cleanups.push(() => rm(home, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(async () => { await ctx.fiber.dispose() })
  ctx.provide('manturAccount', {
    request,
    status: () => Promise.resolve(options.signedIn === false
      ? { status: 'signed-out' as const }
      : { status: 'signed-in' as const, account: { email: 'artist@example.com' } }),
  } as never)
  return {
    home,
    service: new ManturHubMarketplace(ctx, {
      dshHome: home,
      ...(options.maxMetadataBytes === undefined ? {} : { maxMetadataBytes: options.maxMetadataBytes }),
    }),
  }
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('ManturHub marketplace metadata failures', () => {
  it('projects optional artwork, missing introduction, and signed-out state', async () => {
    const target = await subject(pathname => Promise.resolve(json(
      { code: 0, data: pathname.includes('?') ? { records: [skill], total: 1, pageNum: 1, pages: 1 } : skill },
    )), { signedIn: false })

    await expect(target.service.list()).resolves.toMatchObject({
      signedIn: false,
      skills: [{ logoUrl: skill.coverUrl }],
    })
    const detail = await target.service.detail(skill.code)
    expect(detail).toMatchObject({ logoUrl: skill.coverUrl })
    expect(detail).not.toHaveProperty('introduction')
  })

  it.each([
    ['missing response', undefined],
    ['HTTP failure', new Response('', { status: 503 })],
    ['missing body', new Response(null, { status: 200 })],
  ])('maps a catalog %s to a gateway failure', async (_label, response) => {
    const target = await subject(() => Promise.resolve(response))
    await expect(target.service.list()).rejects.toMatchObject({ code: 'gateway/internal' })
  })

  it('bounds and validates catalog metadata', async () => {
    const oversized = await subject(() => Promise.resolve(json({
      code: 0, data: { records: [skill], total: 1, pageNum: 1, pages: 1 },
    })), { maxMetadataBytes: 1 })
    await expect(oversized.service.list()).rejects.toMatchObject({ code: 'gateway/internal' })

    const malformed = await subject(() => Promise.resolve(json({ skills: [{ slug: false }] })))
    await expect(malformed.service.list()).rejects.toMatchObject({ code: 'gateway/internal' })
  })

  it('preserves a RemoteError raised by the account request', async () => {
    const failure = new RemoteError('gateway/bad-request', 'fixture rejection', {})
    const target = await subject(() => Promise.reject(failure))
    await expect(target.service.list()).rejects.toBe(failure)
  })

  it('reports a local installation-state filesystem error', async () => {
    const target = await subject(() => Promise.resolve(json({ code: 0, data: { records: [skill], total: 1, pageNum: 1, pages: 1 } })))
    lstatFixture.mockRejectedValueOnce(Object.assign(new Error('fixture lstat failure'), { code: 'EACCES' }))
    await expect(target.service.list()).rejects.toMatchObject({ code: 'gateway/internal' })
    expect(lstatFixture).toHaveBeenCalledWith(join(target.home, 'skills', skill.code))
  })

  it.each([
    ['missing response', undefined],
    ['HTTP failure', new Response('', { status: 503 })],
    ['missing body', new Response(null, { status: 200 })],
  ])('maps a detail %s to a gateway failure', async (_label, response) => {
    const target = await subject(() => Promise.resolve(response))
    await expect(target.service.detail(skill.code)).rejects.toMatchObject({ code: 'gateway/internal' })
  })

  it('rejects invalid, oversized, and mismatched detail metadata', async () => {
    const invalid = await subject(() => Promise.resolve(json({ skill: { slug: false } })))
    await expect(invalid.service.detail(skill.code)).rejects.toMatchObject({ code: 'gateway/internal' })

    const oversized = await subject(() => Promise.resolve(json(skill)), { maxMetadataBytes: 1 })
    await expect(oversized.service.detail(skill.code)).rejects.toMatchObject({ code: 'gateway/internal' })

    const mismatched = await subject(() => Promise.resolve(json({ code: 0, data: { ...skill, code: 'other-skill' } })))
    await expect(mismatched.service.detail(skill.code)).rejects.toMatchObject({ code: 'gateway/internal' })
  })

  it('rejects invalid slugs before any request', async () => {
    let requests = 0
    const target = await subject(() => {
      requests += 1
      return Promise.resolve(json(skill))
    })
    await expect(target.service.detail('../escape')).rejects.toMatchObject({ code: 'gateway/bad-request' })
    await expect(target.service.installSkill('../escape')).rejects.toMatchObject({ code: 'gateway/bad-request' })
    expect(requests).toBe(0)
  })

  it('preserves detail RemoteErrors through the serialized install operation', async () => {
    const failure = new RemoteError('gateway/bad-request', 'fixture rejection', {})
    const target = await subject(() => Promise.reject(failure))
    await expect(target.service.installSkill(skill.code)).rejects.toBe(failure)
  })
})


describe('public Skill gateway pagination', () => {
  it('loads every page and rejects unsuccessful gateway envelopes', async () => {
    const paths: string[] = []
    const target = await subject((path) => {
      paths.push(path)
      const pageNum = Number(new URL(path, 'https://hub.example').searchParams.get('pageNum'))
      return Promise.resolve(json({ code: 0, data: { pageNum, pages: 2, total: 2,
        records: [{ ...skill, code: pageNum === 1 ? 'story-director' : 'second-skill' }] } }))
    })
    expect((await target.service.list()).skills.map(value => value.slug)).toEqual(['story-director', 'second-skill'])
    expect(paths).toEqual([1, 2].map(page => `/api/public/agent/v1/skills?pageNum=${page}&pageSize=100`))
    const failed = await subject(() => Promise.resolve(json({ code: 403, data: { records: [] } })))
    await expect(failed.service.list()).rejects.toThrow('could not be loaded')
  })

  it.each([
    { pageNum: 2, pages: 1, total: 1, records: [skill] },
    { pageNum: 1, pages: 2, total: 2, records: [] },
    { pageNum: 1, pages: 1, total: 2, records: [skill, skill] },
    { pageNum: 1, pages: 1, total: 2, records: [skill] },
  ])('rejects incomplete or inconsistent pagination', async (data) => {
    const target = await subject(() => Promise.resolve(json({ code: 0, data })))
    await expect(target.service.list()).rejects.toThrow('could not be loaded')
  })
})
