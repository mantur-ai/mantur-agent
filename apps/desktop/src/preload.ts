/** Sandboxed preload: expose only draft storage and correlated save acknowledgements. */
import { contextBridge, ipcRenderer } from 'electron'

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
