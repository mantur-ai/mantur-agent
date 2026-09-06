/** Local editor address shared by the host configuration and workbench view. */
import z from '@deepseek-ai/schemastery'

/** Configured address; never contains the host-only MCP bearer token. */
export interface EditingSettings {
  /** Absolute loopback HTTP address of the running OpenChatCut editor. */
  editorUrl: string
}

/**
 * Reject external origins and credentials before creating an embedded editor.
 * @param value - configured editor address.
 * @returns normalized loopback address.
 */
export function localEditorUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.search) {
    throw new Error('Editing workbench requires a loopback HTTP URL without credentials or query parameters')
  }
  return url.href
}

/** Durable configuration schema; the profile supplies the editor address. */
export const EditingSettingsSchema: z<EditingSettings> = z.object({ editorUrl: z.string().required() })
