/** Mode navigation and contextual guidance beside the resident composer. */

import { useEffect, useId, useRef, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ManturMarketplaceSkill } from '@deepseek-ai/dsh-manturhub-marketplace/types'
import type { ObservableSnapshot, SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InputState, ReferenceInsert } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { CREATION_MODES, type CreationMode, type GuideSettings } from '../guide-settings.ts'
import type { ManturMarketplaceState } from './store.ts'
import { GUIDE_SKILL_LABELS } from './guide-locales.ts'
import { useGuidePopover } from './useGuidePopover.ts'
import css from './CreationGuide.module.css'
import { focusDetailAction } from './detail-focus.ts'
import { GuideSkillRail } from './GuideSkillRail.tsx'

/** Settings operations shared by the two guide locations. */
export interface GuidePreferencesInjected {
  saveMode: (mode: CreationMode) => Promise<boolean>
  saveClosed: (closed: boolean) => Promise<boolean>
  hooks: { preferences: SettingsScope<GuideSettings> }
}

/** Framework-bound creation-mode props. */
export type CreationModesProps = PropsRuntime<'conversation.hero.modes'>
  & PropsLocale<'guide.mantur'> & InjectFace<GuidePreferencesInjected>

/** Render the four UI-only modes with roving keyboard focus. */
export function CreationModes({ usePreferences, saveMode, t }: CreationModesProps) {
  const preferences = usePreferences(snapshot => snapshot)
  const [failed, setFailed] = useState(false)
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  const choose = async (mode: CreationMode): Promise<void> => { setFailed(!await saveMode(mode)) }
  if (preferences.value === undefined) return <p className={css.status}>{t(preferences.status === 'loading' ? 'preferencesLoading' : 'preferencesUnavailable')}</p>
  return <div className={css.modeRegion}>
    <div className={css.modes} role="tablist" aria-label={t('modes')}>
      {CREATION_MODES.map((mode, index) => <button
        key={mode} type="button" role="tab" ref={(node) => { tabs.current[index] = node }}
        aria-selected={preferences.value?.mode === mode} tabIndex={preferences.value?.mode === mode ? 0 : -1}
        onClick={() => { void choose(mode) }}
        onKeyDown={(event) => {
          const target = event.key === 'ArrowRight' ? (index + 1) % CREATION_MODES.length
            : event.key === 'ArrowLeft' ? (index + CREATION_MODES.length - 1) % CREATION_MODES.length
              : event.key === 'Home' ? 0 : event.key === 'End' ? CREATION_MODES.length - 1 : undefined
          if (target === undefined) return
          event.preventDefault()
          tabs.current[target]?.focus()
          const nextMode = CREATION_MODES[target]
          if (nextMode !== undefined) void choose(nextMode)
        }}
      >{t(`mode.${mode}`)}</button>)}
    </div>
    {failed && <p role="alert" className={css.status}>{t('saveFailed')}</p>}
  </div>
}

/** Guide callbacks keep marketplace services outside components. */
export interface CreationGuideInjected extends GuidePreferencesInjected {
  navigationVersion: () => number
  appendReference: (reference: ReferenceInsert) => boolean
  load: () => Promise<void>
  ensureCatalog: () => Promise<void>
  openDetail: (slug: string) => Promise<void>
  closeDetail: () => void
  install: (slug: string) => Promise<boolean>
  startLogin: () => Promise<void>
  cancelLogin: () => Promise<void>
  marketplaceText: (key: 'skills.loading' | 'skills.failed' | 'skills.retry' | 'skills.search' | 'skills.noMatches'
    | 'skills.loadingDetail' | 'skills.detailFailed' | 'skills.installing' | 'skills.loginToInstall'
    | 'skills.loginPreparing' | 'skills.loginCode' | 'skills.openLogin' | 'skills.cancelLogin'
    | 'skills.loginFailed' | 'skills.loginUnavailable' | 'skills.localConflict' | 'skills.noWorkspace') => string
  hooks: GuidePreferencesInjected['hooks'] & {
    marketplace: SnapshotStore<ManturMarketplaceState>
    guideInput: ObservableSnapshot<InputState | undefined>
    guideNavigation: SnapshotStore<number>
  }
}

/** Framework-bound composer guide props. */
export type CreationGuideProps = PropsRuntime<'conversation.composer.guide'>
  & PropsLocale<'guide.mantur'> & InjectFace<CreationGuideInjected>

/** Render explicit preference-loading states without mounting a guessed default. */
export function CreationGuide(props: CreationGuideProps) {
  const preferences = props.usePreferences(snapshot => snapshot)
  if (preferences.value === undefined) return null
  return <ReadyGuide {...props} preferences={preferences.value} />
}

function ReadyGuide({ hero, disabled, sessionId, preferences, useMarketplace, useGuideInput,
  useGuideNavigation, navigationVersion, appendReference,
  saveClosed, load, ensureCatalog, openDetail: loadDetail, closeDetail: clearDetail,
  install, startLogin, cancelLogin, marketplaceText: mt, t,
}: CreationGuideProps & { preferences: GuideSettings }) {
  const market = useMarketplace(snapshot => snapshot)
  const input = useGuideInput(snapshot => snapshot)
  const navigation = useGuideNavigation(snapshot => snapshot)
  const ready = market.phase === 'ready' ? market : undefined
  const [open, setOpen] = useState(hero && !preferences.closed)
  const [welcome, setWelcome] = useState(true)
  const [notice, setNotice] = useState<string>()
  const [more, setMore] = useState(false)
  const [query, setQuery] = useState('')
  const [detailSlug, setDetailSlug] = useState<string>()
  const source = useRef<HTMLDivElement>(null)
  const detailAction = useRef<HTMLButtonElement>(null)
  const loginSource = useRef<{ slug: string; sessionId: typeof sessionId }>()
  const helper = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLElement>(null)
  const panelVisible = (open || notice !== undefined) && !more && detailSlug === undefined
  const panelPosition = useGuidePopover(panelVisible, helper, panel)
  const operation = useRef(0)
  const previousMode = useRef(preferences.mode)
  const bubbleId = useId()
  useEffect(() => { void ensureCatalog() }, [ensureCatalog])
  useEffect(() => {
    if (previousMode.current === preferences.mode) return
    previousMode.current = preferences.mode
    setWelcome(false)
    setNotice(undefined)
  }, [preferences.mode])
  useEffect(() => { if (!hero) { setOpen(false); setNotice(undefined) } }, [hero, sessionId])
  useEffect(() => {
    setNotice(undefined)
    setDetailSlug(undefined)
    setMore(false)
    return () => { ++operation.current }
  }, [sessionId, navigation])

  const openDetail = (slug: string): Promise<void> => {
    ++operation.current
    setNotice(undefined)
    setDetailSlug(slug)
    return loadDetail(slug)
  }
  const closeDetail = (): void => {
    ++operation.current
    loginSource.current = undefined
    setDetailSlug(undefined)
    clearDetail()
  }

  const close = (): void => {
    setOpen(false)
    setWelcome(false)
    setNotice(undefined)
    helper.current?.focus()
    void saveClosed(true).then((saved) => { if (!saved) setNotice(t('saveFailed')) })
  }
  useEffect(() => {
    if (!panelVisible) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.preventDefault(); close() }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  })

  const displayName = (skill: ManturMarketplaceSkill): string => {
    const alias = GUIDE_SKILL_LABELS.get(skill.slug)
    return alias === undefined ? skill.name : t(alias)
  }
  const insert = (skill: ManturMarketplaceSkill): void => {
    const label = displayName(skill)
    if (!appendReference({ source: 'skill', ref: skill.slug, label, clipboardText: `/${skill.slug}` })) {
      setNotice(t('insertFailed'))
      return
    }
    setNotice(t('selected').replace('{name}', label))
    setWelcome(false)
    setMore(false)
    closeDetail()
  }
  const installAndUse = async (skill: ManturMarketplaceSkill): Promise<void> => {
    setWelcome(false)
    const attempt = ++operation.current
    const origin = navigationVersion()
    const installed = await install(skill.slug)
    if (attempt !== operation.current || origin !== navigationVersion()) return
    if (installed) insert(skill)
    else setNotice(t('installFailed'))
  }
  const skills = ready?.catalog.skills ?? []
  const recommended = preferences.recommendations[preferences.mode].flatMap((slug) => {
    const skill = skills.find(item => item.slug === slug)
    return skill === undefined ? [] : [skill]
  })
  const missingAlias = recommended.some(skill => !GUIDE_SKILL_LABELS.has(skill.slug))
  const detail = detailSlug !== undefined && ready?.detail?.slug === detailSlug ? ready.detail : undefined
  useEffect(() => {
    if (ready?.loginPhase === 'starting' || loginSource.current === undefined) return
    const origin = loginSource.current
    loginSource.current = undefined
    if (origin.slug === detail?.slug && origin.sessionId === sessionId) focusDetailAction(source.current, detailAction.current)
  }, [ready?.loginPhase, detail?.slug, sessionId])
  const detailError = ready?.detailError
  const detailOpen = detailSlug !== undefined
  const intro = notice ?? t(`intro.${preferences.mode}`)
  const artwork = hero ? `mantoo-${preferences.mode}-peek` : 'mantoo-welcome'
  const matching = skills.filter(skill => `${skill.name} ${skill.description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))

  return <div ref={source} className={css.guide}>
    {panelVisible && <section ref={panel} className={css.bubble} id={bubbleId} aria-label={t('assistant')}
      style={panelPosition ?? { visibility: 'hidden' }}>
      <button type="button" className={css.close} onClick={close} aria-label={t('close')}>×</button>
      <div className={css.bubbleText} tabIndex={0}>
        {open && welcome && hero ? <><strong>{t('welcome.title')}</strong><p>{t('welcome.body')}</p></> : <p role={notice === undefined ? undefined : 'status'}>{intro}</p>}
      </div>
    </section>}
    <div className={css.shortcutRow} data-hero={hero}>
      {hero && <GuideSkillRail empty={recommended.length === 0} t={t}>
        {market.phase === 'idle' || market.phase === 'loading' ? <span role="status">{mt('skills.loading')}</span>
          : market.phase === 'failed' ? <><span role="alert">{mt('skills.failed')}</span><button type="button" onClick={() => { void load() }}>{mt('skills.retry')}</button></>
            : recommended.length === 0 ? <span className={css.empty}>{t('empty')}</span>
              : recommended.map((skill) => {
                const label = GUIDE_SKILL_LABELS.get(skill.slug)
                return label === undefined ? null : <button key={skill.slug} type="button" title={skill.name}
                  aria-pressed={input?.occurrences.some(item => item.source === 'skill' && item.ref === skill.slug) ?? false}
                  disabled={disabled || ready?.installing !== undefined}
                  onClick={() => { if (skill.installed) insert(skill); else void openDetail(skill.slug) }}
                >{t(label)}</button>
              })}
        {missingAlias && <span role="alert">{t('aliasMissing')}</span>}
        <button type="button" onClick={() => { setMore(true) }}>{t('more')}</button>
      </GuideSkillRail>}
      <button ref={helper} type="button" className={css.helper} aria-expanded={panelVisible} aria-controls={bubbleId}
        aria-label={t('assistant')} data-hero={hero}
        onClick={() => { if (panelVisible) close(); else { setWelcome(false); setOpen(true) } }}
      ><img src={`./${artwork}@3x.png`} srcSet={`./${artwork}@2x.png 2x, ./${artwork}@3x.png 3x`}
          width={hero ? 184 : 96} height={hero ? 120 : 96} alt="" draggable={false} /></button>
    </div>
    <Modal open={more && !detailOpen} onClose={() => { setMore(false) }} title={t('more')} closeLabel={t('close')}>
      <input className={css.search} aria-label={mt('skills.search')} placeholder={mt('skills.search')} value={query} onChange={(event) => { setQuery(event.target.value) }} />
      <div className={css.moreList}>
        {matching.map(skill =>
          <button key={skill.slug} type="button" disabled={disabled} onClick={() => { if (skill.installed) insert(skill); else void openDetail(skill.slug) }}>{skill.name}</button>)}
        {ready !== undefined && matching.length === 0 && <p>{mt('skills.noMatches')}</p>}
        {ready === undefined && <p>{mt(market.phase === 'failed' ? 'skills.failed' : 'skills.loading')}</p>}
        {market.phase === 'failed' && <button type="button" onClick={() => { void load() }}>{mt('skills.retry')}</button>}
      </div>
    </Modal>
    <Modal open={detailOpen && ready?.loginPhase !== 'starting'} onClose={closeDetail}
      title={detail === undefined ? mt('skills.loadingDetail') : displayName(detail)} closeLabel={t('close')}>
      {detailError !== undefined && <><p role="alert">{mt('skills.detailFailed')}</p><button type="button" onClick={() => { void openDetail(detailError) }}>{mt('skills.retry')}</button></>}
      {detail !== undefined && ready !== undefined && <div className={css.detail}>
        {!detail.installed && <p>{t('notInstalled')}</p>}
        {notice !== undefined && ready.installError === undefined && <p role="alert">{notice}</p>}
        {ready.installError !== undefined && <p role="alert">{t('installFailed')}{ready.installError === 'local-conflict' ? mt('skills.localConflict') : ''}</p>}
        {ready.loginPhase === 'failed' && <p role="alert">{mt('skills.loginFailed')}</p>}
        {ready.loginPhase === 'unavailable' && <p role="alert">{mt('skills.loginUnavailable')}</p>}
        {detail.installed || ready.catalog.signedIn
          ? <button ref={detailAction} type="button" disabled={disabled || ready.installing !== undefined}
            onClick={() => { if (detail.installed) insert(detail); else void installAndUse(detail) }}
          >{ready.installing !== undefined ? mt('skills.installing') : detail.installed ? t('use') : t('installAndUse')}</button>
          : <button ref={detailAction} type="button" disabled={ready.loginPhase === 'starting' || ready.loginPhase === 'authorizing'}
            onClick={() => { loginSource.current = { slug: detail.slug, sessionId }; void startLogin() }}>
            {mt(ready.loginPhase === 'starting' ? 'skills.loginPreparing' : 'skills.loginToInstall')}
          </button>}
        {ready.loginPhase === 'authorizing' && ready.login !== undefined && <>
          <p>{mt('skills.loginCode')} <strong>{ready.login.userCode}</strong></p>
          <a href={ready.login.verificationUrl} target="_blank" rel="noreferrer">{mt('skills.openLogin')}</a>
          <button type="button" onClick={() => { void cancelLogin() }}>{mt('skills.cancelLogin')}</button>
        </>}
      </div>}
    </Modal>
  </div>
}
