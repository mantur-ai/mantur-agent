import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import { expect, it, vi } from 'vitest'
import { installFileImportBridge } from '../src/file-import-bridge.ts'

it('imports only from the trusted main frame and validates both native commands', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mantur-import-ipc-'))
  try {
    const handlers = new Map<string, (event: IpcMainInvokeEvent, value: unknown) => Promise<unknown>>()
    const frame = { url: 'http://127.0.0.1:40001/' }
    const window = { isDestroyed: () => false, webContents: { mainFrame: frame, isDestroyed: () => false } }
    const event = { sender: window.webContents, senderFrame: frame } as unknown as IpcMainInvokeEvent
    const source = join(root, 'script.md')
    await writeFile(source, '# script')
    const dialog = vi.fn(async () => ({ canceled: false, filePaths: [source] }))
    installFileImportBridge({
      ipc: { handle: (name: string, handler: (event: IpcMainInvokeEvent, value: unknown) => Promise<unknown>) => {
        handlers.set(name, handler)
      } } as unknown as IpcMain,
      window: () => window as unknown as BrowserWindow,
      origin: () => 'http://127.0.0.1:40001', root: join(root, 'store'), showOpenDialog: dialog,
    })
    const invoke = (name: string, value: unknown, sender = event) => handlers.get(`mantur:files:${name}`)!(sender, value)
    const refs = await invoke('import', [source]) as { path: string }[]
    expect(await readFile(refs[0]!.path, 'utf8')).toBe('# script')
    await expect(invoke('import', [123])).rejects.toThrow('array')
    await expect(invoke('pick', 'anything')).rejects.toThrow('selection kind')
    for (const source of [
      { ...event, sender: {} }, { ...event, senderFrame: null }, { ...event, senderFrame: { ...frame } },
    ]) await expect(invoke('import', [source], source as IpcMainInvokeEvent)).rejects.toThrow('main frame')
    frame.url = 'https://example.invalid/'
    await expect(invoke('import', [])).rejects.toThrow('main frame')
    frame.url = 'http://127.0.0.1:40001/'
    expect(await invoke('pick', 'file')).toHaveLength(1)
    expect(dialog).toHaveBeenCalledWith(window, { properties: ['openFile', 'multiSelections'] })
    dialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    expect(await invoke('pick', 'directory')).toEqual([])
  } finally { await rm(root, { recursive: true, force: true }) }
})
