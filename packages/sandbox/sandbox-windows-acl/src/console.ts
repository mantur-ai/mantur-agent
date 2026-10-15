/** Console preparation for GUI-launched runners before restricted-token creation. */
import { STD_INPUT_HANDLE, STD_OUTPUT_HANDLE, STD_ERROR_HANDLE } from '@deepseek-ai/dsh-win32-process'
import { isNullPtr, throwLastError } from './ffi.ts'
import type { Win32Bindings } from './ffi.ts'

/**
 * Give a console-less runner a hidden console its restricted child can inherit.
 * Existing consoles are untouched; inherited pipes survive AllocConsole's standard-handle reset.
 * The runner owns the new console until process exit. Failures abort before confinement.
 * @param api - Windows console and standard-handle operations.
 */
export function ensureRunnerConsole(api: Win32Bindings): void {
  if (api.getConsoleCP() !== 0) return
  const handles = [STD_INPUT_HANDLE, STD_OUTPUT_HANDLE, STD_ERROR_HANDLE]
    .map(selector => ({ selector, handle: api.getStdHandle(selector) }))
  if (api.allocConsole() === 0) throwLastError(api, 'AllocConsole', 'sandbox runner console')
  const window = api.getConsoleWindow()
  if (!isNullPtr(window)) api.showWindow(window, 0)
  for (const { selector, handle } of handles) {
    if (api.setStdHandle(selector, handle) === 0) {
      throwLastError(api, 'SetStdHandle', 'restore runner redirected standard handles')
    }
  }
}
