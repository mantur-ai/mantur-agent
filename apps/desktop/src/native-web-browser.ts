/** Isolated loopback workbench pages owned by the trusted desktop document. */
import { randomUUID } from 'node:crypto'
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent, Rectangle, WebContentsView, WebContentsViewConstructorOptions } from 'electron'
import { z } from 'zod'

const requestSchema = z.object({
  url: z.string(),
  bounds: z.object({ x: z.number().finite().nonnegative(), y: z.number().finite().nonnegative(),
    width: z.number().finite().positive(), height: z.number().finite().positive() }),
})

/**
 * Accept only explicit loopback HTTP authorities, without credentials or alternate host spellings.
 * @param value - URL received over IPC or from a navigation event.
 * @returns The parsed, allowed URL.
 */
export function parseNativeWebUrl(value: string): URL {
  if (!/^http:\/\/127\.0\.0\.1:[0-9]+(?:[/?#]|$)/u.test(value)) throw new Error('Only explicit loopback HTTP ports are supported')
  const url = new URL(value)
  if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:' || url.username || url.password || Number(url.port || '80') < 1) {
    throw new Error('Invalid workbench URL')
  }
  return url
}

/** Desktop-owned dependencies; the page receives no preload or application session. */
export interface NativeWebBrowserOptions {
  ipc: IpcMain
  window: () => BrowserWindow | undefined
  origin: () => string | undefined
  createView: (options: WebContentsViewConstructorOptions) => WebContentsView
}

/**
 * Install workbench show/hide IPC with CSS-pixel bounds. Navigation invalidation closes the page.
 * @param options - Trusted window and native view factory.
 * @returns Invalidation and resize operations for the owning window lifecycle.
 */
export function installNativeWebBrowser(options: NativeWebBrowserOptions): { invalidate: () => void; resize: () => void } {
  let current: { view: WebContentsView; window: BrowserWindow; url: string; bounds: Rectangle; loaded: Promise<void> } | undefined
  let generation = 0
  const authorize = (event: IpcMainInvokeEvent): BrowserWindow => {
    const window = options.window()
    const origin = options.origin()
    if (!window || !origin || window.isDestroyed() || window.webContents.isDestroyed()
      || event.sender !== window.webContents || !event.senderFrame || event.senderFrame !== window.webContents.mainFrame
      || new URL(event.senderFrame.url).origin !== origin) throw new Error('Web browser IPC is restricted to the desktop main frame')
    return window
  }
  const resize = (): void => {
    if (!current || current.window.isDestroyed() || current.view.webContents.isDestroyed()) return
    const { width, height } = current.window.getContentBounds()
    const zoom = current.window.webContents.getZoomFactor()
    const x = Math.min(Math.floor(current.bounds.x * zoom), width)
    const y = Math.min(Math.floor(current.bounds.y * zoom), height)
    current.view.setBounds({ x, y, width: Math.max(0, Math.min(Math.floor(current.bounds.width * zoom), width - x)),
      height: Math.max(0, Math.min(Math.floor(current.bounds.height * zoom), height - y)) })
  }
  const invalidate = (): void => {
    generation += 1
    const previous = current
    current = undefined
    if (!previous) return
    if (!previous.window.isDestroyed()) previous.window.contentView.removeChildView(previous.view)
    if (!previous.view.webContents.isDestroyed()) previous.view.webContents.close({ waitForBeforeUnload: false })
  }
  options.ipc.handle('mantur:web-browser:show', async (event, input: unknown): Promise<void> => {
    const window = authorize(event)
    const request = requestSchema.parse(input)
    const url = parseNativeWebUrl(request.url)
    if (url.origin === options.origin()) throw new Error('The application origin cannot be opened as a workbench')
    if (current?.url !== url.href || current.window !== window || current.view.webContents.isDestroyed()) {
      invalidate()
      const view = options.createView({ webPreferences: { partition: `mantur-workbench-${randomUUID()}`,
        sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false, navigateOnDragDrop: false } })
      view.setVisible(false)
      const page = view.webContents
      page.session.setPermissionCheckHandler(() => false)
      page.session.setPermissionRequestHandler((_contents, _permission, callback) => { callback(false) })
      page.session.on('will-download', (event) => { event.preventDefault() })
      page.setWindowOpenHandler(() => ({ action: 'deny' }))
      const preventForeignNavigation = (event: { url: string; preventDefault: () => void }): void => {
        try { if (parseNativeWebUrl(event.url).origin === url.origin) return } catch { /* Non-loopback navigation is denied. */ }
        event.preventDefault()
      }
      page.on('will-frame-navigate', preventForeignNavigation)
      page.on('will-redirect', preventForeignNavigation)
      window.contentView.addChildView(view)
      current = { view, window, url: url.href, bounds: request.bounds, loaded: page.loadURL(url.href) }
    }
    const selected = current
    const requestGeneration = generation
    selected.bounds = request.bounds
    resize()
    try {
      await selected.loaded
      if (generation !== requestGeneration || current !== selected) throw new Error('Workbench request was superseded')
      authorize(event)
      selected.view.setVisible(true)
    } catch (error) {
      if (current === selected && generation === requestGeneration) invalidate()
      throw error
    }
  })
  options.ipc.handle('mantur:web-browser:hide', async (event): Promise<void> => {
    authorize(event)
    generation += 1
    if (current && !current.view.webContents.isDestroyed()) current.view.setVisible(false)
  })
  return { invalidate, resize }
}
