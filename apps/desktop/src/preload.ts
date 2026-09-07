/** Sandboxed preload: expose only named draft, updater and native-account capabilities. */
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('manturAccount', {
  invoke: (request: unknown) => ipcRenderer.invoke('mantur:account:invoke', request),
  subscribe: (handler: (state: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: unknown): void => { handler(state) }
    ipcRenderer.on('mantur:account:changed', listener)
    return () => { ipcRenderer.removeListener('mantur:account:changed', listener) }
  },
})

contextBridge.exposeInMainWorld('manturDrafts', {
  load: () => ipcRenderer.invoke('mantur:drafts:load'),
  save: (checkpoint: unknown) => ipcRenderer.invoke('mantur:drafts:save', checkpoint),
  onPrepare: (handler: () => Promise<number>) => {
    const listener = (_event: Electron.IpcRendererEvent, id: string): void => {
      void Promise.resolve().then(handler).then(
        revision => ipcRenderer.invoke('mantur:drafts:prepared', { id, ok: true, revision }),
        (error: unknown) => ipcRenderer.invoke('mantur:drafts:prepared', { id, ok: false, error: String(error) }),
      ).catch(() => { /* Main rejects a stale receipt after cancellation; release owns input unlocking. */ })
    }
    ipcRenderer.on('mantur:drafts:prepare', listener)
    return () => { ipcRenderer.removeListener('mantur:drafts:prepare', listener) }
  },
  onRelease: (handler: () => void) => {
    const listener = (): void => { handler() }
    ipcRenderer.on('mantur:drafts:release', listener)
    return () => { ipcRenderer.removeListener('mantur:drafts:release', listener) }
  },
})

contextBridge.exposeInMainWorld('manturUpdates', {
  getSnapshot: () => ipcRenderer.invoke('mantur:updates:snapshot'),
  check: () => ipcRenderer.invoke('mantur:updates:check'),
  download: () => ipcRenderer.invoke('mantur:updates:download'),
  install: () => ipcRenderer.invoke('mantur:updates:install'),
  subscribe: (handler: (snapshot: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: unknown): void => { handler(snapshot) }
    ipcRenderer.on('mantur:updates:changed', listener)
    return () => { ipcRenderer.removeListener('mantur:updates:changed', listener) }
  },
})
