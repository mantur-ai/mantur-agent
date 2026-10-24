import { createServer, type Server, type ServerResponse } from 'node:http'
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { ManturHubRequestOptions } from '@deepseek-ai/dsh-authorization-manturhub'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { strToU8, zipSync } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'
import ManturHubMarketplace from '../src/index.ts'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!()
})

interface HubOptions {
  readonly archive?: Uint8Array | (() => Uint8Array)
  readonly accountRequest?: (
    pathname: string,
    options: ManturHubRequestOptions,
    origin: string,
  ) => Promise<Response | undefined>
  readonly catalog?: unknown
  readonly detail?: unknown
  readonly recipeCatalog?: unknown
  readonly recipeDetail?: unknown
  readonly redirect?: string | null
}

const skill = {
  code: 'story-director',
  name: '故事导演',
  description: '把故事变成分镜',
  category: '剧本创作',
  skillVersion: '1.2.3',
  triggers: ['写分镜'],
  dependencies: ['op.text.generate'],
  readme: '先理解故事，再生成镜头。',
  coverUrl: null,
}

const recipe = {
  code: 'rcp.video.story-vlog',
  name: '电影感旅行 Vlog',
  summary: '把普通旅行素材变成有叙事节奏的短片。',
  category: 'video',
  tags: ['旅行', '电影感'],
  coverUrl: '/assets/recipe-cover.jpg',
  sampleUrl: '/assets/recipe-sample.mp4',
  sampleKind: 'VIDEO',
  targetOperatorCode: 'op.video.generate',
  publishedAt: '2026-08-25T03:51:03.407+00:00',
}
const recipeDetail = {
  ...recipe,
  description: recipe.summary,
  usage: '请先读取最新配方，再替换占位符并报价。',
  inputSchema: { type: 'object', properties: { prompt: { type: 'string', description: '画面描述' } }, required: ['prompt'] },
  steps: [{ operatorCode: 'op.video.generate', note: '生成视频后验收。' }, { operatorCode: 'op.video.compose', note: null }],
}

function bundle(files: Record<string, string> = {
  'SKILL.md': '---\nname: story-director\nversion: 1.2.3\ndescription: fixture\n---\n\n# Story\n',
  'references/guide.md': '# Guide\n',
}): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, value]) => [name, strToU8(value)])))
}

function sendJson(response: ServerResponse, value: unknown): void {
  response.setHeader('content-type', 'application/json')
  response.end(JSON.stringify(value))
}

function forwardRequest(pathname: string, options: ManturHubRequestOptions, origin: string): Promise<Response> {
  const init: RequestInit = {}
  if (options.headers !== undefined) init.headers = options.headers
  if (options.signal !== undefined) init.signal = options.signal
  return fetch(new URL(pathname, origin), init)
}

function responseBytes(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer
}

async function fakeHub(options: HubOptions = {}): Promise<{
  readonly origin: string
  readonly requests: string[]
}> {
  const requests: string[] = []
  let origin = ''
  const server: Server = createServer((request, response) => {
    requests.push(`${request.url} ${request.headers['x-api-key'] ?? ''} ${request.headers['x-manturhub-client'] ?? ''}`)
    if (request.url === '/api/public/agent/v1/skills?pageNum=1&pageSize=100') {
      sendJson(response, options.catalog ?? { code: 0, data: { records: [skill], total: 1, pageNum: 1, pages: 1 } })
      return
    }
    if (request.url?.startsWith('/api/public/agent/v1/recipes?')) {
      sendJson(response, { code: 0, data: options.recipeCatalog ?? {
        records: [recipe], total: 1, pageNum: 1, pageSize: 15, pages: 1,
        available_tags: recipe.tags,
      } })
      return
    }
    if (request.url === `/api/public/agent/v1/recipes/${recipe.code}`) {
      sendJson(response, { code: 0, data: options.recipeDetail ?? recipeDetail })
      return
    }
    if (request.url === `/api/public/agent/v1/skills/${skill.code}`) {
      sendJson(response, options.detail ?? { code: 0, data: skill })
      return
    }
    if (request.url === `/api/public/agent/v1/skills/${skill.code}/bundle`) {
      if (request.headers['x-api-key'] !== undefined) {
        response.statusCode = 401
        response.end()
        return
      }
      if (options.redirect !== undefined) {
        response.statusCode = 302
        if (options.redirect !== null) response.setHeader('location', options.redirect)
        response.end()
        return
      }
      const archive = typeof options.archive === 'function' ? options.archive() : options.archive ?? bundle()
      response.setHeader('content-type', 'application/zip')
      response.setHeader('content-length', String(archive.byteLength))
      response.end(archive)
      return
    }
    response.statusCode = 404
    response.end()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('fake Hub did not bind')
  origin = `http://127.0.0.1:${address.port}`
  cleanups.push(() => new Promise<void>((resolve, reject) => {
    server.close((error) => { if (error === undefined) resolve(); else reject(error) })
  }))
  return { origin, requests }
}

async function boot(options: HubOptions & {
  readonly signedIn?: boolean
  readonly config?: ConstructorParameters<typeof ManturHubMarketplace>[1]
} = {}): Promise<{
  readonly home: string
  readonly ctx: Context
  readonly service: ManturHubMarketplace
  readonly requests: string[]
}> {
  const home = await mkdtemp(join(tmpdir(), 'dsh-mantur-marketplace-'))
  cleanups.push(() => rm(home, { recursive: true, force: true }))
  const hub = await fakeHub(options)
  const ctx = new Context()
  cleanups.push(async () => { await ctx.fiber.dispose() })
  ctx.provide('manturAccount', {
    status: () => Promise.resolve(options.signedIn === false
      ? { status: 'signed-out' as const }
      : { status: 'signed-in' as const, account: { email: 'artist@example.com' } }),
    request: (pathname: string, requestOptions: ManturHubRequestOptions) => {
      if (options.accountRequest !== undefined) {
        return options.accountRequest(pathname, requestOptions, hub.origin)
      }
      if (requestOptions.authenticated && options.signedIn === false) return Promise.resolve(undefined)
      const headers = new Headers(requestOptions.headers)
      if (requestOptions.authenticated) headers.set('x-api-key', 'fixture-key')
      return fetch(new URL(pathname, hub.origin), {
        headers,
        ...(requestOptions.redirect === undefined ? {} : { redirect: requestOptions.redirect }),
        ...(requestOptions.signal === undefined ? {} : { signal: requestOptions.signal }),
      })
    },
  } as never)
  return {
    home,
    ctx,
    service: new ManturHubMarketplace(ctx, { dshHome: home, ...options.config }),
    requests: hub.requests,
  }
}

describe('ManturHub marketplace Host', () => {
  it('loads public Recipe pages and resolves media URLs against the configured Hub', async () => {
    const subject = await boot({ signedIn: false })

    const catalog = await subject.service.listRecipes({ category: 'video', tag: ' 电影感 ', query: '旅行' })
    expect(catalog).toMatchObject({
      total: 1,
      page: 1,
      pageSize: 15,
      recipes: [{
        slug: recipe.code,
        category: 'video',
        publishedAt: recipe.publishedAt,
      }],
    })
    expect(catalog.recipes[0]?.coverUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/assets\/recipe-cover\.jpg$/)
    expect(subject.requests).toContain('/api/public/agent/v1/recipes?pageNum=1&pageSize=15&category=video&tag=%E7%94%B5%E5%BD%B1%E6%84%9F&keyword=%E6%97%85%E8%A1%8C  mantur-agent')
  })

  it('loads public Recipe detail with the authoritative Agent payload', async () => {
    const subject = await boot({ signedIn: false })

    const detail = await subject.service.recipeDetail(recipe.code)
    expect(detail).toMatchObject({
      slug: recipe.code,
      sampleText: '',
      parameters: null,
      inputSchema: recipeDetail.inputSchema,
      steps: recipeDetail.steps,
      models: [],
      agentPayload: recipeDetail.usage,
      publishedAt: recipeDetail.publishedAt,
    })
    expect(detail.sourceUrl).toBeUndefined()
  })

  it.each([{ steps: [{ operatorCode: 42, note: null }] }, { inputSchema: [] }])('rejects malformed published Recipe details: %j', async (invalid) => {
    const subject = await boot({ recipeDetail: { ...recipeDetail, ...invalid } })
    await expect(subject.service.recipeDetail(recipe.code)).rejects.toMatchObject({ code: 'gateway/internal' })
  })

  it('omits empty Recipe source metadata returned by production', async () => {
    const subject = await boot({
      signedIn: false,
      recipeDetail: {
        ...recipeDetail,
        usage: null,
      },
    })

    const detail = await subject.service.recipeDetail(recipe.code)
    expect(detail.agentPayload).toBe('')
    expect(detail.copies).toBeNull()
    expect(detail.priceDumplings).toBeNull()
    expect(detail).not.toHaveProperty('sourceUrl')
    expect(detail).not.toHaveProperty('sourceName')
    expect(detail).not.toHaveProperty('sourceAvatarUrl')
  })

  it('accepts gateway UTC and timezone-free Recipe timestamps', async () => {
    const utc = await boot({
      recipeCatalog: {
        records: [{ ...recipe, publishedAt: '2026-09-01T08:00:00.000Z' }],
        total: 1, pageNum: 1, pageSize: 15, pages: 1, available_tags: [],
      },
    })
    await expect(utc.service.listRecipes({})).resolves.toMatchObject({
      recipes: [{ publishedAt: '2026-09-01T08:00:00.000Z' }],
    })

    const local = await boot({
      recipeCatalog: {
        records: [{ ...recipe, publishedAt: '2026-09-01T08:00:00.000' }],
        total: 1, pageNum: 1, pageSize: 15, pages: 1, available_tags: [],
      },
    })
    await expect(local.service.listRecipes({})).resolves.toMatchObject({ recipes: [{ publishedAt: '2026-09-01T08:00:00.000' }] })
  })

  it('rejects malformed Recipe requests before contacting ManturHub', async () => {
    const subject = await boot()
    await expect(subject.service.listRecipes({ page: Number.NaN })).rejects.toMatchObject({ code: 'gateway/bad-request' })
    await expect(subject.service.listRecipes({ page: 0 })).rejects.toMatchObject({ code: 'gateway/bad-request' })
    await expect(subject.service.listRecipes({ tag: '   ' })).rejects.toMatchObject({ code: 'gateway/bad-request' })
    await expect(subject.service.listRecipes({ query: '   ' })).rejects.toMatchObject({ code: 'gateway/bad-request' })
    await expect(subject.service.recipeDetail('../private')).rejects.toMatchObject({ code: 'gateway/bad-request' })
    expect(subject.requests).toEqual([])
  })

  it.each([
    ['missing response', undefined],
    ['HTTP failure', new Response('', { status: 503 })],
  ])('maps a Recipe catalog %s to a gateway failure', async (_label, response) => {
    const subject = await boot({ accountRequest: () => Promise.resolve(response) })
    await expect(subject.service.listRecipes({})).rejects.toMatchObject({ code: 'gateway/internal' })
  })

  it.each([
    ['missing response', undefined],
    ['HTTP failure', new Response('', { status: 503 })],
  ])('maps a Recipe detail %s to a gateway failure', async (_label, response) => {
    const subject = await boot({ accountRequest: () => Promise.resolve(response) })
    await expect(subject.service.recipeDetail(recipe.code)).rejects.toMatchObject({ code: 'gateway/internal' })
  })

  it('preserves Recipe RemoteErrors raised by the account request', async () => {
    const failure = new RemoteError('gateway/bad-request', 'fixture rejection', {})
    const subject = await boot({ accountRequest: () => Promise.reject(failure) })

    await expect(subject.service.listRecipes({})).rejects.toBe(failure)
    await expect(subject.service.recipeDetail(recipe.code)).rejects.toBe(failure)
  })

  it('rejects Recipe detail metadata for a different slug', async () => {
    const subject = await boot({ recipeDetail: { ...recipeDetail, code: 'rcp.video.other' } })
    await expect(subject.service.recipeDetail(recipe.code)).rejects.toMatchObject({ code: 'gateway/internal' })
  })

  it('rejects unsafe public URLs returned in Recipe metadata', async () => {
    const subject = await boot({
      recipeCatalog: {
        records: [{ ...recipe, coverUrl: 'javascript:alert(1)' }],
        total: 1, pageNum: 1, pageSize: 15, pages: 1, available_tags: [],
      },
    })
    await expect(subject.service.listRecipes({})).rejects.toThrow('could not be loaded')
  })

  it('accepts the public Skill catalog envelope', async () => {
    const subject = await boot()

    await expect(subject.service.list()).resolves.toEqual({
      signedIn: true,
      installedCount: 0,
      skills: [{
        slug: skill.code,
        name: skill.name,
        description: skill.description,
        category: skill.category,
        version: skill.skillVersion,
        triggers: skill.triggers,
        installed: false,
      }],
    })
  })

  it('accepts public gateway catalog and detail envelopes', async () => {
    const ordinary = { ...skill }
    Reflect.deleteProperty(ordinary, 'kind')
    const subject = await boot({
      catalog: { code: 0, data: { records: [ordinary], total: 1, pageNum: 1, pages: 1 } },
      detail: { code: 0, data: ordinary },
    })

    await expect(subject.service.list()).resolves.toMatchObject({
      skills: [{ slug: skill.code }],
    })
    await expect(subject.service.detail(skill.code)).resolves.toMatchObject({
      slug: skill.code,
      usesOperators: skill.dependencies,
    })
  })

  it('downloads without credentials and atomically installs into this DSH_HOME', async () => {
    const subject = await boot()

    await expect(subject.service.installSkill(skill.code)).resolves.toEqual({
      slug: skill.code, version: skill.skillVersion, installed: true,
    })
    await expect(readFile(join(subject.home, 'skills', skill.code, 'SKILL.md'), 'utf8'))
      .resolves.toContain('name: story-director')
    expect(subject.requests).toContain(`/api/public/agent/v1/skills/${skill.code}/bundle  mantur-agent`)

    const state = JSON.parse(await readFile(
      join(subject.home, 'manturhub-marketplace', 'installed-skills.json'),
      'utf8',
    )) as { skills: Record<string, { contentSha256: string }> }
    expect(state.skills[skill.code]?.contentSha256).toMatch(/^[a-f0-9]{64}$/)
    await expect(subject.service.list()).resolves.toMatchObject({ installedCount: 1 })
  })

  it('invalidates the running filesystem catalog after atomic installation', { timeout: 20_000 }, async () => {
    const subject = await boot()
    await subject.ctx.plugin(SkillRegistry)
    await subject.ctx.plugin(SkillFileSystem, {
      dshHome: subject.home,
      agentsHome: join(subject.home, 'agents'),
      watch: true,
      watchStabilityThresholdMs: 20,
      watchPollIntervalMs: 10,
    })
    expect(await subject.ctx.skills.list()).toEqual([])
    let changes = 0
    subject.ctx.on('skills/change', () => { changes += 1 })

    await subject.service.installSkill(skill.code)
    for (let index = 0; index < 200; index += 1) {
      if ((await subject.ctx.skills.list()).some(entry => entry.name === skill.code)) break
      await new Promise<void>(resolve => setTimeout(resolve, 10))
    }

    expect((await subject.ctx.skills.list()).map(entry => entry.name)).toContain(skill.code)
    expect(changes).toBeGreaterThan(0)
  })

  it('installs public bundles while signed out without sending credentials', async () => {
    const subject = await boot({ signedIn: false })
    await expect(subject.service.installSkill(skill.code)).resolves.toMatchObject({ installed: true })
    expect(subject.requests).toContain(`/api/public/agent/v1/skills/${skill.code}/bundle  mantur-agent`)
  })

  it('refuses to overwrite a tracked Skill after local modification', async () => {
    const subject = await boot()
    await subject.service.installSkill(skill.code)
    const installed = join(subject.home, 'skills', skill.code, 'SKILL.md')
    await writeFile(installed, `${await readFile(installed, 'utf8')}\nlocal change\n`)
    const downloads = subject.requests.filter(request => request.includes('/bundle')).length

    await expect(subject.service.installSkill(skill.code)).rejects.toMatchObject({
      code: 'mantur-marketplace/local-conflict',
      details: { slug: skill.code },
    })
    expect(subject.requests.filter(request => request.includes('/bundle'))).toHaveLength(downloads)
    await expect(readFile(installed, 'utf8')).resolves.toContain('local change')
  })

  it('rejects traversal entries and leaves no partial Skill directory', async () => {
    const subject = await boot({ archive: bundle({
      '../escaped.txt': 'escape',
      'SKILL.md': '---\nname: story-director\nversion: 1.2.3\n---\n',
    }) })

    await expect(subject.service.installSkill(skill.code)).rejects.toThrow('could not be installed')
    await expect(readFile(join(subject.home, 'escaped.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(subject.home, 'skills', skill.code, 'SKILL.md'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects an insecure redirect without forwarding the account key', async () => {
    const subject = await boot({ redirect: 'http://bundles.example/skill.zip' })

    await expect(subject.service.installSkill(skill.code)).rejects.toThrow('could not be installed')
    expect(subject.requests).toContain(`/api/public/agent/v1/skills/${skill.code}/bundle  mantur-agent`)
  })

  it('follows a secure loopback redirect without forwarding the account key', async () => {
    const received: string[] = []
    const archive = bundle()
    const server = createServer((request, response) => {
      received.push(String(request.headers['x-api-key'] ?? ''))
      response.setHeader('content-length', String(archive.byteLength))
      response.end(archive)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    cleanups.push(() => new Promise<void>((resolve, reject) => {
      server.close((error) => { if (error === undefined) resolve(); else reject(error) })
    }))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('redirect server did not bind')
    const subject = await boot({ redirect: `http://127.0.0.1:${address.port}/bundle.zip` })

    await expect(subject.service.installSkill(skill.code)).resolves.toMatchObject({ installed: true })
    expect(received).toEqual([''])
  })

  it('rejects a redirect without Location', async () => {
    const subject = await boot({ redirect: null })

    await expect(subject.service.installSkill(skill.code)).rejects.toThrow('could not be installed')
  })

  it.each([
    ['name', bundle({ 'SKILL.md': '---\nname: other-skill\nversion: 1.2.3\n---\n' })],
    ['version', bundle({ 'SKILL.md': '---\nname: story-director\nversion: 9.9.9\n---\n' })],
  ])('rejects a bundle whose %s differs from catalog metadata', async (_field, archive) => {
    const subject = await boot({ archive })

    await expect(subject.service.installSkill(skill.code)).rejects.toThrow('could not be installed')
    await expect(readFile(join(subject.home, 'skills', skill.code, 'SKILL.md'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses an existing untracked directory before downloading', async () => {
    const subject = await boot()
    const existing = join(subject.home, 'skills', skill.code)
    await mkdir(existing, { recursive: true })
    await writeFile(join(existing, 'SKILL.md'), 'user-owned\n')

    await expect(subject.service.installSkill(skill.code)).rejects.toMatchObject({
      code: 'mantur-marketplace/local-conflict',
    })
    expect(subject.requests.some(request => request.includes('/bundle'))).toBe(false)
    await expect(readFile(join(existing, 'SKILL.md'), 'utf8')).resolves.toBe('user-owned\n')
  })

  it.each([
    ['compressed bytes', { maxBundleBytes: 16 }],
    ['file count', { maxFiles: 1 }],
    ['expanded bytes', { maxUnpackedBytes: 32 }],
  ] as const)('enforces the configured %s limit', async (_label, config) => {
    const subject = await boot({ config })

    await expect(subject.service.installSkill(skill.code)).rejects.toThrow('could not be installed')
    await expect(readFile(join(subject.home, 'skills', skill.code, 'SKILL.md'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a ZIP entry declared as a symbolic link', async () => {
    const archive = zipSync({
      'SKILL.md': strToU8('---\nname: story-director\nversion: 1.2.3\n---\n'),
      link: [strToU8('SKILL.md'), { os: 3, attrs: 0o120777 << 16 }],
    })
    const subject = await boot({ archive })

    await expect(subject.service.installSkill(skill.code)).rejects.toThrow('could not be installed')
  })

  it.skipIf(process.platform === 'win32')('restores the previous Skill when a POSIX permission blocks the state commit', async () => {
    let archive = bundle({
      'SKILL.md': '---\nname: story-director\nversion: 1.2.3\n---\n\nold body\n',
    })
    const subject = await boot({ archive: () => archive })
    await subject.service.installSkill(skill.code)
    const installed = join(subject.home, 'skills', skill.code, 'SKILL.md')
    archive = bundle({
      'SKILL.md': '---\nname: story-director\nversion: 1.2.3\n---\n\nnew body\n',
    })
    const stateDirectory = join(subject.home, 'manturhub-marketplace')
    await chmod(stateDirectory, 0o500)
    try {
      await expect(subject.service.installSkill(skill.code)).rejects.toThrow('could not be installed')
    } finally {
      await chmod(stateDirectory, 0o700)
    }
    await expect(readFile(installed, 'utf8')).resolves.toContain('old body')
    await expect(readFile(installed, 'utf8')).resolves.not.toContain('new body')
  })

  it('rejects a corrupt installer state before downloading', async () => {
    const subject = await boot()
    const stateDirectory = join(subject.home, 'manturhub-marketplace')
    await mkdir(stateDirectory, { recursive: true })
    await writeFile(join(stateDirectory, 'installed-skills.json'), '{broken')

    await expect(subject.service.installSkill(skill.code)).rejects.toThrow('could not be installed')
    expect(subject.requests.some(request => request.includes('/bundle'))).toBe(false)
  })

  it('refuses a tracked tree containing a symbolic link', async () => {
    const subject = await boot()
    await subject.service.installSkill(skill.code)
    await symlink('SKILL.md', join(subject.home, 'skills', skill.code, 'local-link'))

    await expect(subject.service.installSkill(skill.code)).rejects.toThrow('could not be installed')
  })

  it.skipIf(process.platform === 'win32')('refuses a tracked tree containing a POSIX special file', async () => {
    const subject = await boot()
    await subject.service.installSkill(skill.code)
    const { execFile } = await import('node:child_process')
    await new Promise<void>((resolve, reject) => {
      execFile('mkfifo', [join(subject.home, 'skills', skill.code, 'local-pipe')], (error) => {
        if (error === null) resolve()
        else reject(new Error('mkfifo failed', { cause: error }))
      })
    })

    await expect(subject.service.installSkill(skill.code)).rejects.toThrow('could not be installed')
  })

  it('rejects a bundle without root frontmatter', async () => {
    const subject = await boot({ archive: bundle({ 'SKILL.md': '# Missing metadata\n' }) })
    await expect(subject.service.installSkill(skill.code)).rejects.toThrow('could not be installed')
  })

  it.each([
    ['missing response', () => undefined],
    ['HTTP failure', () => new Response('', { status: 503 })],
    ['missing body', () => new Response(null, { status: 200 })],
    ['unauthorized response', () => new Response('', { status: 401 })],
  ])('rejects a download %s', async (_label, response) => {
    const subject = await boot({
      accountRequest: (pathname, requestOptions, origin) => {
        if (pathname.endsWith('/bundle')) return Promise.resolve(response())
        return forwardRequest(pathname, requestOptions, origin)
      },
    })
    await expect(subject.service.installSkill(skill.code)).rejects.toThrow()
  })

  it('enforces streamed bytes when Content-Length is absent', async () => {
    const subject = await boot({
      config: { maxBundleBytes: 16 },
      accountRequest: (pathname, requestOptions, origin) => {
        if (!pathname.endsWith('/bundle')) {
          return forwardRequest(pathname, requestOptions, origin)
        }
        return Promise.resolve(new Response(new Uint8Array(17)))
      },
    })
    await expect(subject.service.installSkill(skill.code)).rejects.toThrow('could not be installed')
  })

  it('rejects malformed Content-Length before writing the bundle', async () => {
    const subject = await boot({
      accountRequest: (pathname, requestOptions, origin) => {
        if (!pathname.endsWith('/bundle')) {
          return forwardRequest(pathname, requestOptions, origin)
        }
        return Promise.resolve(new Response(responseBytes(bundle()), { headers: { 'content-length': 'invalid' } }))
      },
    })
    await expect(subject.service.installSkill(skill.code)).rejects.toThrow('could not be installed')
  })

  it('removes a partial bundle when the response stream fails', async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('stream failed'))
      },
    })
    const subject = await boot({
      accountRequest: (pathname, requestOptions, origin) => pathname.endsWith('/bundle')
        ? Promise.resolve(new Response(stream))
        : forwardRequest(pathname, requestOptions, origin),
    })
    await expect(subject.service.installSkill(skill.code)).rejects.toThrow('could not be installed')
  })

  it('accepts an HTTPS redirect without forwarding authorization', async () => {
    const archive = bundle()
    const originalFetch = globalThis.fetch
    globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url === 'https://bundles.example/story.zip') {
        expect(new Headers(init?.headers).has('x-api-key')).toBe(false)
        return Promise.resolve(new Response(responseBytes(archive)))
      }
      return originalFetch(input, init)
    }
    try {
      const subject = await boot({ redirect: 'https://bundles.example/story.zip' })
      await expect(subject.service.installSkill(skill.code)).resolves.toMatchObject({ installed: true })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('rejects a malformed redirect URL', async () => {
    const subject = await boot({ redirect: 'not a URL' })
    await expect(subject.service.installSkill(skill.code)).rejects.toThrow('could not be installed')
  })

  it('refuses a destination that is a file before downloading', async () => {
    const subject = await boot()
    await mkdir(join(subject.home, 'skills'), { recursive: true })
    await writeFile(join(subject.home, 'skills', skill.code), 'user-owned')
    await expect(subject.service.installSkill(skill.code)).rejects.toMatchObject({
      code: 'mantur-marketplace/local-conflict',
    })
  })

  it('refuses a symbolic-link Skill root', async () => {
    const subject = await boot()
    const actual = join(subject.home, 'actual-skills')
    await mkdir(actual)
    await symlink(actual, join(subject.home, 'skills'))
    await expect(subject.service.installSkill(skill.code)).rejects.toThrow('could not be installed')
  })

  it('serializes concurrent installs that target the live Skill directory', async () => {
    let activeDownloads = 0
    let peakDownloads = 0
    const archive = responseBytes(bundle())
    const subject = await boot({
      accountRequest: async (pathname, requestOptions, origin) => {
        if (!pathname.endsWith('/bundle')) return await forwardRequest(pathname, requestOptions, origin)
        activeDownloads += 1
        peakDownloads = Math.max(peakDownloads, activeDownloads)
        await new Promise<void>(resolve => setTimeout(resolve, 10))
        activeDownloads -= 1
        return new Response(archive.slice(0))
      },
    })

    await expect(Promise.all([
      subject.service.installSkill(skill.code),
      subject.service.installSkill(skill.code),
    ])).resolves.toHaveLength(2)
    expect(peakDownloads).toBe(1)
  })
})
