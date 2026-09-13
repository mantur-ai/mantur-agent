/** Sandboxed preload: expose only named draft, updater, directory-picker and native-account capabilities. */
import { contextBridge, ipcRenderer, webUtils } from 'electron'

contextBridge.exposeInMainWorld('manturFiles', {
  importFiles: (files: File[]) => {
    const paths = files.map(file => webUtils.getPathForFile(file))
    if (paths.some(path => path === '')) throw new Error('Select files from disk to import them')
    return ipcRenderer.invoke('mantur:files:import', paths)
  },
  pick: (kind: 'file' | 'directory') => ipcRenderer.invoke('mantur:files:pick', kind),
})

contextBridge.exposeInMainWorld('manturDirectoryPicker', {
  pick: () => ipcRenderer.invoke('mantur:directory-picker:pick'),
})

contextBridge.exposeInMainWorld('manturAccount', {
  invoke: (request: unknown) => ipcRenderer.invoke('mantur:account:invoke', request),
  subscribe: (handler: (state: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: unknown): void => { handler(state) }
    ipcRenderer.on('mantur:account:changed', listener)
    return () => { ipcRenderer.removeListener('mantur:account:changed', listener) }
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
