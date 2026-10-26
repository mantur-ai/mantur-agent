/** Native export grants authorize one selected file and clean incomplete writes. */
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent, SaveDialogReturnValue } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installCutExportBridge } from '../src/cut-export-bridge.ts'

type Handler = (event: IpcMainInvokeEvent, value: unknown) => Promise<unknown>
const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'mantur-cut-export-'))
  directories.push(directory)
  const handlers = new Map<string, Handler>()
  const frame = { url: 'http://127.0.0.1:40201/' }
  const window = { isDestroyed: () => false, webContents: { mainFrame: frame, isDestroyed: () => false } }
  const event = { sender: window.webContents, senderFrame: frame } as unknown as IpcMainInvokeEvent
  const showSaveDialog = vi.fn(async (): Promise<SaveDialogReturnValue> => ({ canceled: false, filePath: join(directory, 'chosen.mp4') }))
  const bridge = installCutExportBridge({
    ipc: { handle: (name: string, handler: Handler) => { handlers.set(name, handler) } } as unknown as IpcMain,
    window: () => window as unknown as BrowserWindow, origin: () => 'http://127.0.0.1:40201',
    unavailable: () => false, showSaveDialog,
  })
  const owner = randomUUID()
  const invoke = (value: Record<string, unknown>, source = event) => handlers.get('mantur:cut-export:invoke')!(source, { owner, ...value })
  await handlers.get('mantur:cut-export:attach')!(event, owner)
  const pick = () => invoke({ op: 'pick', name: 'suggested.mp4', directory }) as Promise<{ id: string; name: string } | null>
  return { directory, bridge, handlers, window, frame, event, showSaveDialog, owner, invoke, pick }
}

describe('Cut native export', () => {
  it('writes only the selected file and atomically replaces it after nonempty finalization', async () => {
    const s = await fixture()
    await writeFile(join(s.directory, 'chosen.mp4'), 'previous')
    const selected = await s.pick()
    expect(typeof selected?.id).toBe('string')
    expect(selected?.name).toBe('chosen.mp4')
    expect(JSON.stringify(selected)).not.toContain(s.directory)
    expect(s.showSaveDialog).toHaveBeenCalledWith(s.window, { defaultPath: join(s.directory, 'suggested.mp4') })
    await s.invoke({ op: 'start', id: selected!.id })
    await s.invoke({ op: 'write', id: selected!.id, offset: 0, bytes: new Uint8Array([1, 2, 3]) })
    expect(await readFile(join(s.directory, 'chosen.mp4'), 'utf8')).toBe('previous')
    await s.invoke({ op: 'finish', id: selected!.id })
    expect(await readFile(join(s.directory, 'chosen.mp4'))).toEqual(Buffer.from([1, 2, 3]))
    expect(await readdir(s.directory)).toEqual(['chosen.mp4'])
    expect(s.bridge.isPending()).toBe(false)
    await s.bridge.invalidate()
  })

  it('handles picker cancellation and rejects stale picker results after editor replacement', async () => {
    const s = await fixture()
    s.showSaveDialog.mockResolvedValueOnce({ canceled: true, filePath: '' })
    await expect(s.pick()).resolves.toBeNull()
    const selection = Promise.withResolvers<SaveDialogReturnValue>()
    s.showSaveDialog.mockReturnValueOnce(selection.promise)
    const first = s.pick()
    await expect(s.pick()).rejects.toThrow('pending')
    await s.bridge.invalidate()
    selection.resolve({ canceled: false, filePath: join(s.directory, 'late.mp4') })
    await expect(first).rejects.toThrow('replaced')
    expect(await readdir(s.directory)).toEqual([])
  })

  it('preserves the current selection across repeated attachment and a canceled picker', async () => {
    const s = await fixture()
    const selected = await s.pick()
    await s.handlers.get('mantur:cut-export:attach')!(s.event, s.owner)
    s.showSaveDialog.mockResolvedValueOnce({ canceled: true, filePath: '' })
    await expect(s.pick()).resolves.toBeNull()
    await s.invoke({ op: 'start', id: selected!.id })
    await s.invoke({ op: 'write', id: selected!.id, offset: 0, bytes: new Uint8Array([9]) })
    await s.invoke({ op: 'finish', id: selected!.id })
    expect(await readFile(join(s.directory, 'chosen.mp4'))).toEqual(Buffer.from([9]))
    await s.bridge.invalidate()
  })

  it('allows the same editor to choose again after an interrupted shutdown revokes its files', async () => {
    const s = await fixture()
    await s.pick()
    await s.bridge.invalidate()
    await s.handlers.get('mantur:cut-export:attach')!(s.event, s.owner)
    const selected = await s.pick()
    await s.invoke({ op: 'start', id: selected!.id })
    await s.invoke({ op: 'write', id: selected!.id, offset: 0, bytes: new Uint8Array([8]) })
    await s.invoke({ op: 'finish', id: selected!.id })
    expect(await readFile(join(s.directory, 'chosen.mp4'))).toEqual(Buffer.from([8]))
    await s.bridge.invalidate()
  })

  it('rejects foreign windows, subframes, wrong origins and unregistered owners', async () => {
    const s = await fixture()
    for (const event of [{ ...s.event, sender: {} }, { ...s.event, senderFrame: null }, { ...s.event, senderFrame: { ...s.frame } }]) {
      await expect(s.invoke({ op: 'pick' }, event as IpcMainInvokeEvent)).rejects.toThrow('main frame')
    }
    await expect(s.invoke({ op: 'pick', owner: randomUUID() })).rejects.toThrow('replaced')
    s.frame.url = 'https://example.com/'
    await expect(s.pick()).rejects.toThrow('main frame')
    expect(s.showSaveDialog).not.toHaveBeenCalled()
  })

  it.each(['../escape.mp4', '/absolute.mp4', 'CON.mp4', 'bad\\name.mp4'])('rejects unsafe suggested name %s before opening a dialog', async (name) => {
    const s = await fixture()
    await expect(s.invoke({ op: 'pick', name, directory: s.directory })).rejects.toThrow('filename')
    expect(s.showSaveDialog).not.toHaveBeenCalled()
  })

  it.each(['empty', 'offset', 'large', 'invalid-op'] as const)('cleans the temporary file after %s failure and preserves the existing target', async (failure) => {
    const s = await fixture()
    await writeFile(join(s.directory, 'chosen.mp4'), 'previous')
    const selected = await s.pick()
    await s.invoke({ op: 'start', id: selected!.id })
    const request = failure === 'empty' ? { op: 'finish' } : failure === 'invalid-op' ? { op: 'unknown' }
      : { op: 'write', offset: failure === 'offset' ? 1 : 0, bytes: new Uint8Array(failure === 'large' ? 1024 * 1024 + 1 : 1) }
    await expect(s.invoke({ ...request, id: selected!.id })).rejects.toThrow()
    expect(await readdir(s.directory)).toEqual(['chosen.mp4'])
    expect(await readFile(join(s.directory, 'chosen.mp4'), 'utf8')).toBe('previous')
    await s.bridge.invalidate()
  })

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('retains a failed cleanup until its temporary path can be removed', async () => {
    const s = await fixture()
    const selected = await s.pick()
    await s.invoke({ op: 'start', id: selected!.id })
    await chmod(s.directory, 0o500)
    try {
      await expect(s.invoke({ op: 'abort', id: selected!.id })).rejects.toThrow()
      await expect(s.bridge.invalidate()).rejects.toThrow()
      expect(s.bridge.isPending()).toBe(true)
      expect(await readdir(s.directory)).toHaveLength(1)
    } finally { await chmod(s.directory, 0o700) }
    await s.bridge.invalidate()
    expect(await readdir(s.directory)).toEqual([])
    expect(s.bridge.isPending()).toBe(false)
  })

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('retains the failed temporary path when the same selection retries a write', async () => {
    const s = await fixture()
    const selected = await s.pick()
    await s.invoke({ op: 'start', id: selected!.id })
    await chmod(s.directory, 0o500)
    try {
      await expect(s.invoke({ op: 'abort', id: selected!.id })).rejects.toThrow()
      await expect(s.pick()).rejects.toThrow('active')
      expect(s.showSaveDialog).toHaveBeenCalledOnce()
    } finally { await chmod(s.directory, 0o700) }
    await expect(s.invoke({ op: 'start', id: selected!.id })).rejects.toThrow('already open')
    expect(await readdir(s.directory)).toEqual([])
    await s.invoke({ op: 'start', id: selected!.id })
    await s.invoke({ op: 'write', id: selected!.id, offset: 0, bytes: new Uint8Array([1]) })
    await s.invoke({ op: 'finish', id: selected!.id })
    await s.bridge.invalidate()
    expect(await readdir(s.directory)).toEqual(['chosen.mp4'])
    expect(s.bridge.isPending()).toBe(false)
  })

  it('awaits an in-flight write before revoking and deleting its temporary output', async () => {
    const s = await fixture()
    const selected = await s.pick()
    await s.invoke({ op: 'start', id: selected!.id })
    const writing = s.invoke({ op: 'write', id: selected!.id, offset: 0, bytes: new Uint8Array(1024 * 1024) })
    const rejected = expect(writing).rejects.toThrow('replaced')
    await s.bridge.invalidate()
    await rejected
    expect(await readdir(s.directory)).toEqual([])
    await expect(s.invoke({ op: 'finish', id: selected!.id })).rejects.toThrow('replaced')
  })
})
