/** Deployment-owned initial and unscoped New Session workspace selection. */
import s from '@deepseek-ai/schemastery'

/** Settings namespace shared by the Host owner and its browser consumer. */
export const WORKSPACE_SETTINGS_NAMESPACE = 'ui-workspace'

/** Explicit selection leaves new conversations unassigned until the user chooses or sends. */
export interface Config {
  /** Whether an unscoped New Session inherits an existing Workspace. */
  newSessionWorkspace: 'recent' | 'explicit'
}

/** The standard Web profile retains current-or-recent Workspace selection. */
export const Config: s<Config> = s.object({
  newSessionWorkspace: s.union(['recent', 'explicit']).default('recent'),
})
