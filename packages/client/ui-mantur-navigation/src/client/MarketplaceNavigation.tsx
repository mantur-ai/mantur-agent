/** Mantur feature navigation and root-page skeletons. */

import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import clsx from 'clsx'
import {
  IconChevronLeftOutline14, IconChevronRightOutline14, IconCopyOutline16,
  IconListPenOutline16, IconPlayOutline16, IconSearchOutline16,
  IconSkillOutline16, Modal, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MainPageId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ManturRecipeJsonValue } from '@deepseek-ai/dsh-manturhub-marketplace/types'
import type { ManturNavigationKey } from './locales.ts'
import type {
  ManturMarketplaceState, ManturMarketplaceStore, ManturRecipeMarketplaceState,
} from './store.ts'
import css from './MarketplaceNavigation.module.css'

/** Mantur root-page identifiers. */
export const MANTUR_MARKET_PAGES = {
  skills: 'mantur.skills' as MainPageId,
  recipes: 'mantur.recipes' as MainPageId,
} as const

/** Root page owned by this plugin. */
export type ManturMarketPageId = typeof MANTUR_MARKET_PAGES[keyof typeof MANTUR_MARKET_PAGES]

/** Full sidebar navigation props. */
export type MarketplaceNavigationProps =
  PropsRuntime<'sidebar.navigation'> & PropsLocale<'navigation.mantur'>

/** Full root-page props. */
export type MarketplacePageProps =
  PropsRuntime<'main.page'> & PropsLocale<'navigation.mantur'> & InjectFace<MarketplacePageInjected>

/** Marketplace page dependencies supplied by the client plugin. */
export interface MarketplacePageInjected {
  controller: ManturMarketplaceStore
  hooks: {
    marketplace: SnapshotStore<ManturMarketplaceState>
    recipes: SnapshotStore<ManturRecipeMarketplaceState>
  }
}

interface NavigationItem {
  id: ManturMarketPageId
  label: 'skills.title' | 'recipes.title'
  icon: ComponentType<{ size?: number; className?: string }>
}

const items: readonly NavigationItem[] = [
  { id: MANTUR_MARKET_PAGES.skills, label: 'skills.title', icon: IconSkillOutline16 },
  { id: MANTUR_MARKET_PAGES.recipes, label: 'recipes.title', icon: IconListPenOutline16 },
]

/** Render the Mantur-only feature group above Projects. */
export function MarketplaceNavigation({ wide, activePage, openPage, t }: MarketplaceNavigationProps) {
  return (
    <nav className={clsx(css.navigation, !wide && css.rail)} aria-label={t('section.features')}>
      <div className={css.navigationItems}>
        {items.map(({ id, label, icon: Icon }) => {
          const selected = activePage === id
          const button = (
            <button
              key={id}
              type="button"
              className={clsx(css.navigationItem, selected && css.selected)}
              aria-current={selected ? 'page' : undefined}
              aria-label={t(label)}
              onClick={() => { openPage(id) }}
            >
              <Icon size={wide ? 16 : 18} />
              {wide && <span>{t(label)}</span>}
            </button>
          )
          return wide
            ? button
            : <Tooltip key={id} label={t(label)} side="right" delayMs={500}>{button}</Tooltip>
        })}
      </div>
    </nav>
  )
}

interface PageCopy {
  title: 'skills.title' | 'recipes.title'
  description: 'skills.description' | 'recipes.description'
  empty: 'skills.empty' | 'recipes.empty'
  icon: ComponentType<{ size?: number; className?: string }>
}

const pageCopy: Record<ManturMarketPageId, PageCopy> = {
  [MANTUR_MARKET_PAGES.skills]: {
    title: 'skills.title',
    description: 'skills.description',
    empty: 'skills.empty',
    icon: IconSkillOutline16,
  },
  [MANTUR_MARKET_PAGES.recipes]: {
    title: 'recipes.title',
    description: 'recipes.description',
    empty: 'recipes.empty',
    icon: IconListPenOutline16,
  },
}

/** Render the selected Mantur marketplace as an independent root page. */
export function MarketplacePage({ activePage, closePage, controller, useMarketplace, useRecipes, t }: MarketplacePageProps) {
  // Registry disposal unmounts the active occupant before a replacement can
  // render, so the layout must not retain this plugin's page identifier.
  useEffect(() => () => { closePage() }, [closePage])
  const copy = pageCopy[activePage]
  if (copy === undefined) throw new Error(`ui-mantur-navigation: unsupported main page "${activePage}"`)
  if (activePage === MANTUR_MARKET_PAGES.skills) {
    return <SkillMarketplace closePage={closePage} controller={controller} useMarketplace={useMarketplace} t={t} />
  }
  return <RecipeMarketplace closePage={closePage} controller={controller} useRecipes={useRecipes} t={t} />
}

/** Render the live Skill catalog with reliable client-side filtering. */
function SkillMarketplace({ closePage, controller, useMarketplace, t }: {
  readonly closePage: () => void
  readonly controller: ManturMarketplaceStore
  readonly useMarketplace: MarketplacePageProps['useMarketplace']
  readonly t: MarketplacePageProps['t']
}) {
  const state = useMarketplace(snapshot => snapshot)
  const ready = state.phase === 'ready' ? state : undefined
  const detail = ready?.detail
  const detailError = ready?.detailError
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  useEffect(() => {
    void controller.ensureSkillCatalog()
  }, [controller])

  const useSkill = async (slug: string): Promise<void> => {
    if (await controller.startSkill(slug)) closePage()
  }

  const skills = state.phase === 'ready' ? state.catalog.skills : []
  const categories = useMemo(
    () => [...new Set(skills.map(skill => skill.category))].sort((a, b) => a.localeCompare(b)),
    [skills],
  )
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return skills.filter(skill => (category === '' || skill.category === category)
      && (needle === '' || [skill.name, skill.description, ...skill.triggers]
        .some(value => value.toLocaleLowerCase().includes(needle))))
  }, [category, query, skills])
  const detailFooter = detail === undefined || ready === undefined
    ? undefined
    : detail.installed
      ? (
        <button
          type="button"
          className={css.install}
          disabled={ready.using !== undefined}
          onClick={() => { void useSkill(detail.slug) }}
        >
          {ready.using === detail.slug ? t('skills.using') : t('skills.use')}
        </button>
      )
      : ready.catalog.signedIn
        ? (
          <button
            type="button"
            className={css.install}
            disabled={ready.installing !== undefined}
            onClick={() => { void controller.install(detail.slug) }}
          >
            {ready.installing === detail.slug ? t('skills.installing') : t('skills.install')}
          </button>
        )
        : (
          <button
            type="button"
            className={css.install}
            disabled={ready.loginPhase === 'starting' || ready.loginPhase === 'authorizing'}
            onClick={() => { void controller.startLogin() }}
          >
            {ready.loginPhase === 'starting' ? t('skills.loginPreparing') : t('skills.loginToInstall')}
          </button>
        )
  const installErrorNotice = ready?.installError === undefined
    ? undefined
    : (
      <p className={css.installError} role="alert">
        {ready.installError === 'auth-required'
          ? t('skills.authRequired')
          : ready.installError === 'local-conflict'
            ? t('skills.localConflict')
            : t('skills.installFailed')}
      </p>
    )
  const useErrorNotice = ready?.useError === undefined
    ? undefined
    : (
      <p className={css.installError} role="alert">
        {ready.useError === 'no-workspace' ? t('skills.noWorkspace') : t('skills.useFailed')}
      </p>
    )

  return (
    <main className={css.page} aria-labelledby="mantur-marketplace-title">
      <header className={css.pageHeader}>
        <button type="button" className={css.back} onClick={closePage}>
          <IconChevronLeftOutline14 />
          <span>{t('backToConversation')}</span>
        </button>
      </header>
      <section className={css.catalogBody}>
        <div className={css.catalogHeading}>
          <div>
            <h1 id="mantur-marketplace-title">{t('skills.title')}</h1>
            <p>{t('skills.description')}</p>
          </div>
          {state.phase === 'ready' && (
            <span className={css.installedCount}>{t('skills.installedCount').replace('{count}', String(state.catalog.installedCount))}</span>
          )}
        </div>

        {state.phase === 'ready' && (
          <>
            <label className={css.search}>
              <IconSearchOutline16 />
              <input value={query} onChange={(event) => { setQuery(event.target.value) }} placeholder={t('skills.search')} />
            </label>
            <div className={css.categories} aria-label={t('skills.categories')}>
              <button type="button" className={category === '' ? css.categoryActive : undefined} onClick={() => { setCategory('') }}>{t('skills.all')}</button>
              {categories.map(value => (
                <button key={value} type="button" className={category === value ? css.categoryActive : undefined} onClick={() => { setCategory(value) }}>{value}</button>
              ))}
            </div>
          </>
        )}

        {detail === undefined && installErrorNotice}
        {detail === undefined && useErrorNotice}

        {state.phase === 'idle' || state.phase === 'loading'
          ? <p className={css.status}>{t('skills.loading')}</p>
          : state.phase === 'failed'
            ? <div className={css.status}><p>{t('skills.failed')}</p><button type="button" onClick={() => { void controller.load() }}>{t('skills.retry')}</button></div>
            : visible.length === 0
              ? <p className={css.status}>{skills.length === 0 ? t('skills.empty') : t('skills.noMatches')}</p>
              : (
                <div className={css.skillGrid}>
                  {visible.map(skill => (
                    <article key={skill.slug} className={css.skillCard}>
                      <button type="button" className={css.cardMain} onClick={() => { void controller.openDetail(skill.slug) }}>
                        <span className={css.skillIcon} aria-hidden="true">{skill.name.slice(0, 1)}</span>
                        <span className={css.skillCopy}>
                          <strong>{skill.name}</strong>
                          <span>{skill.description}</span>
                        </span>
                      </button>
                      <div className={css.cardFooter}>
                        <span className={css.tag}>{skill.category}</span>
                        <button
                          type="button"
                          className={css.install}
                          disabled={ready?.installing !== undefined || ready?.using !== undefined}
                          onClick={() => {
                            if (skill.installed) void useSkill(skill.slug)
                            else if (ready?.catalog.signedIn === true) void controller.install(skill.slug)
                            else void controller.openDetail(skill.slug)
                          }}
                        >
                          {skill.installed
                            ? ready?.using === skill.slug ? t('skills.using') : t('skills.use')
                            : ready?.installing === skill.slug
                              ? t('skills.installing')
                              : ready?.catalog.signedIn === true
                                ? t('skills.install')
                                : t('skills.view')}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
      </section>
      <Modal
        open={ready?.loginPhase !== 'starting' && (detail !== undefined || ready?.detailLoading !== undefined || detailError !== undefined)}
        onClose={() => { controller.closeDetail() }}
        title={detail?.name ?? (detailError === undefined ? t('skills.loadingDetail') : t('skills.detailFailedTitle'))}
        closeLabel={t('close')}
        {...(detail === undefined ? {} : { description: detail.description })}
        {...(detailFooter === undefined ? {} : { footer: detailFooter })}
      >
        {detail === undefined && detailError !== undefined && (
          <div className={css.detailFailure}>
            <p>{t('skills.detailFailed')}</p>
            <button type="button" onClick={() => { void controller.openDetail(detailError) }}>
              {t('skills.retryDetail')}
            </button>
          </div>
        )}
        {detail !== undefined && ready !== undefined && (
          <div className={css.detail}>
            <div>
              <span className={css.tag}>{detail.category}</span>
              <span>{t('skills.version').replace('{version}', detail.version)}</span>
            </div>
            {detail.introduction !== undefined && <p>{detail.introduction}</p>}
            {installErrorNotice}
            {useErrorNotice}
            {ready.loginPhase === 'failed' && <p className={css.installError}>{t('skills.loginFailed')}</p>}
            {ready.loginPhase === 'unavailable' && <p className={css.installError} role="alert">{t('skills.loginUnavailable')}</p>}
            {ready.loginPhase === 'authorizing' && ready.login !== undefined && (
              <div className={css.loginGate}>
                <span>{t('skills.loginCode')}</span>
                <strong>{ready.login.userCode}</strong>
                <a href={ready.login.verificationUrl} target="_blank" rel="noreferrer">{t('skills.openLogin')}</a>
                <button type="button" onClick={() => { void controller.cancelLogin() }}>{t('skills.cancelLogin')}</button>
              </div>
            )}
          </div>
        )}
      </Modal>
    </main>
  )
}

const recipeCategories = ['', 'video', 'image', 'script'] as const

function currentRecipeQuery(
  query: string,
  category: (typeof recipeCategories)[number],
): { readonly category?: Exclude<typeof category, ''>; readonly query?: string } {
  const trimmed = query.trim()
  return {
    ...(category === '' ? {} : { category }),
    ...(trimmed === '' ? {} : { query: trimmed }),
  }
}

/** Render the live Recipe library and its inline reproduction guide. */
function RecipeMarketplace({ closePage, controller, useRecipes, t }: {
  readonly closePage: () => void
  readonly controller: ManturMarketplaceStore
  readonly useRecipes: MarketplacePageProps['useRecipes']
  readonly t: MarketplacePageProps['t']
}) {
  const state = useRecipes(snapshot => snapshot)
  const ready = state.phase === 'ready' ? state : undefined
  const detail = ready?.detail
  const detailError = ready?.detailError
  const initialQuery = state.phase === 'idle' ? {} : state.query
  const [query, setQuery] = useState(initialQuery.query ?? '')
  const [category, setCategory] = useState<(typeof recipeCategories)[number]>(initialQuery.category ?? '')
  const [page, setPage] = useState(initialQuery.page ?? 1)
  const appliedQuery = useRef({ query, category, page })
  useEffect(() => {
    if (state.phase === 'idle') void controller.ensureRecipeCatalog()
  }, [controller, state.phase])
  useEffect(() => {
    if (appliedQuery.current.query === query
      && appliedQuery.current.category === category
      && appliedQuery.current.page === page) return
    appliedQuery.current = { query, category, page }
    const timer = window.setTimeout(() => {
      void controller.ensureRecipeCatalog(currentRecipeQuery(query, category))
    }, 250)
    return () => { window.clearTimeout(timer) }
  }, [category, controller, page, query])

  const loadPage = (page: number): void => {
    appliedQuery.current = { query, category, page }
    setPage(page)
    void controller.ensureRecipeCatalog({
      ...(page === 1 ? {} : { page }),
      ...currentRecipeQuery(query, category),
    })
  }
  const launch = async (
    selected: NonNullable<Extract<ManturRecipeMarketplaceState, { phase: 'ready' }>['detail']>,
  ): Promise<void> => {
    if (await controller.startRecipe({
      introduction: t('recipes.launchIntroduction').replace('{title}', selected.title),
      identifier: t('recipes.launchIdentifier').replace('{slug}', selected.slug),
      platform: t('recipes.launchPlatform'),
      ...(selected.sourceUrl === undefined
        ? {}
        : { source: t('recipes.launchSource').replace('{url}', selected.sourceUrl) }),
    })) closePage()
  }

  return (
    <main className={css.page} aria-labelledby="mantur-recipe-title">
      <header className={css.pageHeader}>
        <button type="button" className={css.back} onClick={detail === undefined ? closePage : () => { controller.closeRecipeDetail() }}>
          <IconChevronLeftOutline14 />
          <span>{detail === undefined ? t('backToConversation') : t('recipes.backToList')}</span>
        </button>
      </header>
      {detail === undefined
        ? (
          <section className={css.recipeBody}>
            <div className={css.recipeHeading}>
              <div>
                <h1 id="mantur-recipe-title">{t('recipes.title')}</h1>
                <p>{t('recipes.description')}</p>
              </div>
              {ready !== undefined && <span>{t('recipes.total').replace('{count}', String(ready.catalog.total))}</span>}
            </div>
            <div className={css.recipeToolbar}>
              <label className={css.search}>
                <IconSearchOutline16 />
                <input
                  value={query}
                  onChange={(event) => { setQuery(event.target.value); setPage(1) }}
                  placeholder={t('recipes.search')}
                  aria-label={t('recipes.search')}
                />
              </label>
              <div className={css.categories} aria-label={t('recipes.categories')}>
                {recipeCategories.map(value => (
                  <button
                    key={value || 'all'} type="button"
                    className={category === value ? css.categoryActive : undefined}
                    aria-pressed={category === value}
                    onClick={() => { setCategory(value); setPage(1) }}
                  >
                    {value === '' ? t('recipes.all') : t(`recipes.category.${value}`)}
                  </button>
                ))}
              </div>
              <p className={css.recipePriceNote}>{t('recipes.priceNote')}</p>
            </div>

            {state.phase === 'failed'
              ? <div className={css.status}><p>{t('recipes.failed')}</p><button type="button" onClick={() => { void controller.loadRecipes(state.query) }}>{t('recipes.retry')}</button></div>
              : ready === undefined
                ? <p className={css.status}>{t('recipes.loading')}</p>
                : ready.detailLoading !== undefined
                  ? <p className={css.status} role="status">{t('recipes.loadingDetail')}</p>
                  : detailError !== undefined
                    ? (
                      <div className={css.status} role="alert">
                        <p>{t('recipes.detailFailed')}</p>
                        <button type="button" onClick={() => { void controller.openRecipeDetail(detailError) }}>{t('recipes.retryDetail')}</button>
                        <button type="button" onClick={() => { controller.closeRecipeDetail() }}>{t('close')}</button>
                      </div>
                    )
                    : ready.catalog.recipes.length === 0
                      ? <p className={css.status}>{t('recipes.noMatches')}</p>
                      : (
                        <>
                          <div className={css.recipeGrid}>
                            {ready.catalog.recipes.map(recipe => (
                              <article key={recipe.slug} className={css.recipeCard}>
                                <button type="button" className={css.recipeCover} onClick={() => { void controller.openRecipeDetail(recipe.slug) }} aria-label={t('recipes.viewNamed').replace('{title}', recipe.title)}>
                                  <img src={recipe.coverUrl} alt="" loading="lazy" />
                                  {recipe.sampleKind === 'video' && <span className={css.mediaBadge}><IconPlayOutline16 size={14} />{t('recipes.video')}</span>}
                                </button>
                                <div className={css.recipeCardBody}>
                                  <button type="button" className={css.recipeTitle} onClick={() => { void controller.openRecipeDetail(recipe.slug) }}>{recipe.title}</button>
                                  <div className={css.recipeMeta}>
                                    <span><IconCopyOutline16 size={14} />{t('recipes.copies').replace('{count}', String(recipe.copies))}</span>
                                    <span className={css.recipeCost}>{recipe.costEstimate || t('recipes.liveQuote')}</span>
                                    <button type="button" onClick={() => { void controller.openRecipeDetail(recipe.slug) }}>
                                      {t('recipes.recreate')}<IconChevronRightOutline14 />
                                    </button>
                                  </div>
                                </div>
                              </article>
                            ))}
                          </div>
                          {ready.catalog.totalPages > 1 && (
                            <nav className={css.pagination} aria-label={t('recipes.pagination')}>
                              <button type="button" disabled={ready.catalog.page <= 1} onClick={() => { loadPage(ready.catalog.page - 1) }}>{t('recipes.previous')}</button>
                              <span>{t('recipes.page').replace('{page}', String(ready.catalog.page)).replace('{total}', String(ready.catalog.totalPages))}</span>
                              <button type="button" disabled={ready.catalog.page >= ready.catalog.totalPages} onClick={() => { loadPage(ready.catalog.page + 1) }}>{t('recipes.next')}</button>
                            </nav>
                          )}
                        </>
                      )}
          </section>
        )
        : (
          <RecipeDetail
            detail={detail}
            launching={ready?.launching === detail.slug}
            launchError={ready?.launchError}
            launch={() => launch(detail)}
            t={t}
          />
        )}
    </main>
  )
}

function RecipeDetail({ detail, launching, launchError, launch, t }: {
  readonly detail: NonNullable<Extract<ManturRecipeMarketplaceState, { phase: 'ready' }>['detail']>
  readonly launching: boolean
  readonly launchError: 'no-workspace' | 'failed' | undefined
  readonly launch: () => Promise<void>
  readonly t: MarketplacePageProps['t']
}) {
  const parameters = detail.parameters !== null && typeof detail.parameters === 'object' && !Array.isArray(detail.parameters)
    ? detail.parameters.user_inputs
    : undefined
  return (
    <section className={css.recipeDetailBody}>
      <div className={css.recipeDetailMedia}>
        {detail.sampleKind === 'video'
          ? <video src={detail.sampleUrl} poster={detail.coverUrl} controls preload="metadata" />
          : <img src={detail.sampleUrl} alt={detail.title} />}
      </div>
      <article className={css.recipeDetailCopy}>
        <div className={css.recipeTags}>
          <span>{t(`recipes.category.${detail.category}`)}</span>
          {detail.tags.map(tag => <span key={tag}>{tag}</span>)}
        </div>
        <h1 id="mantur-recipe-title">{detail.title}</h1>
        <p className={css.recipeLead}>{detail.summary}</p>
        <div className={css.recipeDetailMeta}>
          <span>{t('recipes.author').replace('{author}', detail.author)}</span>
          <span>{t('recipes.copies').replace('{count}', String(detail.copies))}</span>
          <span>{detail.costEstimate || t('recipes.liveQuote')}</span>
        </div>
        <button type="button" className={css.recipeLaunch} disabled={launching} onClick={() => { void launch() }}>
          {launching ? t('recipes.launching') : t('recipes.launch')}
        </button>
        {launchError !== undefined && <p className={css.recipeLaunchError} role="alert">{launchError === 'no-workspace' ? t('recipes.noWorkspace') : t('recipes.launchFailed')}</p>}
        {detail.sourceUrl !== undefined && (
          <a className={css.recipeSource} href={detail.sourceUrl} target="_blank" rel="noreferrer">
            {detail.sourceAvatarUrl !== undefined && <img src={detail.sourceAvatarUrl} alt="" />}
            {detail.sourceName === undefined
              ? t('recipes.sourceAnonymous')
              : t('recipes.source').replace('{source}', detail.sourceName)}
          </a>
        )}
      </article>
      <div className={css.recipeSections}>
        {detail.sampleText !== '' && <RecipeSection title={t('recipes.outcome')} body={detail.sampleText} />}
        {parameters !== undefined && <RecipeInputs title={t('recipes.inputs')} value={parameters} />}
        {detail.promptTemplate !== '' && <RecipeSection title={t('recipes.prompt')} body={detail.promptTemplate} code wide />}
        <RecipeSection title={t('recipes.models')} body={[...detail.models, detail.operatorId].join(' · ')} />
        <RecipeSection title={t('recipes.guide')} body={detail.agentPayload} wide />
      </div>
    </section>
  )
}

function RecipeInputs({ title, value }: { readonly title: string; readonly value: ManturRecipeJsonValue }) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return <RecipeSection title={title} body={formatRecipeValue(value)} />
  }
  return (
    <section>
      <h2>{title}</h2>
      <dl className={css.recipeInputs}>
        {Object.entries(value).map(([name, input]) => <div key={name}><dt>{name}</dt><dd>{formatRecipeValue(input)}</dd></div>)}
      </dl>
    </section>
  )
}

function formatRecipeValue(value: ManturRecipeJsonValue): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function RecipeSection({ title, body, code = false, wide = false }: {
  readonly title: string
  readonly body: string
  readonly code?: boolean
  readonly wide?: boolean
}) {
  return <section className={wide ? css.recipeSectionWide : undefined}><h2>{title}</h2>{code ? <pre>{body}</pre> : <p>{body}</p>}</section>
}

/** Render Mantur's product term for the generic workspace section. */
export function ProjectsHeading({ t }: PropsLocale<'navigation.mantur'>) {
  return <>{t('projects')}</>
}

export type { ManturNavigationKey }
