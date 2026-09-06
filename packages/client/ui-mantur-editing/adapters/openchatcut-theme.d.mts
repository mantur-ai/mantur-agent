/** Browser operations used by the embedded editor theme adapter. */
interface ThemeWindow {
  parent: Pick<Window, 'postMessage'>
  document: Document
  location: Pick<Location, 'href'>
  addEventListener: Window['addEventListener']
  removeEventListener: Window['removeEventListener']
}
/**
 * Apply embedded theme tokens without changing editor data or standalone preferences.
 * @param target - Editor window.
 * @param parentOrigin - Exact trusted loopback HTTP origin.
 * @returns Listener and inline token disposer.
 */
export function installManturTheme(target: ThemeWindow, parentOrigin: string): () => void
