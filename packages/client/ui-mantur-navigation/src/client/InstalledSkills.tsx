/** Local skill management, available independently of marketplace requests. */
import { useEffect, useState } from 'react'
import { IconChevronLeftOutline14, IconSearchOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ManturInstalledSkill } from '@deepseek-ai/dsh-manturhub-marketplace/types'
import type { MarketplacePageProps } from './MarketplaceNavigation.tsx'
import type { ManturMarketplaceStore } from './store.ts'
import css from './MarketplaceNavigation.module.css'

/** Render installed skills with persistent invocation switches. */
export function InstalledSkills({ controller, close, t }: {
  readonly controller: ManturMarketplaceStore
  readonly close: () => void
  readonly t: MarketplacePageProps['t']
}) {
  const [skills, setSkills] = useState<ManturInstalledSkill[]>()
  const [query, setQuery] = useState('')
  const [pending, setPending] = useState<string>()
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    setFailed(false)
    void controller.installedSkills().then(
      (result) => { if (active) setSkills(result) },
      () => { if (active) setFailed(true) },
    )
    return () => { active = false }
  }, [controller, retry])
  const toggle = async (skill: ManturInstalledSkill): Promise<void> => {
    setPending(skill.name)
    setFailed(false)
    try {
      await controller.setSkillEnabled(skill.name, !skill.enabled)
      setSkills(await controller.installedSkills())
    } catch {
      setFailed(true)
    } finally {
      setPending(undefined)
    }
  }
  const needle = query.trim().toLocaleLowerCase()
  const visible = skills?.filter(skill => [skill.name, skill.title, skill.description]
    .some(value => value.toLocaleLowerCase().includes(needle))) ?? []
  return <main className={css.page} aria-labelledby="mantur-installed-title">
    <header className={css.pageHeader}>
      <button type="button" className={css.back} onClick={close}>
        <IconChevronLeftOutline14 /><span>{t('skills.title')}</span>
      </button>
    </header>
    <section className={css.catalogBody}>
      <div className={css.catalogHeading}><div>
        <h1 id="mantur-installed-title">{t('skills.manageInstalled')}{skills !== undefined && ` (${skills.length})`}</h1>
        <p>{t('skills.switchHelp')}</p>
      </div></div>
      <label className={css.search}><IconSearchOutline16 />
        <input value={query} onChange={(event) => { setQuery(event.target.value) }} placeholder={t('skills.searchInstalled')} aria-label={t('skills.searchInstalled')} />
      </label>
      {failed && <div className={css.installError} role="alert">
        <p>{t('skills.manageFailed')}</p>
        <button type="button" onClick={() => { setRetry(value => value + 1) }}>{t('skills.retry')}</button>
      </div>}
      {skills === undefined && !failed && <p role="status">{t('skills.loadingInstalled')}</p>}
      {skills !== undefined && visible.length === 0 && <p>{t('skills.noMatches')}</p>}
      {(['local', 'bundled'] as const).map((source) => {
        const group = visible.filter(skill => skill.source === source)
        if (group.length === 0) return null
        return <section key={source} className={css.installedGroup}>
          <h2>{t(source === 'local' ? 'skills.localGroup' : 'skills.bundledGroup')} ({group.length})</h2>
          <div className={css.skillGrid}>{group.map(skill => <article key={skill.name} className={css.installedCard}>
            <span className={css.skillIcon} aria-hidden="true">{skill.title.slice(0, 1)}</span>
            <span className={css.skillCopy}>
              <strong title={skill.title}>{skill.title}</strong><span>{skill.description || skill.name}</span>
            </span>
            <button type="button" role="switch" aria-checked={skill.enabled}
              aria-label={t('skills.switchNamed').replace('{name}', skill.title)}
              className={css.skillSwitch} disabled={pending !== undefined}
              onClick={() => { void toggle(skill) }}><span /></button>
          </article>)}</div>
        </section>
      })}
    </section>
  </main>
}
