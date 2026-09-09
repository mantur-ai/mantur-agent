/** Script and optional editing panels share one resident workbench. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ScriptEntry } from '../types.ts'
import type { ScriptCommands } from './index.ts'
import type { createWorkbenchStore } from './store.ts'
import css from './Workbench.module.css'

type Shared = PropsStore<ReturnType<typeof createWorkbenchStore>> & PropsLocale<'script.mantur'>
type WorkbenchProps = PropsRuntime<'main.workbench'> & Shared & ScriptCommands & PropsRenderSlots<'main.workbench.editing.tab' | 'main.workbench.editing.content'>

/** @param props - Current Session, shared view state, and file commands. @returns Resident workbench panels. */
export function Workbench(props: WorkbenchProps) {
  const session = props.useSessions(s => s.current)
  const active = props.useStore(s => s.views[session ?? '']) ?? 'script'
  const [editingMounted, setEditingMounted] = useState(false)
  useEffect(() => { if (active === 'editing') setEditingMounted(true) }, [active])
  return <section className={css.shell} aria-label={props.t('title')}>
    <header className={css.tabs}>
      <button type="button" aria-pressed={active === 'script'} onClick={() =>{  props.actions.select(session ?? '', 'script') }}>{props.t('script')}</button>
      {props.renderSlot('main.workbench.editing.tab', { selected: active === 'editing', selectEditing: () =>{  props.actions.select(session ?? '', 'editing') } })}
    </header>
    <div className={css.panel} hidden={active !== 'script'}><ScriptEditor {...props} session={session} /></div>
    {(active === 'editing' || editingMounted) && <div className={css.panel} hidden={active !== 'editing'}>
      {props.renderSlot('main.workbench.editing.content', { closeWorkbench: props.closeWorkbench }, { fallback: <p className={css.empty}>{props.t('editingUnavailable')}</p> })}
    </div>}
  </section>
}

/** @param props - Visibility and Session-indexed content selection. @returns Single boundary toggle and optional opening observer. */
export function WorkbenchToggle(props: PropsRuntime<'main.workbench.toggle'> & Shared & PropsRenderSlots<'main.workbench.toggle.editing'>) {
  const session = props.useSessions(s => s.current)
  const openEditing = useCallback(() => { props.actions.select(session ?? '', 'editing'); props.openWorkbench() }, [props.actions, props.openWorkbench, session])
  return <>
    {props.renderSlot('main.workbench.toggle.editing', {
      expanded: props.expanded,
      openWorkbench: openEditing,
      closeWorkbench: props.closeWorkbench,
    })}
    <button type="button" className={css.edgeToggle} aria-expanded={props.expanded} title={props.t(props.expanded ? 'collapse' : 'expand')}
      aria-label={props.t(props.expanded ? 'collapse' : 'expand')} onClick={props.expanded ? props.closeWorkbench : props.openWorkbench}>
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
        <path d={props.expanded ? 'm9 6 6 6-6 6' : 'm15 6-6 6 6 6'} />
      </svg>
    </button>
  </>
}

function ScriptEditor(props: WorkbenchProps & { session: SessionId | undefined }) {
  const { session, t, actions } = props
  const path = props.useStore(s => session === undefined ? undefined : s.paths[session])
  const draft = props.useStore(s => session === undefined || path === undefined ? undefined : s.drafts[session]?.[path])
  const [entries, setEntries] = useState<ScriptEntry[]>([])
  const [folder, setFolder] = useState('')
  const [reading, setReading] = useState(true)
  const [range, setRange] = useState({ start: 0, end: 0 })
  const [instruction, setInstruction] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string>()
  const navigation = useRef(0)
  const live = useRef(true)
  const running = props.useSessions(s => session !== undefined && s.byId[session]?.running === true)
  const previousRun = useRef(running)
  useEffect(() => {
    const ended = previousRun.current && !running
    previousRun.current = running
    if (!ended || session === undefined || path === undefined) return
    // An idle transition requests a file observation; it is not proof that any particular rewrite succeeded.
    void props.read(session, path).then((document) => { if (live.current) actions.observed(session, document) })
      .catch((error: unknown) => { if (live.current) setError(String(error)) })
  }, [running, session, path, props.read, actions])
  const dirty = draft !== undefined && draft.text !== draft.base.content
  useEffect(() => { live.current = true; return () => { live.current = false; navigation.current++ } }, [])
  useEffect(() => {
    if (session === undefined) return
    let active = true
    void props.list(session, '').then((value) => { if (active) setEntries(value) })
      .catch((error: unknown) => { if (active) setError(String(error)) })
    return () => { active = false }
  }, [session, props.list])
  useEffect(() => { setRange({ start: 0, end: 0 }) }, [path, draft?.base.version])
  useEffect(() => { setReading(true); setStatus(undefined) }, [path])

  async function run(operation: () => Promise<void>) {
    setBusy(true); setError(undefined)
    try { await operation() }
    catch (error) { if (live.current) setError(error instanceof Error ? error.message : String(error)) }
    finally { if (live.current) setBusy(false) }
  }
  async function browse(directory: string) {
    if (session === undefined) return
    const token = ++navigation.current
    await run(async () => {
      const value = await props.list(session, directory)
      if (token === navigation.current && live.current) { setEntries(value); setFolder(directory) }
    })
  }
  async function open(entry: ScriptEntry) {
    if (entry.directory) return browse(entry.path)
    if (session === undefined) return
    const token = ++navigation.current
    await run(async () => {
      const document = await props.read(session, entry.path)
      if (token === navigation.current && live.current) actions.open(session, document)
    })
  }
  async function save(text: string) {
    if (session === undefined || draft === undefined) return
    await run(async () => {
      const document = await props.save(session, draft.base, text)
      actions.saved(session, draft, document)
      if (live.current) setStatus(t('saved'))
    })
  }
  async function refresh() {
    if (session === undefined || path === undefined) return
    await run(async () => { actions.observed(session, await props.read(session, path)) })
  }
  async function send() {
    if (session === undefined || path === undefined || draft === undefined) return
    if (dirty) { setError(t('saveFirst')); return }
    const token = navigation.current
    await run(async () => {
      const current = await props.read(session, path)
      actions.observed(session, current)
      if (current.version !== draft.base.version) throw new Error(t('conflict'))
      if (!live.current || token !== navigation.current) return
      await props.send(session, {
        path, version: draft.base.version, ...range, selected: draft.text.slice(range.start, range.end),
      }, instruction)
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- The panel may unmount during admission.
      if (live.current) { setStatus(t('queued')); setInstruction('') }
    })
  }
  if (session === undefined) return <p className={css.empty}>{t('selectSession')}</p>
  return <div className={css.script}>
    <nav className={css.files} aria-label={t('files')}>
      <strong>{t('files')}</strong>
      <form onSubmit={(event) => { event.preventDefault(); void browse(folder) }}>
        <input aria-label={t('folder')} value={folder} onChange={(event) =>{  setFolder(event.target.value) }} />
        <button type="submit" disabled={busy}>{t('browse')}</button>
      </form>
      <button type="button" disabled={busy} onClick={() => { void browse('') }}>{t('root')}</button>
      {entries.map(entry => <button type="button" key={entry.path} title={entry.path} aria-current={entry.path === path ? 'page' : undefined}
        disabled={busy} onClick={() => { void open(entry) }}>{entry.directory ? '▸ ' : ''}{entry.name}</button>)}
      {entries.length === 0 && <p>{t('empty')}</p>}
    </nav>
    <main className={css.document}>
      {error !== undefined && <p className={css.notice} role="alert">{t('failed')}: {error}</p>}
      {draft === undefined ? <p className={css.empty}>{t('selectFile')}</p> : <>
        <header className={css.toolbar}>
          <strong title={draft.base.path}>{draft.base.path.split(/[\\/]/).at(-1)}</strong>
          <span>{t(dirty ? 'dirty' : 'saved')}</span>
          <button type="button" aria-pressed={reading} onClick={() =>{  setReading(true) }}>{t('reading')}</button>
          <button type="button" aria-pressed={!reading} onClick={() =>{  setReading(false) }}>{t('source')}</button>
          <button type="button" disabled={busy || !dirty || draft.conflict !== undefined} onClick={() => { void save(draft.text) }}>{t('save')}</button>
          <button type="button" disabled={busy} onClick={() => { void refresh() }}>{t('refresh')}</button>
        </header>
        {draft.conflict !== undefined && <details className={css.notice} open>
          <summary>{t('conflict')}</summary><h3>{t('disk')}</h3><pre>{draft.conflict.content}</pre>
          <button type="button" disabled={busy} onClick={() =>{  actions.useDisk(session, draft.base.path) }}>{t('useDisk')}</button>
        </details>}
        {reading ? <article className={css.reading}>
          {/\.md$/i.test(draft.base.path) ? <MarkdownText text={draft.text} labels={{ code: { copyLabel: t('copy'), copiedLabel: t('copied') }, footnotes: t('footnotes') }} /> : <pre>{draft.text}</pre>}
          <p className={css.hint}>{t('sourceHelp')}</p>
        </article> : <textarea className={css.source} aria-label={t('source')} value={draft.text} spellCheck={false}
          onChange={(event) => { actions.edit(session, draft.base.path, event.target.value); setRange({ start: 0, end: 0 }) }}
          onSelect={(event) =>{  setRange({ start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd }) }} />}
        {draft.previous !== undefined && <details className={css.diff}>
          <summary>{t('diff')}</summary>
          <div className={css.compare}><section><h3>{t('previous')}</h3><pre>{draft.previous.content}</pre></section><section><h3>{t('current')}</h3><pre>{draft.base.content}</pre></section></div>
          <button type="button" disabled={busy || dirty || draft.conflict !== undefined} onClick={() => { if (draft.previous !== undefined) void save(draft.previous.content) }}>{t('undo')}</button>
        </details>}
        {!reading && range.end > range.start && <form className={css.rewrite} onSubmit={(event) => { event.preventDefault(); void send() }}>
          <details><summary>{t('selection')}</summary><blockquote>{draft.text.slice(range.start, range.end)}</blockquote></details>
          <label>{t('instruction')}<textarea value={instruction} onChange={(event) =>{  setInstruction(event.target.value) }} /></label>
          <button type="submit" disabled={busy || dirty || !instruction.trim() || draft.conflict !== undefined}>{t('send')}</button>
        </form>}
        {status !== undefined && <p className={css.status} role="status">{status}</p>}
      </>}
    </main>
  </div>
}
