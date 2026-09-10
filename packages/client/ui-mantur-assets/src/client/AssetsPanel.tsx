/* oxlint-disable @stylistic/max-len -- this small panel keeps each guarded action visible. */
import { useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AssetCandidate, AssetMedia, AssetSnapshot, PromptEdit } from '../types.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

export interface AssetCommands {
  load: (session: SessionId, path: string) => Promise<AssetSnapshot>
  save: (session: SessionId, snapshot: AssetSnapshot, edits: PromptEdit[]) => Promise<AssetSnapshot>
  request: (session: SessionId, snapshot: AssetSnapshot, edits: PromptEdit[], instruction: string) => Promise<string>
  apply: (session: SessionId, requestId: string) => Promise<AssetSnapshot>
  candidates: (session: SessionId, directory: string) => Promise<AssetCandidate[]>
  preview: (session: SessionId, path: string) => Promise<AssetMedia>
}
type Props = PropsRuntime<'main.workbench.assets.content'> & PropsLocale<'assets.mantur'> & AssetCommands
/** @param props - Captured Session and production asset commands. @returns Asset report editor. */
export function AssetsPanel(props: Props) {
  const session = props.useSessions(state => state.current) as SessionId | undefined
  const [path, setPath] = useState('资产/资产提取结果/assets-report.json')
  const [candidateDirectory, setCandidateDirectory] = useState('资产/生成图片')
  const [snapshot, setSnapshot] = useState<AssetSnapshot>()
  const [candidates, setCandidates] = useState<AssetCandidate[]>([])
  const [previews, setPreviews] = useState<Record<string, AssetMedia>>({})
  const [previewPath, setPreviewPath] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [prompts, setPrompts] = useState<Record<string, string>>({}); const [instruction, setInstruction] = useState(''); const [requestId, setRequestId] = useState(''); const [error, setError] = useState('')
  const active = snapshot?.rows.find(row => row.key === selected[0])
  const preview = previews[previewPath]
  async function run(task: () => Promise<void>) { try { setError(''); await task() } catch (cause) { setError(cause instanceof Error ? cause.message : props.t('error')) } }
  function edits(): PromptEdit[] { return snapshot?.rows.filter(row => selected.includes(row.key)).map(row => ({ key: row.key, fingerprint: row.fingerprint, prompt: prompts[row.key] ?? row.prompt, negative: row.negative })) ?? [] }
  async function loadReport(): Promise<void> {
    if (!session) return
    setSnapshot(await props.load(session, path)); setCandidates([]); setPreviews({}); setPreviewPath('')
  }
  if (!session) return <p>{props.t('source')}</p>
  return <div><header><strong>{props.t('assets')}</strong><label>{props.t('source')}<input aria-label={props.t('source')} value={path} onChange={event => setPath(event.target.value)} /></label><button type="button" onClick={() => void run(loadReport)}>{props.t('load')}</button>{snapshot && <button type="button" onClick={() => void run(loadReport)}>{props.t('refresh')}</button>}<label>{props.t('candidateDirectory')}<input aria-label={props.t('candidateDirectory')} value={candidateDirectory} onChange={event => setCandidateDirectory(event.target.value)} /></label><button type="button" disabled={!snapshot} onClick={() => void run(async () => setCandidates(await props.candidates(session, candidateDirectory)))}>{props.t('scan')}</button></header>{error && <p role="alert">{error}</p>}{snapshot?.state.pending && <p role="status">{props.t('unfinished')} {snapshot.state.pending.proposal}</p>}{snapshot?.state.proposals.filter(proposal => proposal.status !== 'applied').map(proposal => <p key={proposal.id}>{props.t(proposal.status === 'requested' ? 'pending' : 'proposed')} {proposal.id}</p>)}{candidates.length > 0 && <section aria-label={props.t('candidates')}><h3>{props.t('candidates')}</h3>{candidates.map(candidate => <button type="button" key={candidate.path} onClick={() => void run(async () => { const media = await props.preview(session, candidate.path); setPreviews(current => ({ ...current, [candidate.path]: media })); setPreviewPath(candidate.path) })}>{candidate.name}{candidate.assetId ? ` (${candidate.assetId})` : ''}</button>)}</section>}{preview && <section aria-label={props.t('preview')}><h3>{preview.name}</h3>{preview.kind === 'image' ? <img src={preview.url} alt={preview.name} /> : <video src={preview.url} controls preload="metadata" />}</section>}<main><nav>{snapshot?.rows.map(row => <button type="button" key={row.key} aria-pressed={selected.includes(row.key)} onClick={() => { setSelected(current => current.includes(row.key) ? current.filter(key => key !== row.key) : [...current, row.key]); setPrompts(current => ({ ...current, [row.key]: current[row.key] ?? row.prompt })) }}>{row.id} {row.name}</button>)}</nav>{active && snapshot && <article><h3>{active.id} {active.name}</h3><p>{selected.length > 1 ? props.t('selected') : active.media ? props.t('actual') : props.t('noMedia')}</p><label>{props.t('prompt')}<textarea value={prompts[active.key] ?? active.prompt} onChange={event => setPrompts(current => ({ ...current, [active.key]: event.target.value }))} /></label><button type="button" onClick={() => void run(async () => setSnapshot(await props.save(session, snapshot, edits())))}>{props.t('save')}</button><label>{props.t('request')}<input value={instruction} onChange={event => setInstruction(event.target.value)} /></label><button type="button" onClick={() => void run(async () => { const id = await props.request(session, snapshot, edits(), instruction); setRequestId(id) })}>{props.t('request')}</button>{requestId && <button type="button" onClick={() => void run(async () => setSnapshot(await props.apply(session, requestId)))}>{props.t('apply')}</button>}</article>}</main></div>
}
