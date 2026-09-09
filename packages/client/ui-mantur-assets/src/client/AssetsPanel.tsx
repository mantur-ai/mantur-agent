/* oxlint-disable @stylistic/max-len -- this small panel keeps each guarded action visible. */
import { useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AssetSnapshot, PromptEdit } from '../types.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

export interface AssetCommands {
  load: (session: SessionId, path: string) => Promise<AssetSnapshot>
  save: (session: SessionId, snapshot: AssetSnapshot, edits: PromptEdit[]) => Promise<AssetSnapshot>
  request: (session: SessionId, snapshot: AssetSnapshot, edits: PromptEdit[], instruction: string) => Promise<string>
  apply: (session: SessionId, requestId: string) => Promise<AssetSnapshot>
}
type Props = PropsRuntime<'main.workbench.assets.content'> & PropsLocale<'assets.mantur'> & AssetCommands
/** @param props - Captured Session and production asset commands. @returns Asset report editor. */
export function AssetsPanel(props: Props) {
  const session = props.useSessions(state => state.current) as SessionId | undefined
  const [path, setPath] = useState('资产/资产提取结果/assets-report.json')
  const [snapshot, setSnapshot] = useState<AssetSnapshot>()
  const [selected, setSelected] = useState<string>()
  const [prompt, setPrompt] = useState(''); const [instruction, setInstruction] = useState(''); const [requestId, setRequestId] = useState(''); const [error, setError] = useState('')
  const active = snapshot?.rows.find(row => row.key === selected)
  async function run(task: () => Promise<void>) { try { setError(''); await task() } catch (cause) { setError(cause instanceof Error ? cause.message : props.t('error')) } }
  function edits(): PromptEdit[] { if (!active) return []; return [{ key: active.key, fingerprint: active.fingerprint, prompt, negative: active.negative }] }
  if (!session) return <p>{props.t('source')}</p>
  return <div><header><strong>{props.t('assets')}</strong><input aria-label={props.t('source')} value={path} onChange={event => setPath(event.target.value)} /><button type="button" onClick={() => void run(async () => setSnapshot(await props.load(session, path)))}>{props.t('load')}</button>{snapshot && <button type="button" onClick={() => void run(async () => setSnapshot(await props.load(session, path)))}>{props.t('refresh')}</button>}</header>{error && <p role="alert">{error}</p>}<main><nav>{snapshot?.rows.map(row => <button type="button" key={row.key} aria-pressed={selected === row.key} onClick={() => { setSelected(row.key); setPrompt(row.prompt) }}>{row.id} {row.name}</button>)}</nav>{active && snapshot && <article><h3>{active.id} {active.name}</h3><p>{active.media ? props.t('actual') : props.t('noMedia')}</p><label>{props.t('prompt')}<textarea value={prompt} onChange={event => setPrompt(event.target.value)} /></label><button type="button" onClick={() => void run(async () => setSnapshot(await props.save(session, snapshot, edits())))}>{props.t('save')}</button><label>{props.t('request')}<input value={instruction} onChange={event => setInstruction(event.target.value)} /></label><button type="button" onClick={() => void run(async () => { const id = await props.request(session, snapshot, edits(), instruction); setRequestId(id) })}>{props.t('request')}</button>{requestId && <button type="button" onClick={() => void run(async () => setSnapshot(await props.apply(session, requestId)))}>{props.t('apply')}</button>}</article>}</main></div>
}
