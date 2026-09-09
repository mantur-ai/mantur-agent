import type { SessionId } from '@deepseek-ai/dsh-session'

/** Public result of opening the current Session's local editing runtime. */
export interface EditingWorkspace {
  /** Loopback editor URL; credentials remain on the Host. */
  editorUrl: string
  /** Canonical directory containing this Session's editing files. */
  directory: string
}

/** Identifies a successful editing-entry result for its Client event projection. */
export const EDITING_WORKSPACE_META_KIND = 'mantur-editing-workspace' as const

/** Credential-free presentation metadata recorded with a successful opening tool. */
export interface EditingWorkspaceMeta extends EditingWorkspace {
  /** Editing plugin discriminator; unrelated tool results cannot open this workbench. */
  kind: typeof EDITING_WORKSPACE_META_KIND
  /** Calling Session; never selected by model arguments. */
  sessionId: SessionId
}
