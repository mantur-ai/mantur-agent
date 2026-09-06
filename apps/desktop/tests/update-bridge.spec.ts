/** Update IPC refuses foreign frames and routes installation through the shared controller. */
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { installUpdateBridge } from '../src/update-bridge.ts'
import type { DesktopUpdateController } from '../src/updater.ts'

function fixture() {
  const handlers = new Map<string, (event: IpcMainInvokeEvent) => unknown>()
  const frame = { url: 'http://127.0.0.1:40001/' }
  const send = vi.fn()
  const window = { isDestroyed: () => false, webContents: { mainFrame: frame, send, isDestroyed: () => false } }
  const event = { sender: window.webContents, senderFrame: frame } as unknown as IpcMainInvokeEvent
  let controller: DesktopUpdateController | undefined = { getState: () => ({ kind: 'idle' }), checkNow: vi.fn(), downloadAvailableUpdate: vi.fn(), installReadyUpdate: vi.fn(), dispose: vi.fn() }
  const initial = controller
  const bridge = installUpdateBridge({
    ipc: { handle: (name: string, handler: (event: IpcMainInvokeEvent) => unknown) => {
      handlers.set(name, handler)
    } } as unknown as IpcMain,
    window: () => window as unknown as BrowserWindow, origin: () => 'http://127.0.0.1:40001',
    controller: () => controller, version: '1.0.0',
  })
  const invoke = (name: string, source = event) => handlers.get(`mantur:updates:${name}`)!(source)
  return { bridge, invoke, event, frame, send, initial, disable: () => { controller = undefined } }
}

describe('native updater IPC', () => {
  it('rejects child frames, other windows, and external origins', () => {
    const subject = fixture()
    expect(() => subject.invoke('install', { ...subject.event, sender: {} } as IpcMainInvokeEvent)).toThrow('main frame')
    expect(() => subject.invoke('download', { ...subject.event, senderFrame: { ...subject.frame } } as IpcMainInvokeEvent)).toThrow('main frame')
    subject.frame.url = 'https://external.example/'
    expect(() => subject.invoke('check')).toThrow('main frame')
    expect(subject.initial.installReadyUpdate).not.toHaveBeenCalled()
  })
  it('exposes current state and only invokes shared controller actions', () => {
    const subject = fixture()
    subject.bridge.publish({ kind: 'ready', version: '1.2.0', prompting: false })
    expect(subject.invoke('snapshot')).toEqual({ revision: 1, enabled: true, currentVersion: '1.0.0', state: { kind: 'ready', version: '1.2.0', prompting: false } })
    subject.invoke('install'); subject.invoke('download'); subject.invoke('check')
    expect(subject.initial.installReadyUpdate).toHaveBeenCalledOnce()
    expect(subject.initial.downloadAvailableUpdate).toHaveBeenCalledOnce()
    expect(subject.initial.checkNow).toHaveBeenCalledOnce()
    subject.disable()
    expect(() => subject.invoke('install')).toThrow('unavailable')
  })
})
