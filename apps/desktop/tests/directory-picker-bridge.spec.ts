/** Native directory selection stays bound to one trusted document and its parent window. */
import { resolve } from 'node:path'
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent, OpenDialogOptions, OpenDialogReturnValue } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { installDirectoryPickerBridge } from '../src/directory-picker-bridge.ts'
import { desktopCopy } from '../src/locales.ts'

function fixture() {
  const handlers = new Map<string, (event: IpcMainInvokeEvent) => Promise<string | null>>()
  const frame = { url: 'http://127.0.0.1:40001/' }
  const window = { isDestroyed: vi.fn(() => false), webContents: { mainFrame: frame, isDestroyed: vi.fn(() => false) } }
  const event = { sender: window.webContents, senderFrame: frame } as unknown as IpcMainInvokeEvent
  let activeWindow: BrowserWindow | undefined = window as unknown as BrowserWindow
  let unavailable = false
  const showOpenDialog = vi.fn(async (_window: BrowserWindow, _options: OpenDialogOptions): Promise<OpenDialogReturnValue> => ({
    canceled: true, filePaths: [],
  }))
  const bridge = installDirectoryPickerBridge({
    ipc: { handle: (name: string, handler: (event: IpcMainInvokeEvent) => Promise<string | null>) => {
      handlers.set(name, handler)
    } } as unknown as IpcMain,
    window: () => activeWindow, origin: () => 'http://127.0.0.1:40001',
    showOpenDialog, unavailable: () => unavailable, copy: () => desktopCopy('en'),
  })
  const invoke = (source = event) => handlers.get('mantur:directory-picker:pick')!(source)
  return { bridge, invoke, handlers, event, frame, window, showOpenDialog,
    block: () => { unavailable = true }, close: () => { activeWindow = undefined } }
}

describe('native directory picker IPC', () => {
  it('parents a directory-only dialog to the current window and returns its absolute selection', async () => {
    const subject = fixture()
    const path = resolve('chosen directory')
    subject.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [path] })
    expect([...subject.handlers.keys()]).toEqual(['mantur:directory-picker:pick'])
    await expect(subject.invoke()).resolves.toBe(path)
    expect(subject.showOpenDialog).toHaveBeenCalledExactlyOnceWith(subject.window, {
      title: desktopCopy('en').directoryPickerTitle, properties: ['openDirectory'],
    })
    expect(subject.bridge.isPending()).toBe(false)
  })

  it('returns null for cancellation and preserves native failures before allowing another selection', async () => {
    const subject = fixture()
    await expect(subject.invoke()).resolves.toBeNull()
    const error = new Error('native dialog failed')
    subject.showOpenDialog.mockRejectedValueOnce(error)
    await expect(subject.invoke()).rejects.toBe(error)
    expect(subject.bridge.isPending()).toBe(false)
    await expect(subject.invoke()).resolves.toBeNull()
  })

  it('rejects repeated requests while the native dialog is pending', async () => {
    const subject = fixture()
    const result = Promise.withResolvers<OpenDialogReturnValue>()
    subject.showOpenDialog.mockReturnValueOnce(result.promise)
    const first = subject.invoke()
    try {
      expect(subject.bridge.isPending()).toBe(true)
      await expect(subject.invoke()).rejects.toThrow(desktopCopy('en').directoryPickerBusy)
      expect(subject.showOpenDialog).toHaveBeenCalledOnce()
    } finally { result.resolve({ canceled: true, filePaths: [] }); await first }
    expect(subject.bridge.isPending()).toBe(false)
  })

  it('rejects foreign windows, child frames, missing frames, and external origins', async () => {
    const subject = fixture()
    for (const source of [
      { ...subject.event, sender: {} },
      { ...subject.event, senderFrame: { ...subject.frame } },
      { ...subject.event, senderFrame: null },
    ]) await expect(subject.invoke(source as IpcMainInvokeEvent)).rejects.toThrow('main frame')
    subject.frame.url = 'https://external.example/'
    await expect(subject.invoke()).rejects.toThrow('main frame')
    expect(subject.showOpenDialog).not.toHaveBeenCalled()
  })

  it('refuses new selections while update preparation or quitting makes the picker unavailable', async () => {
    const subject = fixture()
    subject.block()
    await expect(subject.invoke()).rejects.toThrow(desktopCopy('en').directoryPickerUnavailable)
    expect(subject.showOpenDialog).not.toHaveBeenCalled()
  })

  it.each(['navigation', 'closed', 'destroyed', 'new-frame'] as const)('rejects a late path after %s', async (event) => {
    const subject = fixture()
    const result = Promise.withResolvers<OpenDialogReturnValue>()
    subject.showOpenDialog.mockReturnValueOnce(result.promise)
    const first = subject.invoke()
    const rejected = expect(first).rejects.toThrow()
    try {
      if (event === 'navigation') subject.bridge.invalidate()
      if (event === 'closed') { subject.bridge.invalidate(); subject.close() }
      if (event === 'destroyed') subject.window.isDestroyed.mockReturnValue(true)
      if (event === 'new-frame') subject.window.webContents.mainFrame = { ...subject.frame }
      expect(subject.bridge.isPending()).toBe(true)
      if (event === 'navigation') await expect(subject.invoke()).rejects.toThrow(desktopCopy('en').directoryPickerBusy)
      expect(subject.showOpenDialog).toHaveBeenCalledOnce()
    } finally { result.resolve({ canceled: false, filePaths: [resolve('old document directory')] }); await rejected }
    expect(subject.bridge.isPending()).toBe(false)
  })

  it.each([
    { filePaths: [] }, { filePaths: ['relative/directory'] }, { filePaths: [resolve('one'), resolve('two')] },
  ])('rejects invalid native selections $filePaths', async ({ filePaths }) => {
    const subject = fixture()
    subject.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths })
    await expect(subject.invoke()).rejects.toThrow(desktopCopy('en').directoryPickerInvalidResult)
    expect(subject.bridge.isPending()).toBe(false)
  })
})
