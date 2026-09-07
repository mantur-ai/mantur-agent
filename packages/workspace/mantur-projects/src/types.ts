/** Browser-safe automatic-project settings and preparation results. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type {} from '@deepseek-ai/dsh-typert-protocol'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The unassigned draft cannot use an automatic project yet. */
    'mantur-project/creation-failed': {
      readonly reason: 'root-unconfigured' | 'directory-conflict' | 'directory-invalid'
      readonly path?: string
    }
  }
}

/** One first-send identity, retained across incomplete creation attempts. */
export type ProjectCreationId = Branded<'ProjectCreationId'>

/** Resolved project root; no directory is created by reading settings. */
export type ProjectRootSettings =
  | { readonly source: 'unconfigured' }
  | { readonly source: 'desktop' | 'custom'; readonly rootPath: string }

/** Durable Workspace and deterministic Session identity for the ordinary create route. */
export interface PreparedProject {
  readonly workspaceId: WorkspaceId
  readonly sessionId: SessionId
  readonly path: string
}
