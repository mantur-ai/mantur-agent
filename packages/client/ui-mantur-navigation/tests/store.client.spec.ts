// @vitest-environment jsdom

import type { Context } from '@deepseek-ai/cordis'
import type { ManturLoginAttemptId } from '@deepseek-ai/dsh-authorization-manturhub/types'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ManturMarketplaceStore } from '../src/client/store.ts'

const listed = {
  slug: 'story-director',
  name: '故事导演',
  description: '把故事变成分镜',
  category: '剧本创作',
  version: '1.2.3',
  triggers: ['写分镜'],
  installed: false,
}

const recipe = {
  slug: 'rcp.video.story-vlog',
  title: '电影感旅行 Vlog',
  summary: '把旅行素材变成有叙事节奏的短片。',
  category: 'video' as const,
  tags: ['旅行', '电影感'],
  coverUrl: 'https://hub.mantur.cn/assets/cover.jpg',
  sampleUrl: 'https://hub.mantur.cn/assets/sample.mp4',
  sampleKind: 'video' as const,
  operatorId: 'op.video.generate',
  costEstimate: '约 0.16 元',
  priceDumplings: 0,
  author: '漫途创作实验室',
  copies: 128,
  publishedAt: '2026-09-01T08:00:00.000Z',
}

const recipeDetail = {
  ...recipe,
  sampleText: '自然光和克制转场。',
  promptTemplate: '将 {地点} 替换成你的内容。',
  parameters: { user_inputs: { 地点: '海边' } },
  sourceUrl: 'https://hub.mantur.cn/recipes/rcp.video.story-vlog',
  sourceName: 'ManturHub',
  sourceAvatarUrl: 'https://hub.mantur.cn/assets/avatar.png',
  models: ['seedance-1.0-pro'],
  agentPayload: '请先获取最新配方，再替换占位符。',
}

const zhLaunchCopy = {
  introduction: `我要复刻 ManturHub 配方「${recipe.title}」。`,
  identifier: `配方标识：${recipe.slug}`,
  platform: '配方平台：ManturHub',
  source: `来源地址：${recipeDetail.sourceUrl}`,
}

afterEach(() => {
  vi.useRealTimers()
})

function subject(remote: { manturAccount?: object; [key: string]: unknown }, openNative = vi.fn()): ManturMarketplaceStore {
  return new ManturMarketplaceStore({ remote: { ...remote,
    manturAccount: { identityMode: vi.fn().mockResolvedValue({ ok: true, value: 'standalone' }), ...remote.manturAccount },
  }, bail: openNative } as unknown as Context)
}

describe('Mantur marketplace store', () => {
  it.each(['closed', 'skipped'] as const)('preserves selected detail and permissions after native outcome %s', async (outcome) => {
    const request = Promise.withResolvers<typeof outcome>()
    const identityMode = vi.fn().mockResolvedValue({ ok: true, value: 'desktop-managed' })
    const open = vi.fn(() => request.promise)
    const store = subject({ manturAccount: { identityMode } }, open)
    const state = { phase: 'ready' as const, catalog: { skills: [listed], installedCount: 0, signedIn: false }, detailLoading: 'kept' }
    store.store.set(state)
    const login = store.startLogin()
    await store.startLogin()
    expect(identityMode).toHaveBeenCalledOnce()
    request.resolve(outcome)
    await login
    expect(open).toHaveBeenCalledOnce()
    expect(store.store.getSnapshot()).toMatchObject({ ...state, loginPhase: undefined })
  })

  it.each(['mode-error', 'owner-missing', 'owner-busy', 'owner-unloaded'] as const)('reports %s without selecting legacy credentials', async (failure) => {
    const identityMode = vi.fn().mockResolvedValue(failure === 'mode-error' ? { ok: false } : { ok: true, value: 'desktop-managed' })
    const legacy = vi.fn()
    const open = vi.fn(() => {
      if (failure === 'owner-busy') throw new Error('busy')
      if (failure === 'owner-unloaded') return Promise.reject(new Error('unavailable'))
      return undefined
    })
    const store = subject({ manturAccount: { identityMode, startLogin: legacy } }, open)
    store.store.set({ phase: 'ready', catalog: { skills: [listed], installedCount: 0, signedIn: false } })
    await store.startLogin()
    expect(store.store.getSnapshot()).toMatchObject({ loginPhase: 'unavailable', catalog: { signedIn: false } })
    expect(legacy).not.toHaveBeenCalled()
  })

  it.each([false, true])('ignores a late native result after disposal with ok=%s', async (ok) => {
    const request = Promise.withResolvers<'authenticated'>()
    const open = vi.fn(() => request.promise)
    const store = subject({ manturAccount: { identityMode: vi.fn().mockResolvedValue({ ok: true, value: 'desktop-managed' }) } }, open)
    store.store.set({ phase: 'ready', catalog: { skills: [listed], installedCount: 0, signedIn: false } })
    const login = store.startLogin()
    await Promise.resolve()
    expect(open).toHaveBeenCalledOnce()
    store.dispose()
    const state = store.store.getSnapshot()
    if (ok) request.resolve('authenticated'); else request.reject(new Error('late failure'))
    await login
    expect(store.store.getSnapshot()).toBe(state)
  })

  it('uses the native account owner without starting a legacy attempt or repeating installation', async () => {
    const startLogin = vi.fn().mockResolvedValue({ ok: false })
    const openNative = vi.fn().mockResolvedValue('authenticated')
    const installSkill = vi.fn()
    const store = subject({ manturAccount: {
      identityMode: vi.fn().mockResolvedValue({ ok: true, value: 'desktop-managed' }), startLogin,
    }, manturMarketplace: { installSkill } }, openNative)
    const detail = { ...listed, usesOperators: [] }
    store.store.set({ phase: 'ready', catalog: { skills: [listed], installedCount: 0, signedIn: false }, detail })
    await store.startLogin()
    expect(startLogin).not.toHaveBeenCalled()
    expect(openNative).toHaveBeenCalledExactlyOnceWith('mantur/native-account-open')
    expect(installSkill).not.toHaveBeenCalled()
    expect(store.store.getSnapshot()).toMatchObject({ detail, catalog: { signedIn: true }, login: undefined, loginPhase: undefined })
  })

  it('reuses settled catalogs and coalesces the same pending Recipe query', async () => {
    const list = vi.fn().mockResolvedValue({
      ok: true,
      value: { skills: [listed], installedCount: 0, signedIn: false },
    })
    const recipeSettlement = Promise.withResolvers<{
      ok: true
      value: { recipes: Array<typeof recipe>; total: number; page: number; pageSize: number; totalPages: number; availableTags: string[] }
    }>()
    const listRecipes = vi.fn().mockReturnValue(recipeSettlement.promise)
    const store = subject({ manturMarketplace: { list, listRecipes } })

    await store.ensureSkillCatalog()
    await store.ensureSkillCatalog()
    expect(list).toHaveBeenCalledOnce()

    const firstRecipeLoad = store.ensureRecipeCatalog({ page: 1 })
    expect(store.recipes.getSnapshot()).toEqual({ phase: 'loading', query: { page: 1 } })
    await store.ensureRecipeCatalog({})
    expect(listRecipes).toHaveBeenCalledOnce()
    recipeSettlement.resolve({
      ok: true,
      value: { recipes: [recipe], total: 1, page: 1, pageSize: 15, totalPages: 1, availableTags: recipe.tags },
    })
    await firstRecipeLoad
    await store.ensureRecipeCatalog({})
    expect(listRecipes).toHaveBeenCalledOnce()
  })

  it('loads filtered Recipe pages, details, and retryable failures', async () => {
    const listRecipes = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        value: { recipes: [recipe], total: 1, page: 1, pageSize: 15, totalPages: 1, availableTags: recipe.tags },
      })
      .mockResolvedValueOnce({ ok: false, error: { code: 'gateway/internal', message: 'offline' } })
    const recipeDetailRemote = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: recipeDetail })
      .mockResolvedValueOnce({ ok: false, error: { code: 'gateway/internal', message: 'offline' } })
    const store = subject({ manturMarketplace: { listRecipes, recipeDetail: recipeDetailRemote } })

    await store.loadRecipes({ category: 'video', query: '旅行' })
    expect(listRecipes).toHaveBeenCalledWith({ category: 'video', query: '旅行' })
    expect(store.recipes.getSnapshot()).toMatchObject({ phase: 'ready', catalog: { recipes: [recipe] } })
    await store.openRecipeDetail(recipe.slug)
    expect(store.recipes.getSnapshot()).toMatchObject({ detail: recipeDetail })
    store.closeRecipeDetail()
    expect(store.recipes.getSnapshot()).not.toHaveProperty('detail')
    await store.openRecipeDetail(recipe.slug)
    expect(store.recipes.getSnapshot()).toMatchObject({ detailError: recipe.slug })
    await store.loadRecipes({ category: 'video', query: '旅行' })
    expect(store.recipes.getSnapshot()).toEqual({ phase: 'failed', query: { category: 'video', query: '旅行' } })
  })

  it('starts a new Session and submits traceable Recipe instructions as its first message', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    const open = vi.fn()
    const sessions = {
      list: { getSnapshot: () => ({ current: 'session-current' }) },
      create: vi.fn().mockResolvedValue('session-recipe'),
      binding: () => ({ ctx: { get: (name: string) => name === 'conversation' ? { send } : undefined } }),
      open,
    }
    const workspaces = {
      list: { getSnapshot: () => ({ items: [{ workspaceId: 'workspace-1', sessionIds: ['session-current'] }] }) },
    }
    const ctx = {
      remote: {},
      get: (name: string) => name === 'sessions' ? sessions : name === 'workspaces' ? workspaces : undefined,
    } as unknown as Context
    const store = new ManturMarketplaceStore(ctx)
    store.recipes.set({
      phase: 'ready',
      catalog: { recipes: [recipe], total: 1, page: 1, pageSize: 15, totalPages: 1, availableTags: [] },
      query: {},
      detail: recipeDetail,
    })

    await expect(store.startRecipe(zhLaunchCopy)).resolves.toBe(true)
    expect(sessions.create).toHaveBeenCalledWith({ workspaceId: 'workspace-1' })
    expect(open).toHaveBeenCalledWith('session-recipe')
    expect(send).toHaveBeenCalledWith(expect.stringContaining(`配方标识：${recipe.slug}`))
    expect(send).toHaveBeenCalledWith(expect.stringContaining('配方平台：ManturHub'))
    expect(send).toHaveBeenCalledWith(expect.stringContaining(`来源地址：${recipeDetail.sourceUrl}`))
    expect(send).toHaveBeenCalledWith(expect.stringContaining(recipeDetail.agentPayload))
  })

  it('keeps ManturHub provenance without inventing a missing Recipe source URL', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    const sessions = {
      list: { getSnapshot: () => ({ current: 'session-current' }) },
      create: vi.fn().mockResolvedValue('session-recipe'),
      binding: () => ({ ctx: { get: (name: string) => name === 'conversation' ? { send } : undefined } }),
      open: vi.fn(),
    }
    const store = new ManturMarketplaceStore({
      remote: {},
      get: (name: string) => name === 'sessions'
        ? sessions
        : name === 'workspaces'
          ? { list: { getSnapshot: () => ({ items: [{ workspaceId: 'workspace-1', sessionIds: ['session-current'] }] }) } }
          : undefined,
    } as unknown as Context)
    const { sourceUrl: _sourceUrl, sourceName: _sourceName, sourceAvatarUrl: _sourceAvatarUrl, ...detail } = recipeDetail
    store.recipes.set({
      phase: 'ready',
      catalog: { recipes: [recipe], total: 1, page: 1, pageSize: 15, totalPages: 1, availableTags: [] },
      query: {},
      detail,
    })

    const enLaunchCopy = {
      introduction: `I want to recreate the ManturHub Recipe “${recipe.title}”.`,
      identifier: `Recipe ID: ${recipe.slug}`,
      platform: 'Recipe platform: ManturHub',
    }
    await expect(store.startRecipe(enLaunchCopy)).resolves.toBe(true)
    const message = String(send.mock.calls[0]?.[0])
    expect(message).toContain(enLaunchCopy.introduction)
    expect(message).toContain(enLaunchCopy.identifier)
    expect(message).toContain(enLaunchCopy.platform)
    expect(message).toContain(recipeDetail.agentPayload)
    expect(message).not.toContain('Source URL:')
    expect(message).not.toContain('undefined')
  })

  it('reports missing Workspaces and failed Recipe Session submission', async () => {
    const selection: { current: string | undefined } = { current: undefined }
    const send = vi.fn().mockRejectedValue(new Error('failed'))
    const sessions = {
      list: { getSnapshot: () => selection },
      create: vi.fn().mockResolvedValue('session-recipe'),
      binding: () => ({ ctx: { get: () => ({ send }) } }),
      open: vi.fn(),
    }
    let items: object[] = []
    const store = new ManturMarketplaceStore({
      remote: {},
      get: (name: string) => name === 'sessions'
        ? sessions
        : name === 'workspaces'
          ? { list: { getSnapshot: () => ({ items }) } }
          : undefined,
    } as unknown as Context)
    const ready = {
      phase: 'ready' as const,
      catalog: { recipes: [recipe], total: 1, page: 1, pageSize: 15, totalPages: 1, availableTags: [] },
      query: {},
      detail: recipeDetail,
    }
    store.recipes.set(ready)
    await expect(store.startRecipe(zhLaunchCopy)).resolves.toBe(false)
    expect(store.recipes.getSnapshot()).toMatchObject({ launchError: 'no-workspace' })

    selection.current = 'session-current'
    items = [{ workspaceId: 'workspace-1', sessionIds: ['session-current'] }]
    store.recipes.set(ready)
    await expect(store.startRecipe(zhLaunchCopy)).resolves.toBe(false)
    expect(store.recipes.getSnapshot()).toMatchObject({ launchError: 'failed', launching: undefined })
    expect(sessions.open).not.toHaveBeenCalled()

    store.recipes.set(ready)
    await expect(store.startRecipe(zhLaunchCopy)).resolves.toBe(false)
    expect(sessions.create).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('loads, refreshes, and reports catalog failures', async () => {
    const list = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: { skills: [listed], installedCount: 0, signedIn: false } })
      .mockResolvedValueOnce({ ok: false, error: { code: 'gateway/internal', message: 'offline' } })
    const store = subject({ manturMarketplace: { list } })

    await store.load()
    expect(store.store.getSnapshot()).toMatchObject({ phase: 'ready', catalog: { skills: [listed] } })
    await store.load()
    expect(store.store.getSnapshot()).toEqual({ phase: 'failed' })
  })

  it('ignores stale catalog settlements after disposal', async () => {
    const settlement = Promise.withResolvers<{ ok: true; value: { skills: never[]; installedCount: 0; signedIn: false } }>()
    const store = subject({ manturMarketplace: { list: () => settlement.promise } })

    const operation = store.load()
    store.dispose()
    settlement.resolve({ ok: true, value: { skills: [], installedCount: 0, signedIn: false } })
    await operation

    expect(store.store.getSnapshot()).toEqual({ phase: 'loading' })
  })

  it('ignores stale catalog and detail failures', async () => {
    const list = Promise.withResolvers<{ ok: false; error: { code: string; message: string } }>()
    const detail = Promise.withResolvers<{ ok: false; error: { code: string; message: string } }>()
    const store = subject({
      manturMarketplace: { list: () => list.promise, detail: () => detail.promise },
    })
    const loading = store.load()
    store.dispose()
    list.resolve({ ok: false, error: { code: 'gateway/internal', message: 'failed' } })
    await loading
    store.store.set({ phase: 'ready', catalog: { skills: [listed], installedCount: 0, signedIn: true } })
    const opening = store.openDetail(listed.slug)
    store.closeDetail()
    detail.resolve({ ok: false, error: { code: 'gateway/internal', message: 'failed' } })
    await opening
    expect(store.store.getSnapshot()).not.toHaveProperty('detail')
  })

  it('opens, closes, and recovers from Skill detail reads', async () => {
    const detail = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: { ...listed, usesOperators: [] } })
      .mockResolvedValueOnce({ ok: false, error: { code: 'gateway/internal', message: 'offline' } })
    const store = subject({ manturMarketplace: { detail } })
    await store.openDetail(listed.slug)
    store.store.set({ phase: 'ready', catalog: { skills: [listed], installedCount: 0, signedIn: false } })

    await store.openDetail(listed.slug)
    expect(store.store.getSnapshot()).toMatchObject({ detail: { slug: listed.slug } })
    store.closeDetail()
    expect(store.store.getSnapshot()).not.toHaveProperty('detail')
    await store.openDetail(listed.slug)
    expect(store.store.getSnapshot()).toMatchObject({ detailError: listed.slug })
    store.store.set({ phase: 'failed' })
    store.closeDetail()
    expect(store.store.getSnapshot()).toEqual({ phase: 'failed' })
  })

  it('publishes installing and installed states around a Host-confirmed install', async () => {
    const settlement = Promise.withResolvers<{
      ok: true
      value: { slug: string; version: string; installed: true }
    }>()
    const store = subject({ manturMarketplace: { installSkill: () => settlement.promise } })
    store.store.set({
      phase: 'ready',
      catalog: { skills: [listed], installedCount: 0, signedIn: true },
      detail: { ...listed, usesOperators: [] },
    })

    const operation = store.install(listed.slug)
    expect(store.store.getSnapshot()).toMatchObject({ phase: 'ready', installing: listed.slug })
    settlement.resolve({ ok: true, value: { slug: listed.slug, version: listed.version, installed: true } })
    await operation

    expect(store.store.getSnapshot()).toMatchObject({
      phase: 'ready',
      installing: undefined,
      installError: undefined,
      catalog: { installedCount: 1, skills: [{ installed: true }] },
      detail: { installed: true },
    })
  })

  it('opens a default-named Session with the installed Skill command as an unsent draft', async () => {
    const setDraft = vi.fn()
    const send = vi.fn()
    const inputFor = vi.fn(() => ({ setDraft }))
    const bindingCtx = { get: (name: string) => name === 'conversation' ? { input: { for: inputFor }, send } : undefined }
    const sessions = {
      list: { getSnapshot: () => ({ current: 'session-current' }) },
      create: vi.fn().mockResolvedValue('session-skill'),
      binding: vi.fn(() => ({ ctx: bindingCtx })),
      open: vi.fn(),
    }
    const store = new ManturMarketplaceStore({
      remote: {},
      get: (name: string) => name === 'sessions'
        ? sessions
        : name === 'workspaces'
          ? { list: { getSnapshot: () => ({ items: [{ workspaceId: 'workspace-1', sessionIds: ['session-current'] }] }) } }
          : undefined,
    } as unknown as Context)
    store.store.set({
      phase: 'ready', catalog: { skills: [{ ...listed, installed: true }], installedCount: 1, signedIn: true },
    })

    await expect(store.startSkill(listed.slug)).resolves.toBe(true)

    expect(sessions.create).toHaveBeenCalledWith({ workspaceId: 'workspace-1' })
    expect(inputFor).toHaveBeenCalledWith(bindingCtx)
    expect(setDraft).toHaveBeenCalledWith('/story-director')
    expect(send).not.toHaveBeenCalled()
    expect(sessions.open).toHaveBeenCalledWith('session-skill')
    expect(store.store.getSnapshot()).toMatchObject({ using: undefined, useError: undefined })
  })

  it('rejects Skill launches without an installed selection, current Project, or required services', async () => {
    const idle = new ManturMarketplaceStore({ remote: {}, get: () => undefined } as unknown as Context)
    await expect(idle.startSkill(listed.slug)).resolves.toBe(false)
    idle.store.set({ phase: 'ready', catalog: { skills: [listed], installedCount: 0, signedIn: true } })
    await expect(idle.startSkill(listed.slug)).resolves.toBe(false)
    idle.store.set({
      phase: 'ready', catalog: { skills: [{ ...listed, installed: true }], installedCount: 1, signedIn: true },
      using: listed.slug,
    })
    await expect(idle.startSkill(listed.slug)).resolves.toBe(false)
    idle.store.set({ ...idle.store.getSnapshot() as Extract<ReturnType<typeof idle.store.getSnapshot>, { phase: 'ready' }>, using: undefined })
    await expect(idle.startSkill(listed.slug)).rejects.toThrow('Skill launch services are unavailable')

    const sessionsOnly = new ManturMarketplaceStore({
      remote: {}, get: (name: string) => name === 'sessions' ? {} : undefined,
    } as unknown as Context)
    sessionsOnly.store.set({
      phase: 'ready', catalog: { skills: [{ ...listed, installed: true }], installedCount: 1, signedIn: true },
    })
    await expect(sessionsOnly.startSkill(listed.slug)).rejects.toThrow('Skill launch services are unavailable')

    const noProject = new ManturMarketplaceStore({
      remote: {},
      get: (name: string) => name === 'sessions'
        ? { list: { getSnapshot: () => ({ current: undefined }) } }
        : name === 'workspaces'
          ? { list: { getSnapshot: () => ({ items: [] }) } }
          : undefined,
    } as unknown as Context)
    noProject.store.set({
      phase: 'ready', catalog: { skills: [{ ...listed, installed: true }], installedCount: 1, signedIn: true },
    })
    await expect(noProject.startSkill(listed.slug)).resolves.toBe(false)
    expect(noProject.store.getSnapshot()).toMatchObject({ useError: 'no-workspace' })
  })

  it('reuses a failed Skill Session and archives it when the selected Project changes', async () => {
    const selection = { current: 'session-current-1' }
    const items = [
      { workspaceId: 'workspace-1', sessionIds: ['session-current-1'] },
      { workspaceId: 'workspace-2', sessionIds: ['session-current-2'] },
    ]
    const archiveSession = vi.fn().mockResolvedValue(undefined)
    const setDraft = vi.fn()
    let bindingMode: 'missing-binding' | 'missing-conversation' | 'ready' = 'missing-binding'
    const sessions = {
      list: { getSnapshot: () => selection },
      create: vi.fn()
        .mockResolvedValueOnce('session-skill-1')
        .mockResolvedValueOnce('session-skill-2'),
      binding: () => bindingMode === 'missing-binding'
        ? undefined
        : {
          ctx: {
            get: () => bindingMode === 'missing-conversation'
              ? undefined
              : { input: { for: () => ({ setDraft }) } },
          },
        },
      open: vi.fn(),
    }
    const store = new ManturMarketplaceStore({
      remote: {},
      get: (name: string) => name === 'sessions'
        ? sessions
        : name === 'workspaces'
          ? { list: { getSnapshot: () => ({ items }) }, archiveSession }
          : undefined,
    } as unknown as Context)
    const ready = {
      phase: 'ready' as const,
      catalog: { skills: [{ ...listed, installed: true }], installedCount: 1, signedIn: true },
    }

    store.store.set(ready)
    await expect(store.startSkill(listed.slug)).resolves.toBe(false)
    expect(store.store.getSnapshot()).toMatchObject({ using: undefined, useError: 'failed' })

    bindingMode = 'missing-conversation'
    store.store.set(ready)
    await expect(store.startSkill(listed.slug)).resolves.toBe(false)
    expect(sessions.create).toHaveBeenCalledTimes(1)

    selection.current = 'session-current-2'
    bindingMode = 'ready'
    store.store.set(ready)
    await expect(store.startSkill(listed.slug)).resolves.toBe(true)
    expect(archiveSession).toHaveBeenCalledWith('session-skill-1')
    expect(sessions.create).toHaveBeenCalledTimes(2)
    expect(setDraft).toHaveBeenCalledWith('/story-director')
    expect(sessions.open).toHaveBeenCalledWith('session-skill-2')
  })

  it('does not overwrite Skill state changed while Session creation settles', async () => {
    const ready = {
      phase: 'ready' as const,
      catalog: { skills: [{ ...listed, installed: true }], installedCount: 1, signedIn: true },
    }
    const makeStore = (create: ReturnType<typeof vi.fn>) => {
      const bindingCtx = { get: () => ({ input: { for: () => ({ setDraft: vi.fn() }) } }) }
      const sessions = {
        list: { getSnapshot: () => ({ current: 'session-current' }) },
        create,
        binding: () => ({ ctx: bindingCtx }),
        open: vi.fn(),
      }
      const store = new ManturMarketplaceStore({
        remote: {},
        get: (name: string) => name === 'sessions'
          ? sessions
          : name === 'workspaces'
            ? { list: { getSnapshot: () => ({ items: [{ workspaceId: 'workspace-1', sessionIds: ['session-current'] }] }) } }
            : undefined,
      } as unknown as Context)
      store.store.set(ready)
      return store
    }

    const successfulCreation = Promise.withResolvers<string>()
    const successful = makeStore(vi.fn(() => successfulCreation.promise))
    const successfulLaunch = successful.startSkill(listed.slug)
    successful.store.set({ phase: 'failed' })
    successfulCreation.resolve('session-skill')
    await expect(successfulLaunch).resolves.toBe(true)
    expect(successful.store.getSnapshot()).toEqual({ phase: 'failed' })

    const failedCreation = Promise.withResolvers<string>()
    const failed = makeStore(vi.fn(() => failedCreation.promise))
    const failedLaunch = failed.startSkill(listed.slug)
    failed.store.set({ phase: 'failed' })
    failedCreation.reject(new Error('failed'))
    await expect(failedLaunch).resolves.toBe(false)
    expect(failed.store.getSnapshot()).toEqual({ phase: 'failed' })
  })

  it('keeps local conflicts distinct from generic installation failures', async () => {
    const store = subject({
      manturMarketplace: {
        installSkill: () => Promise.resolve({
          ok: false as const,
          error: new RemoteError(
            'mantur-marketplace/local-conflict',
            'modified',
            { slug: listed.slug },
          ),
        }),
      },
    })
    store.store.set({
      phase: 'ready',
      catalog: { skills: [listed], installedCount: 0, signedIn: true },
    })

    await store.install(listed.slug)

    expect(store.store.getSnapshot()).toMatchObject({
      phase: 'ready', installError: 'local-conflict', catalog: { installedCount: 0 },
    })
  })

  it('marks the catalog signed out when the Host reports expired authorization', async () => {
    const store = subject({
      manturMarketplace: {
        installSkill: () => Promise.resolve({
          ok: false as const,
          error: { code: 'mantur-marketplace/auth-required', message: 'expired' },
        }),
      },
    })
    store.store.set({ phase: 'ready', catalog: { skills: [listed], installedCount: 0, signedIn: true } })

    await store.install(listed.slug)

    expect(store.store.getSnapshot()).toMatchObject({
      installError: 'auth-required',
      catalog: { signedIn: false },
    })
  })

  it('maps generic installation failures', async () => {
    const store = subject({
      manturMarketplace: {
        installSkill: () => Promise.resolve({
          ok: false as const,
          error: { code: 'gateway/internal', message: 'failed' },
        }),
      },
    })
    store.store.set({ phase: 'ready', catalog: { skills: [listed], installedCount: 0, signedIn: true } })

    await store.install(listed.slug)

    expect(store.store.getSnapshot()).toMatchObject({ installError: 'failed', catalog: { signedIn: true } })
  })

  it('requires sign-in and ignores duplicate or inapplicable installation requests', async () => {
    const install = vi.fn()
    const store = subject({ manturMarketplace: { installSkill: install } })
    await store.install(listed.slug)
    store.store.set({ phase: 'ready', catalog: { skills: [listed], installedCount: 0, signedIn: false } })
    await store.install(listed.slug)
    expect(store.store.getSnapshot()).toMatchObject({ installError: 'auth-required' })
    store.store.set({ phase: 'ready', catalog: { skills: [listed], installedCount: 0, signedIn: true }, installing: listed.slug })
    await store.install(listed.slug)
    expect(install).not.toHaveBeenCalled()
  })

  it('does not double-count an already installed or absent catalog entry', async () => {
    const install = () => Promise.resolve({
      ok: true as const,
      value: { slug: listed.slug, version: listed.version, installed: true as const },
    })
    const store = subject({ manturMarketplace: { installSkill: install } })
    store.store.set({
      phase: 'ready',
      catalog: {
        skills: [{ ...listed, installed: true }, { ...listed, slug: 'other' }],
        installedCount: 1,
        signedIn: true,
      },
      detail: { ...listed, slug: 'other', usesOperators: [] },
    })
    await store.install(listed.slug)
    expect(store.store.getSnapshot()).toMatchObject({ catalog: { installedCount: 1 }, detail: { slug: 'other' } })

    store.store.set({ phase: 'ready', catalog: { skills: [], installedCount: 0, signedIn: true } })
    await store.install(listed.slug)
    expect(store.store.getSnapshot()).toMatchObject({ catalog: { installedCount: 0 } })
  })

  it('ignores an installation result after its pending state changes', async () => {
    const settlement = Promise.withResolvers<{
      ok: true
      value: { slug: string; version: string; installed: true }
    }>()
    const store = subject({ manturMarketplace: { installSkill: () => settlement.promise } })
    store.store.set({ phase: 'ready', catalog: { skills: [listed], installedCount: 0, signedIn: true } })
    const operation = store.install(listed.slug)
    store.store.set({ phase: 'failed' })
    settlement.resolve({ ok: true, value: { slug: listed.slug, version: listed.version, installed: true } })
    await operation
    expect(store.store.getSnapshot()).toEqual({ phase: 'failed' })
  })

  it('completes the device gate and enables installation without storing a credential', async () => {
    vi.useFakeTimers()
    const attemptId = 'attempt-1' as ManturLoginAttemptId
    const progress = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: { status: 'pending' } })
      .mockResolvedValueOnce({
        ok: true,
        value: { status: 'authorized', account: { email: 'artist@example.com' } },
      })
    const store = subject({
      manturAccount: {
        startLogin: () => Promise.resolve({
          ok: true as const,
          value: {
            attemptId,
            verificationUrl: 'https://hub.mantur.ai/device',
            userCode: 'MANT-1234',
            expiresAt: Date.now() + 60_000,
          },
        }),
        loginProgress: progress,
      },
    })
    store.store.set({
      phase: 'ready',
      catalog: { skills: [listed], installedCount: 0, signedIn: false },
    })

    await store.startLogin()
    expect(store.store.getSnapshot()).toMatchObject({
      phase: 'ready', loginPhase: 'authorizing', login: { userCode: 'MANT-1234' },
    })
    await vi.advanceTimersByTimeAsync(750)
    expect(progress).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(750)
    expect(store.store.getSnapshot()).toMatchObject({
      phase: 'ready', catalog: { signedIn: true }, login: undefined, loginPhase: undefined,
    })
  })

  it('reports login start, polling, and cancellation failures', async () => {
    vi.useFakeTimers()
    const attemptId = 'attempt-2' as ManturLoginAttemptId
    const startLogin = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: { code: 'gateway/internal', message: 'failed' } })
      .mockResolvedValue({
        ok: true,
        value: { attemptId, verificationUrl: 'https://hub.mantur.ai/device', userCode: 'CODE', expiresAt: Date.now() + 60_000 },
      })
    const loginProgress = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: { code: 'gateway/internal', message: 'failed' } })
      .mockResolvedValueOnce({ ok: true, value: { status: 'cancelled' } })
      .mockResolvedValueOnce({ ok: true, value: { status: 'expired' } })
    const cancelLogin = vi.fn().mockResolvedValue({ ok: false, error: { code: 'gateway/internal', message: 'failed' } })
    const store = subject({ manturAccount: { startLogin, loginProgress, cancelLogin } })
    const ready = { phase: 'ready' as const, catalog: { skills: [listed], installedCount: 0, signedIn: false } }
    store.store.set(ready)

    await store.startLogin()
    expect(store.store.getSnapshot()).toMatchObject({ loginPhase: 'failed' })
    await store.startLogin()
    await store.startLogin()
    await vi.advanceTimersByTimeAsync(750)
    expect(store.store.getSnapshot()).toMatchObject({ loginPhase: 'failed' })

    store.store.set(ready)
    await store.startLogin()
    await vi.advanceTimersByTimeAsync(750)
    expect(store.store.getSnapshot()).toMatchObject({ login: undefined, loginPhase: undefined })

    store.store.set(ready)
    await store.startLogin()
    await vi.advanceTimersByTimeAsync(750)
    expect(store.store.getSnapshot()).toMatchObject({ loginPhase: 'failed' })

    store.store.set({ ...ready, login: { attemptId, verificationUrl: 'https://hub.mantur.ai/device', userCode: 'CODE', expiresAt: 0 }, loginPhase: 'authorizing' })
    await store.cancelLogin()
    expect(store.store.getSnapshot()).toMatchObject({ loginPhase: 'failed' })
  })

  it('cancels a device attempt and ignores cancellation outside an active ready attempt', async () => {
    vi.useFakeTimers()
    const attemptId = 'attempt-3' as ManturLoginAttemptId
    const cancelLogin = vi.fn().mockResolvedValue({ ok: true, value: undefined })
    const store = subject({ manturAccount: { cancelLogin } })
    await store.cancelLogin()
    store.store.set({ phase: 'ready', catalog: { skills: [], installedCount: 0, signedIn: false } })
    await store.cancelLogin()
    store.store.set({
      phase: 'ready', catalog: { skills: [], installedCount: 0, signedIn: false },
      login: { attemptId, verificationUrl: 'https://hub.mantur.ai/device', userCode: 'CODE', expiresAt: 0 },
      loginPhase: 'authorizing',
    })
    await store.cancelLogin()
    expect(cancelLogin).toHaveBeenCalledWith(attemptId)
    expect(store.store.getSnapshot()).toMatchObject({ login: undefined, loginPhase: undefined })
    store.dispose()
  })

  it('ignores a standalone login reply after the requesting owner leaves', async () => {
    const dispatched = Promise.withResolvers<undefined>()
    const reply = Promise.withResolvers<{ ok: false; error: { code: string; message: string } }>()
    const store = subject({ manturAccount: { startLogin: () => { dispatched.resolve(undefined); return reply.promise } } })
    store.store.set({ phase: 'ready', catalog: { skills: [], installedCount: 0, signedIn: false } })
    const pending = store.startLogin()
    await dispatched.promise
    store.dispose()
    const state = store.store.getSnapshot()
    reply.resolve({ ok: false, error: { code: 'gateway/internal', message: 'failed' } })
    await pending
    expect(store.store.getSnapshot()).toBe(state)
  })

  it('ignores stale login start, cancellation, and polling settlements', async () => {
    vi.useFakeTimers()
    const attemptId = 'attempt-stale' as ManturLoginAttemptId
    const start = Promise.withResolvers<{ ok: false; error: { code: string; message: string } }>()
    const cancel = Promise.withResolvers<{ ok: true; value: undefined }>()
    const progress = Promise.withResolvers<{ ok: true; value: { status: 'pending' } }>()
    const store = subject({
      manturAccount: {
        startLogin: () => start.promise,
        cancelLogin: () => cancel.promise,
        loginProgress: () => progress.promise,
      },
    })
    const ready = { phase: 'ready' as const, catalog: { skills: [], installedCount: 0, signedIn: false } }
    store.store.set(ready)
    const starting = store.startLogin()
    store.dispose()
    start.resolve({ ok: false, error: { code: 'gateway/internal', message: 'failed' } })
    await starting

    store.store.set({
      ...ready,
      login: { attemptId, verificationUrl: 'https://hub.mantur.ai/device', userCode: 'CODE', expiresAt: 0 },
    })
    const cancelling = store.cancelLogin()
    store.store.set({ phase: 'failed' })
    cancel.resolve({ ok: true, value: undefined })
    await cancelling

    store.store.set(ready)
    const successfulStart = store.startLogin()
    start.resolve({ ok: false, error: { code: 'gateway/internal', message: 'failed' } })
    await successfulStart
    store.store.set({
      ...ready,
      login: { attemptId, verificationUrl: 'https://hub.mantur.ai/device', userCode: 'CODE', expiresAt: 0 },
      loginPhase: 'authorizing',
    })
    ;(store as unknown as { scheduleLoginPoll: (id: ManturLoginAttemptId, generation: number) => void })
      .scheduleLoginPoll(attemptId, 0)
    await vi.advanceTimersByTimeAsync(750)
    store.dispose()
    progress.resolve({ ok: true, value: { status: 'pending' } })
    await vi.runAllTimersAsync()
    expect(store.store.getSnapshot()).toMatchObject({ phase: 'ready' })
  })

  it('ignores stale Recipe reads and rejects detail actions without a ready catalog', async () => {
    const list = Promise.withResolvers<{ ok: false; error: { code: string; message: string } }>()
    const detail = Promise.withResolvers<{ ok: false; error: { code: string; message: string } }>()
    const store = subject({
      manturMarketplace: { listRecipes: () => list.promise, recipeDetail: () => detail.promise },
    })

    const loading = store.loadRecipes()
    store.dispose()
    list.resolve({ ok: false, error: { code: 'gateway/internal', message: 'failed' } })
    await loading
    expect(store.recipes.getSnapshot()).toEqual({ phase: 'loading', query: {} })

    await store.openRecipeDetail(recipe.slug)
    store.closeRecipeDetail()
    expect(store.recipes.getSnapshot()).toEqual({ phase: 'loading', query: {} })

    store.recipes.set({
      phase: 'ready',
      catalog: { recipes: [recipe], total: 1, page: 1, pageSize: 15, totalPages: 1, availableTags: [] },
      query: {},
    })
    const opening = store.openRecipeDetail(recipe.slug)
    store.closeRecipeDetail()
    detail.resolve({ ok: false, error: { code: 'gateway/internal', message: 'failed' } })
    await opening
    expect(store.recipes.getSnapshot()).not.toHaveProperty('detailError')
  })

  it('rejects Recipe launches without a selectable detail or required client services', async () => {
    const idle = new ManturMarketplaceStore({ remote: {}, get: () => undefined } as unknown as Context)
    await expect(idle.startRecipe(zhLaunchCopy)).resolves.toBe(false)
    idle.recipes.set({
      phase: 'ready',
      catalog: { recipes: [recipe], total: 1, page: 1, pageSize: 15, totalPages: 1, availableTags: [] },
      query: {},
    })
    await expect(idle.startRecipe(zhLaunchCopy)).resolves.toBe(false)
    idle.recipes.set({ ...idle.recipes.getSnapshot() as Extract<ReturnType<typeof idle.recipes.getSnapshot>, { phase: 'ready' }>, detail: recipeDetail, launching: recipe.slug })
    await expect(idle.startRecipe(zhLaunchCopy)).resolves.toBe(false)

    idle.recipes.set({ ...idle.recipes.getSnapshot() as Extract<ReturnType<typeof idle.recipes.getSnapshot>, { phase: 'ready' }>, launching: undefined })
    await expect(idle.startRecipe(zhLaunchCopy)).rejects.toThrow('Recipe launch services are unavailable')

    const sessionsOnly = new ManturMarketplaceStore({
      remote: {},
      get: (name: string) => name === 'sessions' ? {} : undefined,
    } as unknown as Context)
    sessionsOnly.recipes.set({
      phase: 'ready',
      catalog: { recipes: [recipe], total: 1, page: 1, pageSize: 15, totalPages: 1, availableTags: [] },
      query: {},
      detail: recipeDetail,
    })
    await expect(sessionsOnly.startRecipe(zhLaunchCopy)).rejects.toThrow('Recipe launch services are unavailable')
  })

  it('archives a failed pending Recipe Session when the selected Workspace changes', async () => {
    const selection = { current: 'session-current-1' }
    const items = [
      { workspaceId: 'workspace-1', sessionIds: ['session-current-1'] },
      { workspaceId: 'workspace-2', sessionIds: ['session-current-2'] },
    ]
    const archiveSession = vi.fn().mockResolvedValue(undefined)
    const send = vi.fn().mockRejectedValue(new Error('failed'))
    let bindingMode: 'conversation' | 'missing-binding' | 'missing-conversation' = 'conversation'
    const sessions = {
      list: { getSnapshot: () => selection },
      create: vi.fn()
        .mockResolvedValueOnce('session-recipe-1')
        .mockResolvedValueOnce('session-recipe-2'),
      binding: () => bindingMode === 'missing-binding'
        ? undefined
        : { ctx: { get: () => bindingMode === 'conversation' ? { send } : undefined } },
      open: vi.fn(),
    }
    const store = new ManturMarketplaceStore({
      remote: {},
      get: (name: string) => name === 'sessions'
        ? sessions
        : name === 'workspaces'
          ? { list: { getSnapshot: () => ({ items }) }, archiveSession }
          : undefined,
    } as unknown as Context)
    const ready = {
      phase: 'ready' as const,
      catalog: { recipes: [recipe], total: 1, page: 1, pageSize: 15, totalPages: 1, availableTags: [] },
      query: {},
      detail: recipeDetail,
    }

    store.recipes.set(ready)
    await expect(store.startRecipe(zhLaunchCopy)).resolves.toBe(false)
    selection.current = 'session-current-2'
    bindingMode = 'missing-binding'
    store.recipes.set(ready)
    await expect(store.startRecipe(zhLaunchCopy)).resolves.toBe(false)
    expect(archiveSession).toHaveBeenCalledWith('session-recipe-1')
    expect(store.recipes.getSnapshot()).toMatchObject({
      phase: 'ready', launching: undefined, launchError: 'failed',
    })
    expect(sessions.open).not.toHaveBeenCalled()

    bindingMode = 'missing-conversation'
    store.recipes.set(ready)
    await expect(store.startRecipe(zhLaunchCopy)).resolves.toBe(false)
    expect(sessions.create).toHaveBeenCalledTimes(2)
    expect(store.recipes.getSnapshot()).toMatchObject({
      phase: 'ready', launching: undefined, launchError: 'failed',
    })
    expect(sessions.open).not.toHaveBeenCalled()
  })

  it('does not overwrite Recipe state changed while submission settles', async () => {
    const makeStore = (send: ReturnType<typeof vi.fn>) => {
      const sessions = {
        list: { getSnapshot: () => ({ current: 'session-current' }) },
        create: vi.fn().mockResolvedValue('session-recipe'),
        binding: () => ({ ctx: { get: () => ({ send }) } }),
        open: vi.fn(),
      }
      const store = new ManturMarketplaceStore({
        remote: {},
        get: (name: string) => name === 'sessions'
          ? sessions
          : name === 'workspaces'
            ? { list: { getSnapshot: () => ({ items: [{ workspaceId: 'workspace-1', sessionIds: ['session-current'] }] }) } }
            : undefined,
      } as unknown as Context)
      store.recipes.set({
        phase: 'ready',
        catalog: { recipes: [recipe], total: 1, page: 1, pageSize: 15, totalPages: 1, availableTags: [] },
        query: {},
        detail: recipeDetail,
      })
      return { sessions, store }
    }

    const successfulCompletion = Promise.withResolvers<undefined>()
    const successfulEntered = Promise.withResolvers<undefined>()
    const successful = makeStore(vi.fn(() => {
      successfulEntered.resolve(undefined)
      return successfulCompletion.promise
    }))
    const successfulLaunch = successful.store.startRecipe(zhLaunchCopy)
    await successfulEntered.promise
    expect(successful.store.recipes.getSnapshot()).toMatchObject({
      phase: 'ready', launching: recipe.slug,
    })
    successful.store.recipes.set({ phase: 'failed', query: {} })
    successfulCompletion.resolve(undefined)
    await expect(successfulLaunch).resolves.toBe(true)
    expect(successful.store.recipes.getSnapshot()).toEqual({ phase: 'failed', query: {} })

    const failedCompletion = Promise.withResolvers<undefined>()
    const failedEntered = Promise.withResolvers<undefined>()
    const failed = makeStore(vi.fn(() => {
      failedEntered.resolve(undefined)
      return failedCompletion.promise
    }))
    const failedLaunch = failed.store.startRecipe(zhLaunchCopy)
    await failedEntered.promise
    expect(failed.store.recipes.getSnapshot()).toMatchObject({
      phase: 'ready', launching: recipe.slug,
    })
    failed.store.recipes.set({ phase: 'failed', query: {} })
    failedCompletion.reject(new Error('failed'))
    await expect(failedLaunch).resolves.toBe(false)
    expect(failed.store.recipes.getSnapshot()).toEqual({ phase: 'failed', query: {} })
  })
})
