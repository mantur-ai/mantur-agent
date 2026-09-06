/** Native IPC authorization and exact-revision restart receipts without launching Electron. */
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installDraftBridge } from '../src/draft-bridge.ts'
import { DesktopDraftStorage } from '../src/draft-storage.ts'

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); vi.useRealTimers() })
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'mantur-bridge-test-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>>()
  const frame = { url: 'http://127.0.0.1:41234/' }
  const send = vi.fn()
  const window = { isDestroyed: () => false, webContents: { mainFrame: frame, send, isDestroyed: () => false } }
  const event = { sender: window.webContents, senderFrame: frame } as unknown as IpcMainInvokeEvent
  const storage = new DesktopDraftStorage(root)
  const bridge = installDraftBridge({
    ipc: { handle: (name: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>) => {
      handlers.set(name, handler)
    } } as unknown as IpcMain,
    window: () => window as unknown as BrowserWindow, origin: () => 'http://127.0.0.1:41234', storage, timeoutMs: 100,
  })
  cleanups.push(bridge.release)
  const invoke = (name: string, value?: unknown, source = event) => handlers.get(`mantur:drafts:${name}`)!(source, value)
  return { bridge, send, event, frame, invoke, storage }
}
describe('desktop draft IPC', () => {
  it('rejects other windows and child frames even when their URL matches', async () => {
    const subject = await setup()
    await expect(subject.invoke('load', undefined, { ...subject.event, sender: {} } as IpcMainInvokeEvent)).rejects.toThrow('main frame')
    await expect(subject.invoke('load', undefined, { ...subject.event, senderFrame: { ...subject.frame } } as IpcMainInvokeEvent)).rejects.toThrow('main frame')
    subject.frame.url = 'https://external.example/'
    await expect(subject.invoke('load')).rejects.toThrow('main frame')
  })
  it('requires the current request and exact committed revision, then seals further writes', async () => {
    const subject = await setup()
    const prepared = subject.bridge.prepare()
    const id: unknown = subject.send.mock.calls.at(-1)?.[1]
    await expect(subject.invoke('prepared', { id: 'stale', ok: true, revision: 0 })).rejects.toThrow('Stale')
    await subject.invoke('prepared', { id, ok: true, revision: 0 })
    await expect(prepared).resolves.toBe(0)
    await expect(subject.invoke('save', { format: 1, revision: 1, drafts: [] })).rejects.toThrow('sealed')
    subject.bridge.release()
    expect(subject.send).toHaveBeenLastCalledWith('mantur:drafts:release')
  })
  it('does not accept a mismatched revision or a renderer-reported failure', async () => {
    const subject = await setup()
    let prepared = subject.bridge.prepare()
    let rejection = expect(prepared).rejects.toThrow('durable checkpoint')
    let id: unknown = subject.send.mock.calls.at(-1)?.[1]
    await subject.invoke('prepared', { id, ok: true, revision: 99 })
    await rejection
    subject.bridge.release()
    prepared = subject.bridge.prepare()
    rejection = expect(prepared).rejects.toThrow('attachment missing')
    id = subject.send.mock.calls.at(-1)?.[1]
    await subject.invoke('prepared', { id, ok: false, error: 'attachment missing' })
    await rejection
  })
  it('rejects a restart released while durable receipt verification is pending', async () => {
    const subject = await setup()
    let resolveRead!: (value: Awaited<ReturnType<DesktopDraftStorage['committed']>>) => void
    const read = new Promise<Awaited<ReturnType<DesktopDraftStorage['committed']>>>((resolve) => { resolveRead = resolve })
    vi.spyOn(subject.storage, 'committed').mockReturnValue(read)
    const prepared = subject.bridge.prepare()
    const rejection = expect(prepared).rejects.toThrow('cancelled')
    const id: unknown = subject.send.mock.calls.at(-1)?.[1]
    const verifying = subject.invoke('prepared', { id, ok: true, revision: 0 })
    subject.bridge.release()
    await rejection
    resolveRead({ format: 1, revision: 0, drafts: [] })
    await verifying
    await expect(subject.invoke('prepared', { id, ok: true, revision: 0 })).rejects.toThrow('Stale')
  })
  it('times out an unresponsive renderer and rejects its late receipt', async () => {
    vi.useFakeTimers()
    const subject = await setup()
    const prepared = subject.bridge.prepare()
    const rejection = expect(prepared).rejects.toThrow('did not confirm')
    const id: unknown = subject.send.mock.calls.at(-1)?.[1]
    await expect(subject.bridge.prepare()).rejects.toThrow('already')
    await vi.advanceTimersByTimeAsync(100)
    await rejection
    await expect(subject.invoke('prepared', { id, ok: true, revision: 0 })).rejects.toThrow('Stale')
    expect(subject.send).toHaveBeenLastCalledWith('mantur:drafts:release')
  })
})
