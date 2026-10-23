/** Validate local skill workbench addresses without relaxing response security headers.
 * @param value - Explicit-port loopback address.
 * @returns Normalized local URL.
 */
export function webWorkbenchUrl(value: string): string {
  if (!/^http:\/\/127\.0\.0\.1:[0-9]+(?:[/?#]|$)/.test(value)) throw new Error('Expected an explicit-port HTTP workbench URL on 127.0.0.1')
  const url = new URL(value)
  if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:' || url.username || url.password || Number(url.port || 80) < 1) throw new Error('Invalid local workbench URL')
  return url.href
}
