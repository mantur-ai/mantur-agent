// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import {
  MANTUR_MARKET_PAGES, MarketplaceNavigation, MarketplacePage,
  ProjectsHeading,
} from '../src/client/MarketplaceNavigation.tsx'
import { zh } from '../src/client/locales.ts'
import type {
  ManturMarketplaceState, ManturMarketplaceStore, ManturRecipeMarketplaceState,
} from '../src/client/store.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const t = makeTranslate(zh)
const globalProps = {
  useSessions: vi.fn() as never,
  useSessionPendingInteraction: vi.fn() as never,
  useWorkspaces: vi.fn() as never,
}

const emptyReady: ManturMarketplaceState = {
  phase: 'ready',
  catalog: { skills: [], installedCount: 0, signedIn: false },
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

type ControllerMocks = {
  [K in
    | 'load' | 'ensureSkillCatalog' | 'openDetail' | 'closeDetail' | 'install' | 'startSkill' | 'startLogin' | 'cancelLogin'
    | 'loadRecipes' | 'ensureRecipeCatalog' | 'openRecipeDetail' | 'closeRecipeDetail' | 'startRecipe'
  ]: ReturnType<typeof vi.fn>
}

function marketplaceProps(
  state: ManturMarketplaceState = emptyReady,
  recipeState: ManturRecipeMarketplaceState = {
    phase: 'ready',
    catalog: { recipes: [], total: 0, page: 1, pageSize: 15, totalPages: 0, availableTags: [] },
    query: {},
  },
) {
  const controller = {
    load: vi.fn(),
    ensureSkillCatalog: vi.fn(),
    openDetail: vi.fn(),
    closeDetail: vi.fn(),
    install: vi.fn(),
    startSkill: vi.fn(),
    startLogin: vi.fn(),
    cancelLogin: vi.fn(),
    loadRecipes: vi.fn(),
    ensureRecipeCatalog: vi.fn(),
    openRecipeDetail: vi.fn(),
    closeRecipeDetail: vi.fn(),
    startRecipe: vi.fn(),
  } satisfies ControllerMocks
  return {
    controller: controller as unknown as ManturMarketplaceStore,
    controllerMocks: controller,
    useMarketplace: ((selector: (value: ManturMarketplaceState) => unknown) => selector(state)) as never,
    useRecipes: ((selector: (value: ManturRecipeMarketplaceState) => unknown) => selector(recipeState)) as never,
  }
}

describe('Mantur marketplace navigation', () => {
  it.each([false, true])('returns focus to the same detail action after login with signedIn=%s', (signedIn) => {
    const detail = { slug: 'kept', name: '保留详情', description: '', category: '', version: '1', triggers: [], installed: false, usesOperators: [] }
    const state = { ...emptyReady, detail }
    const p = marketplaceProps(state)
    const page = (next: ManturMarketplaceState) => <MarketplacePage {...globalProps} {...p}
      useMarketplace={marketplaceProps(next).useMarketplace} activePage={MANTUR_MARKET_PAGES.skills} closePage={vi.fn()} t={t} />
    const view = render(page(state))
    fireEvent.click(screen.getByRole('button', { name: '登录后安装' }))
    view.rerender(page({ ...state, loginPhase: 'starting' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    view.rerender(page({ ...state, catalog: { ...state.catalog, signedIn } }))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: signedIn ? '安装技能' : '登录后安装' }))
    expect(p.controllerMocks.install).not.toHaveBeenCalled()
  })

  it('does not move focus when a different detail replaces the login source', () => {
    const detail = { slug: 'old', name: '旧详情', description: '', category: '', version: '1', triggers: [], installed: false, usesOperators: [] }
    const state = { ...emptyReady, detail }
    const page = (next: ManturMarketplaceState) => <MarketplacePage {...globalProps} {...marketplaceProps(next)}
      activePage={MANTUR_MARKET_PAGES.skills} closePage={vi.fn()} t={t} />
    const view = render(page(state))
    fireEvent.click(screen.getByRole('button', { name: '登录后安装' }))
    view.rerender(page({ ...state, loginPhase: 'starting' }))
    const before = document.activeElement
    view.rerender(page({ ...state, detail: { ...detail, slug: 'new', name: '新详情' } }))
    expect(document.activeElement).toBe(before)
  })

  it('renders Features before the two fixed entries and opens the selected page', () => {
    const openPage = vi.fn()
    const { rerender } = render(
      <MarketplaceNavigation
        {...globalProps}
        wide activePage={undefined} openPage={openPage} closePage={vi.fn()} t={t}
      />,
    )
    expect(screen.getByRole('navigation', { name: '功能' })).toBeTruthy()
    const buttons = screen.getAllByRole('button')
    expect(buttons.map(button => button.textContent)).toEqual(['技能广场', '配方广场'])

    fireEvent.click(screen.getByRole('button', { name: '技能广场' }))
    expect(openPage).toHaveBeenCalledWith(MANTUR_MARKET_PAGES.skills)

    rerender(
      <MarketplaceNavigation
        {...globalProps}
        wide activePage={MANTUR_MARKET_PAGES.skills} openPage={openPage} closePage={vi.fn()} t={t}
      />,
    )
    expect(screen.getByRole('button', { name: '技能广场' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('button', { name: '配方广场' }).hasAttribute('aria-current')).toBe(false)
  })

  it('renders independent Skill and Recipe pages and returns to conversation', () => {
    const closePage = vi.fn()
    const view = render(
      <MarketplacePage
        {...globalProps}
        {...marketplaceProps()}
        activePage={MANTUR_MARKET_PAGES.skills} closePage={closePage} t={t}
      />,
    )
    expect(screen.getByRole('heading', { name: '技能广场' })).toBeTruthy()
    expect(screen.getByText('技能正在陆续上架，稍后从这里探索。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '返回对话' }))
    expect(closePage).toHaveBeenCalledOnce()

    view.rerender(
      <MarketplacePage
        {...globalProps}
        {...marketplaceProps()}
        activePage={MANTUR_MARKET_PAGES.recipes} closePage={closePage} t={t}
      />,
    )
    expect(screen.getByRole('heading', { name: '配方广场' })).toBeTruthy()
    expect(screen.getByText('从经过验证的优秀案例出发，替换成你的内容，让漫途复刻同款效果。')).toBeTruthy()
    expect(screen.getByText('还没有找到匹配的配方，换个关键词试试。')).toBeTruthy()
  })

  it('returns to conversation when the active marketplace occupant unloads', () => {
    const closePage = vi.fn()
    const view = render(
      <MarketplacePage
        {...globalProps}
        {...marketplaceProps()}
        activePage={MANTUR_MARKET_PAGES.skills}
        closePage={closePage}
        t={t}
      />,
    )

    view.unmount()
    expect(closePage).toHaveBeenCalledOnce()
  })

  it('renders real Recipe cards and opens the inline detail', () => {
    const recipeState: ManturRecipeMarketplaceState = {
      phase: 'ready',
      catalog: { recipes: [recipe], total: 1, page: 1, pageSize: 15, totalPages: 1, availableTags: recipe.tags },
      query: {},
    }
    const props = marketplaceProps(emptyReady, recipeState)
    render(
      <MarketplacePage
        {...globalProps}
        {...props}
        activePage={MANTUR_MARKET_PAGES.recipes}
        closePage={vi.fn()}
        t={t}
      />,
    )

    expect(screen.getByRole('heading', { name: '配方广场' })).toBeTruthy()
    expect(screen.getByText('电影感旅行 Vlog')).toBeTruthy()
    expect(screen.queryByText(recipe.summary)).toBeNull()
    expect(screen.queryByText('旅行')).toBeNull()
    expect(screen.getByText('约 0.16 元')).toBeTruthy()
    expect(screen.getByRole('textbox', { name: '搜索想复刻的画面、风格或用途' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '全部' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '复刻同款' }))
    expect(props.controllerMocks.openRecipeDetail).toHaveBeenCalledWith(recipe.slug)
  })

  it('starts a Recipe in a new conversation from its reproduction guide', async () => {
    const detail = {
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
    const props = marketplaceProps(emptyReady, {
      phase: 'ready',
      catalog: { recipes: [recipe], total: 1, page: 1, pageSize: 15, totalPages: 1, availableTags: [] },
      query: {},
      detail,
    })
    props.controllerMocks.startRecipe.mockResolvedValue(true)
    const closePage = vi.fn()
    render(
      <MarketplacePage
        {...globalProps}
        {...props}
        activePage={MANTUR_MARKET_PAGES.recipes}
        closePage={closePage}
        t={t}
      />,
    )

    expect(screen.getByRole('heading', { name: '电影感旅行 Vlog' })).toBeTruthy()
    expect(screen.getByText('你可以替换')).toBeTruthy()
    expect(screen.getByText('地点')).toBeTruthy()
    expect(screen.getByText('海边')).toBeTruthy()
    const source = screen.getByRole('link', { name: '查看来源：ManturHub' })
    expect(source.getAttribute('href')).toBe(detail.sourceUrl)
    expect(source.querySelector('img')?.getAttribute('src')).toBe(detail.sourceAvatarUrl)
    fireEvent.click(screen.getByRole('button', { name: '交给 Agent 复刻' }))
    await vi.waitFor(() => {
      expect(props.controllerMocks.startRecipe).toHaveBeenCalledWith({
        introduction: `我要复刻 ManturHub 配方「${detail.title}」。`,
        identifier: `配方标识：${detail.slug}`,
        platform: '配方平台：ManturHub',
        source: `来源地址：${detail.sourceUrl}`,
      })
    })
    expect(closePage).toHaveBeenCalledOnce()
  })

  it('renders only Recipe source metadata that the Hub publishes', () => {
    const { sourceUrl: _sourceUrl, sourceName: _sourceName, sourceAvatarUrl: _sourceAvatarUrl, ...detail } = {
      ...recipe,
      sampleText: '',
      promptTemplate: '',
      parameters: {},
      sourceUrl: 'https://hub.mantur.cn/recipes/rcp.video.story-vlog',
      sourceName: 'ManturHub',
      sourceAvatarUrl: 'https://hub.mantur.cn/assets/avatar.png',
      models: [],
      agentPayload: '请按配方执行。',
    }
    const catalog = { recipes: [recipe], total: 1, page: 1, pageSize: 15, totalPages: 1, availableTags: [] }
    const props = marketplaceProps(emptyReady, {
      phase: 'ready',
      catalog,
      query: {},
      detail: { ...detail, sourceUrl: 'https://hub.mantur.cn/recipes/rcp.video.story-vlog' },
    })
    const view = render(
      <MarketplacePage
        {...globalProps}
        {...props}
        activePage={MANTUR_MARKET_PAGES.recipes}
        closePage={vi.fn()}
        t={t}
      />,
    )

    const anonymousSource = screen.getByRole('link', { name: '查看来源' })
    expect(anonymousSource.querySelector('img')).toBeNull()
    view.rerender(
      <MarketplacePage
        {...globalProps}
        {...marketplaceProps(emptyReady, { phase: 'ready', catalog, query: {}, detail })}
        activePage={MANTUR_MARKET_PAGES.recipes}
        closePage={vi.fn()}
        t={t}
      />,
    )
    expect(screen.queryByRole('link', { name: /查看来源/ })).toBeNull()
  })

  it('shows loading and retryable catalog failures', () => {
    const loadingProps = marketplaceProps({ phase: 'idle' })
    const closePage = vi.fn()
    const view = render(
      <MarketplacePage
        {...globalProps}
        {...loadingProps}
        activePage={MANTUR_MARKET_PAGES.skills}
        closePage={closePage}
        t={t}
      />,
    )
    expect(screen.getByText('正在连接 ManturHub…')).toBeTruthy()
    expect(loadingProps.controllerMocks.ensureSkillCatalog).toHaveBeenCalledOnce()

    const failedProps = marketplaceProps({ phase: 'failed' })
    view.rerender(
      <MarketplacePage
        {...globalProps}
        {...failedProps}
        activePage={MANTUR_MARKET_PAGES.skills}
        closePage={closePage}
        t={t}
      />,
    )
    expect(screen.getByText('技能列表加载失败，请检查网络后重试。')).toBeTruthy()
    expect(failedProps.controllerMocks.ensureSkillCatalog).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    expect(failedProps.controllerMocks.load).toHaveBeenCalledOnce()
  })

  it('restores the cached Recipe query and page when the page opens again', async () => {
    vi.useFakeTimers()
    const props = marketplaceProps(emptyReady, {
      phase: 'ready',
      catalog: { recipes: [recipe], total: 30, page: 2, pageSize: 15, totalPages: 2, availableTags: recipe.tags },
      query: { page: 2, category: 'video', query: '旅行' },
    })
    render(
      <MarketplacePage
        {...globalProps}
        {...props}
        activePage={MANTUR_MARKET_PAGES.recipes}
        closePage={vi.fn()}
        t={t}
      />,
    )

    const search = screen.getByRole('textbox', { name: '搜索想复刻的画面、风格或用途' }) as HTMLInputElement
    expect(search.value).toBe('旅行')
    expect(screen.getByRole('button', { name: '视频' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('第 2 / 2 页')).toBeTruthy()
    await vi.advanceTimersByTimeAsync(250)
    expect(props.controllerMocks.ensureRecipeCatalog).not.toHaveBeenCalled()
  })

  it('keeps the two destinations available in the compact rail', () => {
    const openPage = vi.fn()
    render(
      <MarketplaceNavigation
        {...globalProps}
        wide={false}
        activePage={MANTUR_MARKET_PAGES.recipes}
        openPage={openPage}
        closePage={vi.fn()}
        t={t}
      />,
    )
    expect(screen.getByRole('button', { name: '配方广场' }).getAttribute('aria-current')).toBe('page')
    fireEvent.click(screen.getByRole('button', { name: '配方广场' }))
    expect(openPage).toHaveBeenCalledWith(MANTUR_MARKET_PAGES.recipes)
  })

  it('renders the product workspace term and rejects a page owned by another product', () => {
    render(<ProjectsHeading t={t} />)
    expect(screen.getByText('项目')).toBeTruthy()
    cleanup()
    expect(() => render(
      <MarketplacePage
        {...globalProps}
        {...marketplaceProps()}
        activePage={'other.page' as never}
        closePage={vi.fn()}
        t={t}
      />,
    )).toThrow(/unsupported main page/)
  })

  it('installs directly when signed in and presents the device login gate when signed out', () => {
    const listed = {
      slug: 'story-director',
      name: '故事导演',
      description: '把故事变成分镜',
      category: '剧本创作',
      version: '1.2.3',
      triggers: ['写分镜'],
      installed: false,
    }
    const signedIn: ManturMarketplaceState = {
      phase: 'ready',
      catalog: { skills: [listed], installedCount: 0, signedIn: true },
    }
    const signedInProps = marketplaceProps(signedIn)
    const closePage = vi.fn()
    const view = render(
      <MarketplacePage
        {...globalProps}
        {...signedInProps}
        activePage={MANTUR_MARKET_PAGES.skills}
        closePage={closePage}
        t={t}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '安装技能' }))
    expect(signedInProps.controllerMocks.install).toHaveBeenCalledWith('story-director')

    const directFailureProps = marketplaceProps({
      ...signedIn,
      catalog: { ...signedIn.catalog, signedIn: false },
      installError: 'auth-required',
    })
    view.rerender(
      <MarketplacePage
        {...globalProps}
        {...directFailureProps}
        activePage={MANTUR_MARKET_PAGES.skills}
        closePage={closePage}
        t={t}
      />,
    )
    expect(screen.getByRole('alert').textContent).toContain('ManturHub 登录已失效')
    fireEvent.click(screen.getByRole('button', { name: /故事导演/ }))
    expect(directFailureProps.controllerMocks.openDetail).toHaveBeenCalledWith(listed.slug)

    const reloginProps = marketplaceProps({
      ...signedIn,
      catalog: { ...signedIn.catalog, signedIn: false },
      detail: { ...listed, usesOperators: [] },
    })
    view.rerender(
      <MarketplacePage
        {...globalProps}
        {...reloginProps}
        activePage={MANTUR_MARKET_PAGES.skills}
        closePage={closePage}
        t={t}
      />,
    )
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '登录后安装' }))
    expect(reloginProps.controllerMocks.startLogin).toHaveBeenCalledOnce()

    const installingProps = marketplaceProps({
      ...signedIn, installing: listed.slug, detail: { ...listed, usesOperators: [] },
    })
    view.rerender(
      <MarketplacePage
        {...globalProps}
        {...installingProps}
        activePage={MANTUR_MARKET_PAGES.skills}
        closePage={closePage}
        t={t}
      />,
    )
    expect(screen.getAllByRole('button', { name: '正在安装…' }).every(button => button.hasAttribute('disabled')))
      .toBe(true)

    const preparingProps = marketplaceProps({
      phase: 'ready',
      catalog: { skills: [listed], installedCount: 0, signedIn: false },
      detail: { ...listed, usesOperators: [] },
      loginPhase: 'starting',
    })
    view.rerender(
      <MarketplacePage
        {...globalProps} {...preparingProps} activePage={MANTUR_MARKET_PAGES.skills} closePage={closePage} t={t}
      />,
    )
    expect(screen.queryByRole('dialog')).toBeNull()

    const installed = { ...listed, installed: true }
    const installedProps = marketplaceProps({
      phase: 'ready',
      catalog: { skills: [installed], installedCount: 1, signedIn: true },
    })
    view.rerender(
      <MarketplacePage
        {...globalProps}
        {...installedProps}
        activePage={MANTUR_MARKET_PAGES.skills}
        closePage={closePage}
        t={t}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '使用技能' }))
    expect(installedProps.controllerMocks.startSkill).toHaveBeenCalledWith(installed.slug)

    const signedOut: ManturMarketplaceState = {
      phase: 'ready',
      catalog: { skills: [listed], installedCount: 0, signedIn: false },
      detail: { ...listed, usesOperators: [] },
    }
    const signedOutProps = marketplaceProps(signedOut)
    view.rerender(
      <MarketplacePage
        {...globalProps}
        {...signedOutProps}
        activePage={MANTUR_MARKET_PAGES.skills}
        closePage={closePage}
        t={t}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '登录后安装' }))
    expect(signedOutProps.controllerMocks.startLogin).toHaveBeenCalledOnce()
  })

  it('opens a successful installed Skill launch and presents pending or failed launches', async () => {
    const installed = {
      slug: 'story-director', name: '故事导演', description: '把故事变成分镜', category: '剧本创作',
      version: '1.2.3', triggers: ['写分镜'], installed: true,
    }
    const closePage = vi.fn()
    const props = marketplaceProps({
      phase: 'ready', catalog: { skills: [installed], installedCount: 1, signedIn: true },
    })
    props.controllerMocks.startSkill.mockResolvedValue(true)
    const view = render(
      <MarketplacePage
        {...globalProps} {...props} activePage={MANTUR_MARKET_PAGES.skills} closePage={closePage} t={t}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '使用技能' }))
    await waitFor(() => { expect(closePage).toHaveBeenCalledOnce() })

    const pending = marketplaceProps({
      phase: 'ready', catalog: { skills: [installed], installedCount: 1, signedIn: true },
      detail: { ...installed, usesOperators: [] }, using: installed.slug,
    })
    view.rerender(
      <MarketplacePage
        {...globalProps} {...pending} activePage={MANTUR_MARKET_PAGES.skills} closePage={vi.fn()} t={t}
      />,
    )
    expect(screen.getAllByRole('button', { name: '正在创建…' })
      .every(button => button.hasAttribute('disabled'))).toBe(true)

    const missingProject = marketplaceProps({
      phase: 'ready', catalog: { skills: [installed], installedCount: 1, signedIn: true },
      useError: 'no-workspace',
    })
    view.rerender(
      <MarketplacePage
        {...globalProps} {...missingProject} activePage={MANTUR_MARKET_PAGES.skills} closePage={vi.fn()} t={t}
      />,
    )
    expect(screen.getByRole('alert').textContent).toContain('请先选择一个项目')

    const failedDetail = marketplaceProps({
      phase: 'ready', catalog: { skills: [installed], installedCount: 1, signedIn: true },
      detail: { ...installed, usesOperators: [] }, useError: 'failed',
    })
    view.rerender(
      <MarketplacePage
        {...globalProps} {...failedDetail} activePage={MANTUR_MARKET_PAGES.skills} closePage={vi.fn()} t={t}
      />,
    )
    expect(screen.getByRole('alert').textContent).toContain('新对话没有创建成功')
  })

  it('filters the catalog, opens details, and presents detail outcomes', () => {
    const story = {
      slug: 'story-director', name: '故事导演', description: '把故事变成分镜', category: '剧本创作',
      version: '1.2.3', triggers: ['写分镜'], installed: false,
    }
    const art = {
      slug: 'art-maker', name: '画面生成', description: '生成角色图片', category: '视觉素材',
      version: '2.0.0', triggers: ['画角色'], installed: false,
    }
    const base = { phase: 'ready' as const, catalog: { skills: [story, art], installedCount: 0, signedIn: true } }
    const props = marketplaceProps(base)
    const view = render(
      <MarketplacePage
        {...globalProps} {...props} activePage={MANTUR_MARKET_PAGES.skills} closePage={vi.fn()} t={t}
      />,
    )

    const search = screen.getByPlaceholderText('搜索技能名称、用途或触发词')
    fireEvent.change(search, { target: { value: '角色' } })
    expect(screen.queryByText('故事导演')).toBeNull()
    expect(screen.getByText('画面生成')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '视觉素材' }))
    fireEvent.click(screen.getByRole('button', { name: '全部' }))
    fireEvent.change(search, { target: { value: '不存在' } })
    expect(screen.getByText('没有找到匹配的技能。')).toBeTruthy()

    fireEvent.change(search, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: /故事导演/ }))
    expect(props.controllerMocks.openDetail).toHaveBeenCalledWith(story.slug)

    const detailProps = marketplaceProps({
      ...base,
      detail: { ...story, usesOperators: ['op.text'], introduction: '使用说明' },
      installError: 'local-conflict',
    })
    view.rerender(
      <MarketplacePage
        {...globalProps} {...detailProps} activePage={MANTUR_MARKET_PAGES.skills} closePage={vi.fn()} t={t}
      />,
    )
    expect(screen.getByText('使用说明')).toBeTruthy()
    expect(screen.getByText('版本 1.2.3')).toBeTruthy()
    expect(screen.getByText(/本地已有同名技能/)).toBeTruthy()
    const installButtons = screen.getAllByRole('button', { name: '安装技能' })
    fireEvent.click(installButtons[installButtons.length - 1] as HTMLElement)
    expect(detailProps.controllerMocks.install).toHaveBeenCalledWith(story.slug)

    const failedProps = marketplaceProps({ ...base, detail: { ...story, usesOperators: [] }, installError: 'failed', loginPhase: 'failed' })
    view.rerender(
      <MarketplacePage
        {...globalProps} {...failedProps} activePage={MANTUR_MARKET_PAGES.skills} closePage={vi.fn()} t={t}
      />,
    )
    expect(screen.getByText('技能安装失败，原有文件没有被覆盖。请稍后重试。')).toBeTruthy()
    expect(screen.getByText('ManturHub 登录没有完成，请重试。')).toBeTruthy()
    const unavailableProps = marketplaceProps({ ...base, detail: { ...story, usesOperators: [] }, loginPhase: 'unavailable' })
    view.rerender(
      <MarketplacePage {...globalProps} {...unavailableProps} activePage={MANTUR_MARKET_PAGES.skills} closePage={vi.fn()} t={t} />,
    )
    expect(screen.getByRole('alert').textContent).toBe('账号登录界面暂不可用，请关闭其他弹窗或重新连接客户端后重试。')

    const loginProps = marketplaceProps({
      ...base,
      catalog: { ...base.catalog, signedIn: false },
      detail: { ...story, usesOperators: [] },
      loginPhase: 'authorizing',
      login: {
        attemptId: 'attempt' as never,
        verificationUrl: 'https://hub.mantur.ai/device',
        userCode: 'MANT-1234',
        expiresAt: Date.now() + 60_000,
      },
    })
    view.rerender(
      <MarketplacePage
        {...globalProps} {...loginProps} activePage={MANTUR_MARKET_PAGES.skills} closePage={vi.fn()} t={t}
      />,
    )
    expect(screen.getByText('MANT-1234')).toBeTruthy()
    expect(screen.getByRole('link', { name: '打开 ManturHub 登录页' }).getAttribute('href')).toBe('https://hub.mantur.ai/device')
    fireEvent.click(screen.getByRole('button', { name: '取消登录' }))
    expect(loginProps.controllerMocks.cancelLogin).toHaveBeenCalledOnce()
  })

  it('opens signed-out cards, closes loading details, and renders an installed detail', () => {
    const installed = {
      slug: 'story-director', name: '故事导演', description: '把故事变成分镜', category: '剧本创作',
      version: '1.2.3', triggers: [], installed: true,
    }
    const loadingProps = marketplaceProps({
      phase: 'ready', catalog: { skills: [{ ...installed, installed: false }], installedCount: 0, signedIn: false },
      detailLoading: installed.slug,
    })
    const view = render(
      <MarketplacePage
        {...globalProps} {...loadingProps} activePage={MANTUR_MARKET_PAGES.skills} closePage={vi.fn()} t={t}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '查看' }))
    expect(loadingProps.controllerMocks.openDetail).toHaveBeenCalledWith(installed.slug)
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(loadingProps.controllerMocks.closeDetail).toHaveBeenCalledOnce()

    const failedProps = marketplaceProps({
      phase: 'ready',
      catalog: {
        skills: [{ ...installed, installed: false }], installedCount: 0, signedIn: false,
      },
      detailError: installed.slug,
    })
    view.rerender(
      <MarketplacePage
        {...globalProps} {...failedProps} activePage={MANTUR_MARKET_PAGES.skills} closePage={vi.fn()} t={t}
      />,
    )
    expect(screen.getByText('暂时无法读取这个技能的详情，请检查网络后重试。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重新加载详情' }))
    expect(failedProps.controllerMocks.openDetail).toHaveBeenCalledWith(installed.slug)

    const installedProps = marketplaceProps({
      phase: 'ready', catalog: { skills: [installed], installedCount: 1, signedIn: true },
      detail: { ...installed, usesOperators: [] },
    })
    view.rerender(
      <MarketplacePage
        {...globalProps} {...installedProps} activePage={MANTUR_MARKET_PAGES.skills} closePage={vi.fn()} t={t}
      />,
    )
    const useButtons = screen.getAllByRole('button', { name: '使用技能' })
    fireEvent.click(useButtons[useButtons.length - 1] as HTMLElement)
    expect(installedProps.controllerMocks.startSkill).toHaveBeenCalledWith(installed.slug)
  })

  it('loads filtered Recipe pages and exposes every catalog recovery action', async () => {
    vi.useFakeTimers()
    const failedProps = marketplaceProps(emptyReady, { phase: 'failed', query: { page: 2, category: 'video' } })
    const view = render(
      <MarketplacePage
        {...globalProps} {...failedProps} activePage={MANTUR_MARKET_PAGES.recipes} closePage={vi.fn()} t={t}
      />,
    )
    expect(screen.getByText('配方列表加载失败，请检查网络后重试。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    expect(failedProps.controllerMocks.loadRecipes).toHaveBeenCalledWith({ page: 2, category: 'video' })

    const loadingProps = marketplaceProps(emptyReady, { phase: 'loading', query: { page: 2, category: 'video' } })
    view.rerender(
      <MarketplacePage
        {...globalProps} {...loadingProps} activePage={MANTUR_MARKET_PAGES.recipes} closePage={vi.fn()} t={t}
      />,
    )
    expect(screen.getByText('正在从 ManturHub 取回配方…')).toBeTruthy()

    const idleProps = marketplaceProps(emptyReady, { phase: 'idle' })
    view.rerender(
      <MarketplacePage
        {...globalProps} {...idleProps} activePage={MANTUR_MARKET_PAGES.recipes} closePage={vi.fn()} t={t}
      />,
    )
    expect(idleProps.controllerMocks.ensureRecipeCatalog).toHaveBeenCalledWith()

    const detailLoadingProps = marketplaceProps(emptyReady, {
      phase: 'ready',
      catalog: { recipes: [], total: 0, page: 1, pageSize: 15, totalPages: 1, availableTags: [] },
      query: {},
      detailLoading: recipe.slug,
    })
    view.rerender(
      <MarketplacePage
        {...globalProps} {...detailLoadingProps} activePage={MANTUR_MARKET_PAGES.recipes} closePage={vi.fn()} t={t}
      />,
    )
    expect(screen.getByRole('status').textContent).toBe('正在展开配方…')

    const detailErrorProps = marketplaceProps(emptyReady, {
      phase: 'ready',
      catalog: { recipes: [], total: 0, page: 1, pageSize: 15, totalPages: 1, availableTags: [] },
      query: {},
      detailError: recipe.slug,
    })
    view.rerender(
      <MarketplacePage
        {...globalProps} {...detailErrorProps} activePage={MANTUR_MARKET_PAGES.recipes} closePage={vi.fn()} t={t}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '重新加载详情' }))
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(detailErrorProps.controllerMocks.openRecipeDetail).toHaveBeenCalledWith(recipe.slug)
    expect(detailErrorProps.controllerMocks.closeRecipeDetail).toHaveBeenCalledOnce()

    const imageRecipe = { ...recipe, category: 'image' as const, sampleKind: 'image' as const, costEstimate: '' }
    const catalogProps = marketplaceProps(emptyReady, {
      phase: 'ready',
      catalog: { recipes: [imageRecipe], total: 3, page: 2, pageSize: 1, totalPages: 3, availableTags: [] },
      query: {},
    })
    view.rerender(
      <MarketplacePage
        {...globalProps} {...catalogProps} activePage={MANTUR_MARKET_PAGES.recipes} closePage={vi.fn()} t={t}
      />,
    )
    expect(catalogProps.controllerMocks.ensureRecipeCatalog).not.toHaveBeenCalled()
    expect(screen.getByText('运行前实时报价')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: `查看配方：${imageRecipe.title}` }))
    fireEvent.click(screen.getByRole('button', { name: imageRecipe.title }))
    fireEvent.click(screen.getByRole('button', { name: '上一页' }))
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(catalogProps.controllerMocks.openRecipeDetail).toHaveBeenCalledTimes(2)
    expect(catalogProps.controllerMocks.ensureRecipeCatalog).toHaveBeenCalledWith({ category: 'video' })
    expect(catalogProps.controllerMocks.ensureRecipeCatalog).toHaveBeenCalledWith({ page: 3, category: 'video' })

    catalogProps.controllerMocks.ensureRecipeCatalog.mockClear()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: ' 旅行 ' } })
    fireEvent.click(screen.getByRole('button', { name: '图片' }))
    await vi.advanceTimersByTimeAsync(249)
    expect(catalogProps.controllerMocks.ensureRecipeCatalog).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(catalogProps.controllerMocks.ensureRecipeCatalog).toHaveBeenCalledOnce()
    expect(catalogProps.controllerMocks.ensureRecipeCatalog).toHaveBeenCalledWith({ category: 'image', query: '旅行' })

    catalogProps.controllerMocks.ensureRecipeCatalog.mockClear()
    fireEvent.click(screen.getByRole('button', { name: '全部' }))
    await vi.advanceTimersByTimeAsync(250)
    expect(catalogProps.controllerMocks.ensureRecipeCatalog).toHaveBeenCalledWith({ query: '旅行' })

    const firstPageProps = marketplaceProps(emptyReady, {
      phase: 'ready',
      catalog: { recipes: [imageRecipe], total: 3, page: 1, pageSize: 1, totalPages: 3, availableTags: [] },
      query: {},
    })
    view.rerender(
      <MarketplacePage
        {...globalProps} {...firstPageProps} activePage={MANTUR_MARKET_PAGES.recipes} closePage={vi.fn()} t={t}
      />,
    )
    vi.clearAllTimers()
    const previous = screen.getByRole('button', { name: '上一页' })
    expect(previous.hasAttribute('disabled')).toBe(true)
    fireEvent.click(previous)
    expect(firstPageProps.controllerMocks.ensureRecipeCatalog).not.toHaveBeenCalled()

    const lastPageProps = marketplaceProps(emptyReady, {
      phase: 'ready',
      catalog: { recipes: [imageRecipe], total: 3, page: 3, pageSize: 1, totalPages: 3, availableTags: [] },
      query: {},
    })
    view.rerender(
      <MarketplacePage
        {...globalProps} {...lastPageProps} activePage={MANTUR_MARKET_PAGES.recipes} closePage={vi.fn()} t={t}
      />,
    )
    vi.clearAllTimers()
    const next = screen.getByRole('button', { name: '下一页' })
    expect(next.hasAttribute('disabled')).toBe(true)
    fireEvent.click(next)
    expect(lastPageProps.controllerMocks.ensureRecipeCatalog).not.toHaveBeenCalled()

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '卸载前取消' } })
    view.unmount()
    await vi.advanceTimersByTimeAsync(250)
    expect(lastPageProps.controllerMocks.ensureRecipeCatalog).not.toHaveBeenCalled()
  })

  it('renders Recipe detail variants and keeps failed launches on the page', async () => {
    const catalog = { recipes: [recipe], total: 1, page: 1, pageSize: 15, totalPages: 1, availableTags: [] }
    const imageDetail = {
      ...recipe,
      sampleKind: 'image' as const,
      costEstimate: '',
      sampleText: '',
      promptTemplate: '',
      parameters: { user_inputs: 42 },
      models: [],
      agentPayload: '请按配方执行。',
    }
    const props = marketplaceProps(emptyReady, {
      phase: 'ready', catalog, query: {}, detail: imageDetail, launchError: 'no-workspace',
    })
    props.controllerMocks.startRecipe.mockResolvedValue(false)
    const closePage = vi.fn()
    const view = render(
      <MarketplacePage
        {...globalProps} {...props} activePage={MANTUR_MARKET_PAGES.recipes} closePage={closePage} t={t}
      />,
    )
    expect(screen.getByRole('img', { name: imageDetail.title })).toBeTruthy()
    expect(screen.getByText('运行前实时报价')).toBeTruthy()
    expect(screen.getByText('42')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe('请先选择一个项目，再开始复刻。')
    fireEvent.click(screen.getByRole('button', { name: '返回配方广场' }))
    expect(props.controllerMocks.closeRecipeDetail).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: '交给 Agent 复刻' }))
    await vi.waitFor(() => { expect(props.controllerMocks.startRecipe).toHaveBeenCalledOnce() })
    expect(closePage).not.toHaveBeenCalled()
    expect(props.controllerMocks.startRecipe).toHaveBeenCalledWith({
      introduction: `我要复刻 ManturHub 配方「${imageDetail.title}」。`,
      identifier: `配方标识：${imageDetail.slug}`,
      platform: '配方平台：ManturHub',
    })

    view.rerender(
      <MarketplacePage
        {...globalProps}
        {...marketplaceProps(emptyReady, {
          phase: 'ready', catalog, query: {},
          detail: { ...imageDetail, parameters: null }, launching: imageDetail.slug, launchError: 'failed',
        })}
        activePage={MANTUR_MARKET_PAGES.recipes} closePage={closePage} t={t}
      />,
    )
    expect(screen.getByRole('button', { name: '正在创建新对话…' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('alert').textContent).toBe('新对话没有创建成功，请稍后重试。')

    view.rerender(
      <MarketplacePage
        {...globalProps}
        {...marketplaceProps(emptyReady, {
          phase: 'ready', catalog, query: {}, detail: { ...imageDetail, parameters: '地点' },
        })}
        activePage={MANTUR_MARKET_PAGES.recipes} closePage={closePage} t={t}
      />,
    )
    expect(screen.queryByText('你可以替换')).toBeNull()

    view.rerender(
      <MarketplacePage
        {...globalProps}
        {...marketplaceProps(emptyReady, {
          phase: 'ready', catalog, query: {}, detail: { ...imageDetail, parameters: [] },
        })}
        activePage={MANTUR_MARKET_PAGES.recipes} closePage={closePage} t={t}
      />,
    )
    expect(screen.queryByText('你可以替换')).toBeNull()

    view.rerender(
      <MarketplacePage
        {...globalProps}
        {...marketplaceProps(emptyReady, {
          phase: 'ready', catalog, query: {}, detail: { ...imageDetail, parameters: { user_inputs: ['海边'] } },
        })}
        activePage={MANTUR_MARKET_PAGES.recipes} closePage={closePage} t={t}
      />,
    )
    expect(screen.getByText('["海边"]')).toBeTruthy()
  })
})
