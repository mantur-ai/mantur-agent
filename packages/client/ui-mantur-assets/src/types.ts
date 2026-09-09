/** Serializable observations and guarded commands for pipeline report editing. */

/** Opaque report row identity, including its owning table. */
export type AssetKey = string & { readonly __assetKey: unique symbol }
/** Opaque persisted proposal identity. */
export type ProposalId = string & { readonly __proposalId: unique symbol }
/** Filesystem generation observed by the Host. */
export type AssetVersion = import('@deepseek-ai/dsh-fs').FsVersion
/** Source generation pinned by all editing commands. */
export interface SourcePin { path: string; version: AssetVersion; sha256: string }
/** Editable fields; all other source columns remain untouched. */
export interface PromptText { prompt: string; negative: string }
/** A row observation never claims that a changed prompt generated existing media. */
export interface AssetRow extends PromptText {
  key: AssetKey
  id: string
  name: string
  table: string
  fingerprint: string
  kind: 'image' | 'video'
  media: string
  template: string
  actualRequest: string
  actualPrompt: string
}
/** Selected row and its exact observed fingerprint. */
export interface PromptEdit extends PromptText { key: AssetKey; fingerprint: string }
/** Every saved revision retains its source observation. */
export interface PromptDraft { revision: number; source: SourcePin; edits: PromptEdit[] }
/** Requests remain owned by the initiating main Session. */
export interface AssetProposal {
  id: ProposalId
  session: string
  source: SourcePin
  draftRevision: number
  instruction: string
  before: PromptEdit[]
  edits: PromptEdit[]
  status: 'requested' | 'proposed' | 'applied'
}
/** Completed source writes retain only selected fields for guarded restoration. */
export interface AssetHistory { id: ProposalId; before: PromptEdit[]; after: PromptEdit[]; beforeSha: string; afterSha: string }
/** Recovery journal is committed before the source replacement. */
export interface AssetPending { proposal: ProposalId; source: SourcePin; afterText: string; afterSha: string }
/** Version-one journal; original pipeline run state is a separate file. */
export interface AssetState {
  format: 1
  path: string
  drafts: PromptDraft[]
  proposals: AssetProposal[]
  history: AssetHistory[]
  pending: AssetPending | null
}
/** Consistent report and journal observation returned by the Host. */
export interface AssetSnapshot {
  source: SourcePin
  stateVersion: AssetVersion | null
  state: AssetState
  rows: AssetRow[]
  projectState: string | null
}
/** Batch commands address exactly one source report. */
export interface AssetCommand { source: SourcePin; stateVersion: AssetVersion | null; edits: PromptEdit[] }
/** Project-local discovery entry. */
export interface AssetEntry { path: string; name: string; directory: boolean }
/** Explicitly selected local media, optionally bound by a verified manifest. */
export interface AssetMedia { id: string | null; name: string; url: string; kind: 'image' | 'video' }
