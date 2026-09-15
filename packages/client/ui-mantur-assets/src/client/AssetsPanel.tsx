/** Browse operator reports and preview their explicit media in the owning Session. */
import { useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AssetCandidate, AssetEntry, AssetProject, AssetMedia, AssetSnapshot, PromptEdit } from '../types.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { MediaPreview } from './MediaPreview.tsx'
import styles from './AssetsPanel.module.css'

/** Commands retain the selected report's source and journal generations. */
export interface AssetCommands {
  projects: (session: SessionId) => Promise<AssetProject[]>
  load: (session: SessionId, path: string, manifest?: string, references?: string) => Promise<AssetSnapshot>
  list: (session: SessionId, directory: string) => Promise<AssetEntry[]>
  save: (session: SessionId, snapshot: AssetSnapshot, edits: PromptEdit[]) => Promise<AssetSnapshot>
  request: (session: SessionId, snapshot: AssetSnapshot, edits: PromptEdit[], instruction: string) => Promise<string>
  apply: (session: SessionId, requestId: string) => Promise<AssetSnapshot>
  candidates: (session: SessionId, directory: string) => Promise<AssetCandidate[]>
  media: (session: SessionId, id: string) => Promise<AssetMedia>
  preview: (session: SessionId, path: string) => Promise<AssetMedia>
}
type Props = PropsRuntime<'main.workbench.assets.content'> & PropsLocale<'assets.mantur'> & AssetCommands
/** @param props - Session store and production commands. @returns Session-owned asset browser. */
export function AssetsPanel(props: Props) {
  const session = props.useSessions(state => state.current)
  return session ? <ReportPanel key={session} {...props} session={session} /> : <p>{props.t('chooseProject')}</p>
}
function ReportPanel(props: Props & { session: SessionId }) {
  const { session, t } = props
  const [mode, setMode] = useState<'assets' | 'clips'>('assets')
  const [projects, setProjects] = useState<AssetProject[]>([])
  const [project, setProject] = useState<AssetProject>()
  const [snapshot, setSnapshot] = useState<AssetSnapshot>()
  const [candidates, setCandidates] = useState<AssetCandidate[]>()
  const [candidate, setCandidate] = useState<AssetCandidate>()
  const [selected, setSelected] = useState<string[]>([])
  const [activeKey, setActiveKey] = useState('')
  const [prompts, setPrompts] = useState<Record<string, string>>({})
  const [dirty, setDirty] = useState(false)
  const [instruction, setInstruction] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(true)
  const [search, setSearch] = useState('')
  const [table, setTable] = useState('')
  const [episode, setEpisode] = useState('')
  const active = snapshot?.rows.find(row => row.key === activeKey)
  const rows = snapshot?.rows ?? []
  const tables = [...new Set(rows.map(row => row.table))]
  const episodes = [...new Set(rows.flatMap(row => row.details.filter(field => field.name === '集数').map(field => field.value)))]
  const visible = rows.filter(row => (!table || row.table === table)
    && (!episode || row.details.some(field => field.name === '集数' && field.value === episode))
    && `${row.id} ${row.name} ${row.prompt}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
  // A remounted Session owns its own completion state; controls serialize commands within a report.
  async function run(task: () => Promise<void>) {
    setBusy(true); setError('')
    try { await task() } catch (cause) { setError(cause instanceof Error ? cause.message : t('error')) }
    finally { setBusy(false) }
  }
  function reset() { setSnapshot(undefined); setSelected([]); setActiveKey(''); setPrompts({}); setCandidates(undefined); setCandidate(undefined); setTable(''); setEpisode(''); setSearch('') }
  function observe(value: AssetSnapshot) {
    setSnapshot(value)
    const saved: Record<string, string> = {}
    for (const draft of value.state.drafts) for (const edit of draft.edits) {
      if (value.rows.some(row => row.key === edit.key && row.fingerprint === edit.fingerprint)) saved[edit.key] = edit.prompt
    }
    setPrompts(saved)
  }
  async function readProject(value: AssetProject, nextMode = mode) {
    reset()
    const path = value[nextMode]
    if (path === null) return
    observe(await props.load(session, path,
      (nextMode === 'assets' ? value.imagesManifest : value.clipsManifest) ?? undefined,
      nextMode === 'assets' && value.imagesManifest === null ? value.clips ?? undefined : undefined))
  }
  useEffect(() => {
    const lifetime = new AbortController()
    void props.projects(session).then(async (values) => {
      if (lifetime.signal.aborted) return
      setProjects(values)
      const value = values[0]
      if (values.length === 1 && value !== undefined) {
        setProject(value)
        const path = value.assets
        if (path !== null) {
          await props.load(session, path, value.imagesManifest ?? undefined,
            value.imagesManifest === null ? value.clips ?? undefined : undefined).then((loaded) => {
            if (!lifetime.signal.aborted) observe(loaded)
          })
        }
      }
    }).catch((cause: unknown) => {
      if (!lifetime.signal.aborted) setError(cause instanceof Error ? cause.message : t('error'))
    }).finally(() => { if (!lifetime.signal.aborted) setBusy(false) })
    return () => { lifetime.abort() }
  }, [session, props.projects, props.load, t])
  async function refresh() {
    if (dirty) { setError(t('unsaved')); return }
    const values = await props.projects(session)
    setProjects(values)
    const current = project ? values.find(value => value.directory === project.directory) : values.length === 1 ? values[0] : undefined
    if (current) { setProject(current); await readProject(current) }
    else { setProject(undefined); reset() }
  }
  function edits(value: AssetSnapshot): PromptEdit[] {
    return value.rows.filter(row => selected.includes(row.key)).map(row => ({ key: row.key, fingerprint: row.fingerprint,
      prompt: prompts[row.key] ?? row.prompt, negative: row.negative }))
  }
  function select(key: string) {
    if (dirty && selected.includes(key)) { setError(t('unsaved')); return }
    setSelected(current => current.includes(key) ? current.filter(item => item !== key) : [...current, key])
  }
  return <section className={styles.root} aria-label={t('workbench')} aria-busy={busy}>
    <header className={styles.heading}><div><h2>{t('workbench')}</h2><p>{t('intro')}</p></div></header>
    <fieldset disabled={busy} className={styles.controls}>
      <div className={styles.toolbar}>
        <div role="tablist" aria-label={t('reports')} className={styles.tabs}>
          {(['assets', 'clips'] as const).map(value => <button type="button" role="tab" key={value}
            aria-selected={mode === value} onClick={() => {
              if (mode === value) return
              if (dirty) { setError(t('unsaved')); return }
              setMode(value)
              if (project) void run(() => readProject(project, value))
            }}>{t(value === 'assets' ? 'assetList' : 'clipList')}</button>)}
        </div>
        <button type="button" onClick={() => void run(refresh)}>{t('refresh')}</button>
      </div>
      {projects.length > 1 && <select aria-label={t('project')} value={project?.directory ?? ''} onChange={(event) => {
        if (dirty) { setError(t('unsaved')); return }
        const value = projects.find(item => item.directory === event.target.value)
        if (value) { setProject(value); void run(() => readProject(value)) }
      }}><option value="" disabled>{t('chooseProject')}</option>{projects.map(value => <option key={value.directory} value={value.directory}>{value.name}</option>)}</select>}
    </fieldset>
    {busy && <p role="status" className={styles.notice}>{t('loading')}</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {dirty && snapshot && <button type="button" onClick={() => { observe(snapshot); setDirty(false); setError('') }}>{t('discard')}</button>}
    {!snapshot && !busy && <div className={styles.empty}><h3>{t(projects.length > 1 && !project ? 'chooseProject' : 'emptyTitle')}</h3><p>{t(mode === 'assets' ? 'emptyAssets' : 'emptyClips')}</p></div>}
    {snapshot && <>
      {snapshot.state.pending && <p role="status" className={styles.error}>{t('unfinished')} {snapshot.state.pending.proposal}</p>}
      <div className={styles.filters}><input aria-label={t('search')} placeholder={t('search')} value={search} onChange={(event) =>{  setSearch(event.target.value) }} />
        <select aria-label={t('category')} value={table} onChange={(event) =>{  setTable(event.target.value) }}><option value="">{t('all')}</option>{tables.map(value => <option key={value}>{value}</option>)}</select>
        {episodes.length > 0 && <select aria-label={t('episode')} value={episode} onChange={(event) =>{  setEpisode(event.target.value) }}><option value="">{t('allEpisodes')}</option>{episodes.map(value => <option key={value}>{value}</option>)}</select>}
        <span>{visible.length} / {rows.length}</span>
      </div>
      <div className={styles.content} data-detail={Boolean(active)}>
        <nav className={styles.grid} aria-label={t('items')}>
          {visible.map(row => <div className={styles.card} key={row.key} data-active={activeKey === row.key}>
            <button className={styles.openCard} type="button" aria-label={`${row.id} ${row.name}`} aria-pressed={activeKey === row.key} disabled={busy} onClick={() =>{  setActiveKey(row.key) }}>
              <MediaPreview key={`${snapshot.source.sha256}:${row.key}`} path={row.localMedia || row.media} kind={row.kind} name={row.name || row.id} session={session} binding={row.localMedia ? row.id : ''} resolveBound={props.media} resolve={props.preview} t={t} thumbnail />
              <span className={styles.cardText}><strong>{row.name || row.id}</strong><small>{row.id}</small><small>{row.localMedia ? t('localSource') : row.table}</small>{row.kind === 'video' && <small>{row.details.filter(field => ['集数', '时长秒', '场次组'].includes(field.name)).map(field => `${field.name} ${field.value}`).join(' · ')}</small>}</span>
            </button><label className={styles.selection}><input type="checkbox" aria-label={`${t('select')} ${row.id}`} checked={selected.includes(row.key)} disabled={busy} onChange={() =>{  select(row.key) }} />{t('select')}</label>
          </div>)}
          {visible.length === 0 && <p className={styles.empty}>{t('noMatches')}</p>}
        </nav>
        {active ? <article className={styles.detail}>
          <header><button className={styles.closeDetail} type="button" onClick={() => { setActiveKey('') }}>{t('closeDetail')}</button><small>{active.id}{active.localMedia && ` · ${t('localSource')}`}</small><h3>{active.name || active.id}</h3></header>
          <MediaPreview key={`${snapshot.source.sha256}:${active.key}`} path={active.localMedia || active.media} kind={active.kind} name={active.name || active.id} session={session} binding={active.localMedia ? active.id : ''} resolveBound={props.media} resolve={props.preview} t={t} />
          <fieldset disabled={busy || snapshot.state.pending !== null} className={styles.editor}>
            <label>{t('prompt')}<textarea value={prompts[active.key] ?? active.prompt} onChange={(event) => { setPrompts({ ...prompts, [active.key]: event.target.value }); setDirty(true); setSelected(current => current.includes(active.key) ? current : [...current, active.key]) }} /></label>
            {active.negative && <details><summary>{t('negative')}</summary><p className={styles.text}>{active.negative}</p></details>}
            <p>{t('selected')} · {selected.length}</p><small className={styles.targets}>{rows.filter(row => selected.includes(row.key)).map(row => row.id).join(' · ')}</small>
            <button type="button" disabled={!selected.length} onClick={() => void run(async () => { setSnapshot(await props.save(session, snapshot, edits(snapshot))); setDirty(false) })}>{t('save')}</button>
            <label>{t('request')}<input value={instruction} onChange={(event) =>{  setInstruction(event.target.value) }} /></label>
            <button type="button" disabled={!selected.length || !instruction.trim()} onClick={() => void run(async () => {
              await props.request(session, snapshot, edits(snapshot), instruction)
              setDirty(false)
              if (project) await readProject(project)
            })}>{t('request')}</button>
          </fieldset>
          {active.actualPrompt && <details><summary>{t('actualPrompt')}</summary><p className={styles.text}>{active.actualPrompt}</p></details>}
          {active.template && <details><summary>{t('template')}</summary><pre>{active.template}</pre></details>}
          {active.actualRequest && <details><summary>{t('actualRequest')}</summary><pre>{active.actualRequest}</pre></details>}
          <details><summary>{t('metadata')}</summary><dl>{active.details.map(field => <div key={field.name}><dt>{field.name}</dt><dd>{field.value || '—'}</dd></div>)}</dl></details>
        </article> : null}
      </div>
      {snapshot.state.proposals.filter(proposal => proposal.status !== 'applied').map(proposal => <details key={proposal.id} className={styles.proposal}>
        <summary>{t(proposal.status === 'requested' ? 'pending' : 'proposed')} {proposal.id}</summary>
        <p>{proposal.instruction}</p>{proposal.edits.map(edit => <p className={styles.text} key={edit.key}>{edit.prompt}</p>)}
        {proposal.status === 'proposed' && <button type="button" disabled={busy} onClick={() => void run(async () => { observe(await props.apply(session, proposal.id)) })}>{t('apply')}</button>}
      </details>)}
      <details className={styles.files}><summary>{t('candidates')}</summary><p>{t('candidateHint')}</p>
        <button type="button" disabled={busy || !project} onClick={() => void run(async () => {
          if (project) setCandidates(await props.candidates(session, `${project.directory}/资产/生成图片`))
        })}>{t('scan')}</button>
        <div className={styles.fileList}>{candidates?.filter(value => value.issue === undefined).map(value => <button type="button" key={value.path} onClick={() =>{  setCandidate(value) }}>{value.name}</button>)}{candidates?.length === 0 && <p>{t('noFiles')}</p>}</div>
        {candidates?.some(value => value.issue !== undefined) && <section aria-label={t('unavailableFiles')}><h3>{t('unavailableFiles')}</h3>{candidates.filter(value => value.issue !== undefined).map(value => <p key={value.path}>{value.name} · {t(value.issue === 'too-large' ? 'oversized' : 'damaged')}</p>)}</section>}
        {candidate && <MediaPreview key={candidate.path} path={candidate.path} kind={candidate.kind} name={candidate.name} session={session} binding="" resolveBound={props.media} resolve={props.preview} t={t} />}
      </details>
    </>}
  </section>
}
