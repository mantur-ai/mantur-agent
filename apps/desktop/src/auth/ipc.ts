/** Frame-bound native account operations; renderer input cannot select a URL, secret store, command or IPC channel. */
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import type { NativeAccountAction, NativeAccountReply } from '@deepseek-ai/dsh-authorization-manturhub/types'
import { NativeAccountController, NativeAccountFailure } from './controller.ts'
import { NativeHttpFailure } from './http.ts'

const action = z.strictObject({
  kind: z.enum(['snapshot', 'refresh', 'browser', 'reopen-browser', 'skip', 'sign-out', 'switch-account', 'retry-revocations']),
}) satisfies z.ZodType<NativeAccountAction>

/** Electron Main owns both the active controller and the currently trusted local frame. */
export interface NativeAccountBridgeOptions {
  readonly ipc: IpcMain
  readonly window: () => BrowserWindow | undefined
  readonly origin: () => string | undefined
  readonly controller: () => NativeAccountController | undefined
}

/**
 * Install the narrow account command channel after Main creates its profile owner.
 * @param options - Main-owned controller, local frame and IPC registration.
 * @returns publication and disposal operations; disposal removes the command channel before closing its controller elsewhere.
 */
export function installNativeAccountBridge(options: NativeAccountBridgeOptions): { publish: () => void; dispose: () => void } {
  let revision = 0
  let disposed = false
  const localWindow = (): BrowserWindow | undefined => {
    const window = options.window()
    const origin = options.origin()
    if (disposed || window === undefined || origin === undefined
      || window.isDestroyed() || window.webContents.isDestroyed()) return undefined
    let actual: string
    try { actual = new URL(window.webContents.mainFrame.url).origin } catch { return undefined }
    return actual === origin ? window : undefined
  }
  const authorize = (event: IpcMainInvokeEvent): void => {
    const window = localWindow()
    if (window === undefined || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
      throw new Error('Native account IPC is restricted to the current local main frame')
    }
  }
  const invoke = async (event: IpcMainInvokeEvent, input: unknown): Promise<NativeAccountReply> => {
    authorize(event)
    const parsed = action.safeParse(input)
    if (!parsed.success) return { ok: false, revision, failure: { kind: 'invalid-request' } }
    const controller = options.controller()
    if (controller === undefined) return { ok: false, revision, failure: { kind: 'unavailable' } }
    let failure: NativeAccountReply['failure']
    const request = parsed.data
    try {
      switch (request.kind) {
        case 'snapshot': break
        case 'refresh': await controller.refresh(); break
        case 'browser': await controller.startBrowser(); break
        case 'reopen-browser': await controller.reopenBrowser(); break
        case 'skip': await controller.skip(); break
        case 'sign-out': await controller.signOut(); break
        case 'switch-account': await controller.switchAccount(); break
        case 'retry-revocations': await controller.retryRevocations(); break
        default: assertNever(request.kind)
      }
    } catch (error) {
      failure = error instanceof NativeHttpFailure
        ? { kind: error.kind, ...(error.code === undefined ? {} : { code: error.code }),
          ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }) }
        : { kind: error instanceof NativeAccountFailure ? error.kind : 'local' }
    }
    authorize(event)
    if (controller !== options.controller()) return { ok: false, revision, failure: { kind: 'unavailable' } }
    return { ok: failure === undefined, revision, snapshot: controller.getSnapshot(),
      ...(failure === undefined ? {} : { failure }) }
  }
  options.ipc.handle('mantur:account:invoke', invoke)
  return {
    publish: () => {
      revision++
      const window = localWindow()
      const controller = options.controller()
      if (window === undefined || controller === undefined) return
      window.webContents.send('mantur:account:changed', { revision, snapshot: controller.getSnapshot() })
    },
    dispose: () => {
      disposed = true
      options.ipc.removeHandler('mantur:account:invoke')
    },
  }
}
