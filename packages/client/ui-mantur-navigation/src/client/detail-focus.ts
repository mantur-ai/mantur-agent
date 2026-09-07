/** Restore keyboard interaction only to a visible source detail with no competing modal. */

/**
 * Focus the remounted action without invoking it or crossing into a hidden page.
 * @param source - originating page or guide, outside the detail's portal.
 * @param button - current detail action, not the removed pre-login element.
 */
export function focusDetailAction(source: HTMLElement | null, button: HTMLButtonElement | null): void {
  if (source === null || button === null || !source.isConnected || !button.isConnected || button.disabled) return
  if (source.closest('[hidden], [inert]') !== null) return
  const dialog = button.closest('[role="dialog"][aria-modal="true"]')
  if (dialog === null || [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].some(other => other !== dialog)) return
  button.focus()
}
