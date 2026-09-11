/** Mode navigation and contextual guidance beside the resident composer. */

import { useEffect, useId, useRef, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ManturBundledSkill } from '@deepseek-ai/dsh-manturhub-marketplace/types'
import type { ObservableSnapshot, SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InputState, ReferenceInsert } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { CREATION_MODES, type CreationMode, type GuideSettings } from '../guide-settings.ts'
import type { BundledSkillsState } from './bundled-skills.ts'
import { GUIDE_SKILL_LABELS } from './guide-locales.ts'
import { useGuidePopover } from './useGuidePopover.ts'
import css from './CreationGuide.module.css'
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

/** Render the three UI-only modes with roving keyboard focus. */
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
  appendReference: (reference: ReferenceInsert) => boolean
  loadBundled: () => Promise<void>
  marketplaceText: (key: 'skills.loading' | 'skills.failed' | 'skills.retry') => string
  hooks: GuidePreferencesInjected['hooks'] & {
    bundledSkills: SnapshotStore<BundledSkillsState>
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
  if (!props.hero || preferences.value === undefined) return null
  return <ReadyGuide {...props} preferences={preferences.value} />
}

function ReadyGuide({ hero, disabled, sessionId, preferences, useGuideInput, useBundledSkills,
  useGuideNavigation, appendReference, saveClosed, loadBundled, marketplaceText: mt, t,
}: CreationGuideProps & { preferences: GuideSettings }) {
  const bundled = useBundledSkills(snapshot => snapshot)
  const input = useGuideInput(snapshot => snapshot)
  const navigation = useGuideNavigation(snapshot => snapshot)
  const [open, setOpen] = useState(hero && !preferences.closed)
  const [welcome, setWelcome] = useState(true)
  const [notice, setNotice] = useState<string>()
  const source = useRef<HTMLDivElement>(null)
  const helper = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLElement>(null)
  const panelVisible = open || notice !== undefined
  const panelPosition = useGuidePopover(panelVisible, helper, panel)
  const previousMode = useRef(preferences.mode)
  const bubbleId = useId()
  useEffect(() => {
    if (previousMode.current === preferences.mode) return
    previousMode.current = preferences.mode
    setWelcome(false)
    setNotice(undefined)
  }, [preferences.mode])
  useEffect(() => { if (!hero) { setOpen(false); setNotice(undefined) } }, [hero, sessionId])
  useEffect(() => {
    setNotice(undefined)
  }, [sessionId, navigation])

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

  const recommended = preferences.recommendations[preferences.mode].flatMap((slug) => {
    const skill = bundled.phase === 'ready' ? bundled.skills.find(item => item.name === slug) : undefined
    return skill === undefined ? [] : [skill]
  })
  const missingAlias = recommended.some(skill => !GUIDE_SKILL_LABELS.has(skill.name))
  const insertBundled = (skill: ManturBundledSkill): void => {
    const alias = GUIDE_SKILL_LABELS.get(skill.name)
    if (alias === undefined) { setNotice(t('aliasMissing')); return }
    const label = t(alias)
    if (!appendReference({ source: 'mantur-bundled-skill', ref: skill.reference, label,
      clipboardText: `/mantur-builtin:${skill.reference}` })) {
      setNotice(t('insertFailed'))
      return
    }
    setNotice(t('selected').replace('{name}', label))
    setWelcome(false)
  }
  const intro = notice ?? t(`intro.${preferences.mode}`)
  const artwork = hero ? `mantoo-${preferences.mode}-peek` : 'mantoo-welcome'

  return <div ref={source} className={css.guide}>
    {panelVisible && <section ref={panel} className={css.bubble} id={bubbleId} aria-label={t('assistant')}
      style={panelPosition ?? { visibility: 'hidden' }}>
      <button type="button" className={css.close} onClick={close} aria-label={t('close')}>×</button>
      <div className={css.bubbleText} tabIndex={0} onKeyDown={(event) => {
        if (event.target !== event.currentTarget || (event.key !== 'Home' && event.key !== 'End')) return
        event.preventDefault()
        event.currentTarget.scrollTop = event.key === 'Home' ? 0 : event.currentTarget.scrollHeight
      }}>
        {open && welcome && hero ? <><strong>{t('welcome.title')}</strong><p>{t('welcome.body')}</p></> : <p role={notice === undefined ? undefined : 'status'}>{intro}</p>}
      </div>
    </section>}
    <div className={css.shortcutRow} data-hero={hero}>
      {hero && <GuideSkillRail empty={recommended.length === 0} t={t}>
        {bundled.phase === 'idle' || bundled.phase === 'loading' ? <span role="status">{mt('skills.loading')}</span>
          : bundled.phase === 'failed' ? <><span role="alert">{mt('skills.failed')}</span><button type="button" onClick={() => { void loadBundled() }}>{mt('skills.retry')}</button></>
            : recommended.length === 0 ? <span className={css.empty}>{t('empty')}</span>
              : recommended.map((skill) => {
                const label = GUIDE_SKILL_LABELS.get(skill.name)
                return label === undefined ? null : <button key={skill.reference} type="button" title={skill.title}
                  aria-pressed={input?.occurrences.some(item => item.source === 'mantur-bundled-skill' && item.ref === skill.reference) ?? false}
                  disabled={disabled}
                  onClick={() => { insertBundled(skill) }}
                >{t(label)}</button>
              })}
        {missingAlias && <span role="alert">{t('aliasMissing')}</span>}
      </GuideSkillRail>}
      <button ref={helper} type="button" className={css.helper} aria-expanded={panelVisible} aria-controls={bubbleId}
        aria-label={t('assistant')} data-hero={hero}
        onClick={() => { if (panelVisible) close(); else { setWelcome(false); setOpen(true) } }}
      ><img src={`./${artwork}@3x.png`} srcSet={`./${artwork}@2x.png 2x, ./${artwork}@3x.png 3x`}
          width={hero ? 184 : 96} height={hero ? 120 : 96} alt="" draggable={false} /></button>
    </div>
  </div>
}
