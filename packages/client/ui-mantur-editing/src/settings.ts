/** Validate the Host-provided editor address before embedding it. */

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
