/** Workbench pages cannot use application IPC or outlive their owner document. */
import { EventEmitter } from 'node:events'
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent, WebContentsView } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { installNativeWebBrowser, parseNativeWebUrl } from '../src/native-web-browser.ts'

function fixture() {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, request?: unknown) => Promise<void>>()
  const frame = { url: 'http://127.0.0.1:40001/' }
  const window = { isDestroyed: vi.fn(() => false),
    webContents: { mainFrame: frame, getZoomFactor: vi.fn(() => 1), isDestroyed: vi.fn(() => false) },
    getContentBounds: vi.fn(() => ({ width: 800, height: 600 })), contentView: { addChildView: vi.fn(), removeChildView: vi.fn() } }
  const event = { sender: window.webContents, senderFrame: frame } as unknown as IpcMainInvokeEvent
  const page = Object.assign(new EventEmitter(), { isDestroyed: vi.fn(() => false), close: vi.fn(),
    loadURL: vi.fn(async (_url: string) => {}), setWindowOpenHandler: vi.fn(),
    session: Object.assign(new EventEmitter(), { setPermissionCheckHandler: vi.fn(), setPermissionRequestHandler: vi.fn() }) })
  const view = { webContents: page, setVisible: vi.fn(), setBounds: vi.fn() }
  const createView = vi.fn(() => view as unknown as WebContentsView)
  const bridge = installNativeWebBrowser({
    ipc: { handle: (name: string, handler: (event: IpcMainInvokeEvent, request?: unknown) => Promise<void>) => {
      handlers.set(name, handler)
    } } as unknown as IpcMain,
    window: () => window as unknown as BrowserWindow, origin: () => 'http://127.0.0.1:40001', createView,
  })
  const request = { url: 'http://127.0.0.1:40002/dashboard', bounds: { x: 500, y: 100, width: 900, height: 900 } }
  return { bridge, event, frame, window, page, view, createView, request,
    show: (input: unknown = request, source = event) => handlers.get('mantur:web-browser:show')!(source, input),
    hide: (source = event) => handlers.get('mantur:web-browser:hide')!(source) }
}

describe('native workbench browser', () => {
  it.each(['https://127.0.0.1:40002/', 'http://localhost:40002/', 'http://127.0.0.1/',
    'http://user@127.0.0.1:40002/', 'http://127.0.0.1:0/', 'http://127.0.0.1:65536/',
    'file:///tmp/page.html', 'http://127.1:40002/', 'http://127.0.0.1:40002@evil.test/'])('rejects URL %s', (value) => {
    expect(() => parseNativeWebUrl(value)).toThrow()
  })

  it('creates a sandboxed page with an isolated session and clips bounds on show and resize', async () => {
    const subject = fixture()
    await subject.show()
    expect(subject.createView).toHaveBeenCalledWith({ webPreferences: {
      partition: expect.stringMatching(/^mantur-workbench-/u), sandbox: true, contextIsolation: true,
      nodeIntegration: false, webviewTag: false, navigateOnDragDrop: false,
    } })
    expect(subject.view.setBounds).toHaveBeenLastCalledWith({ x: 500, y: 100, width: 300, height: 500 })
    expect(subject.view.setVisible).toHaveBeenLastCalledWith(true)
    subject.window.getContentBounds.mockReturnValue({ width: 400, height: 300 })
    subject.bridge.resize()
    expect(subject.view.setBounds).toHaveBeenLastCalledWith({ x: 400, y: 100, width: 0, height: 200 })
    await subject.hide()
    expect(subject.view.setVisible).toHaveBeenLastCalledWith(false)
    await subject.show()
    expect(subject.page.loadURL).toHaveBeenCalledOnce()
  })

  it('converts CSS bounds to native coordinates using the main renderer zoom', async () => {
    const subject = fixture()
    subject.window.webContents.getZoomFactor.mockReturnValue(1.5)
    await subject.show({ ...subject.request, bounds: { x: 100, y: 80, width: 400, height: 300 } })
    expect(subject.view.setBounds).toHaveBeenLastCalledWith({ x: 150, y: 120, width: 600, height: 450 })
  })

  it('rejects foreign IPC, subframes, missing frames, changed origins and the application URL', async () => {
    const subject = fixture()
    for (const event of [{ ...subject.event, sender: {} }, { ...subject.event, senderFrame: null },
      { ...subject.event, senderFrame: { ...subject.frame } }]) {
      await expect(subject.show(undefined, event as IpcMainInvokeEvent)).rejects.toThrow('main frame')
      await expect(subject.hide(event as IpcMainInvokeEvent)).rejects.toThrow('main frame')
    }
    await expect(subject.show({ ...subject.request, url: subject.frame.url })).rejects.toThrow('application origin')
    subject.frame.url = 'https://external.test/'
    await expect(subject.show()).rejects.toThrow('main frame')
    expect(subject.createView).not.toHaveBeenCalled()
  })

  it.each([{ x: -1, y: 0, width: 10, height: 10 }, { x: 1, y: 0, width: Infinity, height: 10 },
    { x: 1, y: 0, width: 10, height: 0 }])('rejects invalid rectangle %j', async (bounds) => {
    const subject = fixture()
    await expect(subject.show({ ...subject.request, bounds })).rejects.toThrow()
    expect(subject.createView).not.toHaveBeenCalled()
  })

  it('denies permissions, downloads, popup windows and foreign navigation including redirects', async () => {
    const subject = fixture()
    await subject.show()
    expect(subject.page.session.setPermissionCheckHandler.mock.calls[0]![0]()).toBe(false)
    const callback = vi.fn()
    subject.page.session.setPermissionRequestHandler.mock.calls[0]![0](subject.page, 'media', callback)
    expect(callback).toHaveBeenCalledWith(false)
    expect(subject.page.setWindowOpenHandler.mock.calls[0]![0]()).toEqual({ action: 'deny' })
    for (const eventName of ['will-frame-navigate', 'will-redirect']) {
      for (const url of ['https://evil.test/', 'http://127.0.0.1:40001/', 'file:///tmp/page.html']) {
        const event = { url, preventDefault: vi.fn() }
        subject.page.emit(eventName, event)
        expect(event.preventDefault).toHaveBeenCalledOnce()
      }
      const event = { url: 'http://127.0.0.1:40002/other', preventDefault: vi.fn() }
      subject.page.emit(eventName, event)
      expect(event.preventDefault).not.toHaveBeenCalled()
    }
    const download = { preventDefault: vi.fn() }
    subject.page.session.emit('will-download', download)
    expect(download.preventDefault).toHaveBeenCalledOnce()
  })

  it.each(['hide', 'invalidate', 'destroyed', 'new-document'] as const)('rejects late load after %s without showing it', async (action) => {
    const subject = fixture()
    const result = Promise.withResolvers<undefined>()
    subject.page.loadURL.mockReturnValueOnce(result.promise)
    const pending = subject.show()
    const rejection = expect(pending).rejects.toThrow()
    if (action === 'hide') await subject.hide()
    if (action === 'invalidate') subject.bridge.invalidate()
    if (action === 'destroyed') subject.window.isDestroyed.mockReturnValue(true)
    if (action === 'new-document') subject.frame.url = 'https://external.test/'
    result.resolve(undefined)
    await rejection
    expect(subject.view.setVisible).not.toHaveBeenCalledWith(true)
    if (action === 'invalidate') expect(subject.page.close).toHaveBeenCalledWith({ waitForBeforeUnload: false })
  })

  it('shares a pending same-URL load while applying the newest resize', async () => {
    const subject = fixture()
    const result = Promise.withResolvers<undefined>()
    subject.page.loadURL.mockReturnValueOnce(result.promise)
    const first = subject.show()
    const second = subject.show({ ...subject.request, bounds: { x: 600, y: 150, width: 200, height: 400 } })
    result.resolve(undefined)
    await Promise.all([first, second])
    expect(subject.page.loadURL).toHaveBeenCalledOnce()
    expect(subject.view.setBounds).toHaveBeenLastCalledWith({ x: 600, y: 150, width: 200, height: 400 })
    expect(subject.view.setVisible).toHaveBeenLastCalledWith(true)
  })

  it('cleans up failed loads and destroys once when the owner is invalidated repeatedly', async () => {
    const subject = fixture()
    subject.page.loadURL.mockRejectedValueOnce(new Error('connection refused'))
    await expect(subject.show()).rejects.toThrow('connection refused')
    subject.bridge.invalidate()
    expect(subject.page.close).toHaveBeenCalledOnce()
    expect(subject.window.contentView.removeChildView).toHaveBeenCalledOnce()
    expect(subject.view.setVisible).not.toHaveBeenCalledWith(true)
  })
})
