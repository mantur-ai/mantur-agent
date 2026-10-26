/** Relay export requests only between the active editor frame and the owning desktop window. */
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'

interface NativeExport {
  attach(owner: string): Promise<void>
  release(owner: string): Promise<void>
  invoke(request: unknown): Promise<unknown>
}
interface BrowserFile {
  name: string
  createWritable(): Promise<{ write(bytes: Uint8Array): Promise<void>; close(): Promise<void>; abort(): Promise<void> }>
}

interface ExportWindow {
  manturCutExport?: NativeExport
  showSaveFilePicker?: (options: { suggestedName: string }) => Promise<BrowserFile>
}

/**
 * Bind one editor frame to native file grants or a top-level browser file picker.
 * @param frame - The current iframe; both its Window and exact origin are required for every request.
 * @param url - Host-validated editor URL.
 * @param directory - Session-owned default export directory shown in the native dialog.
 * @returns Cleanup that revokes pending selection and aborts unfinished writes.
 */
export function installExportBridge(frame: HTMLIFrameElement, url: string, directory: string): () => void {
  const host = window as unknown as ExportWindow
  const origin = new URL(url).origin
  const native = host.manturCutExport
  let owner = randomUUID()
  let active = true
  let selected: { id: string; file: BrowserFile } | undefined
  let writable: Awaited<ReturnType<BrowserFile['createWritable']>> | undefined
  let offset = 0
  let ready: Promise<void> = Promise.resolve()
  let busy = false
  let work: Promise<unknown> | undefined
  const current = (expected: string): boolean => active && owner === expected
  const revoke = async (): Promise<void> => {
    selected = undefined
    const previous = writable
    await previous?.abort()
    if (writable === previous) writable = undefined
  }
  const bind = (): void => {
    owner = randomUUID()
    const previous = work
    ready = native ? native.attach(owner) : Promise.resolve(previous).catch(() => undefined).then(revoke)
    void ready.catch(() => { /* Requests receive the retained initialization failure. */ })
  }
  bind()
  const receive = (event: MessageEvent<unknown>): void => {
    if (!active || event.source !== frame.contentWindow || event.origin !== origin) return
    const data = event.data
    if (!data || typeof data !== 'object' || !('type' in data) || data.type !== 'mantur:cut-export'
      || !('version' in data) || data.version !== 1 || !('requestId' in data) || typeof data.requestId !== 'string'
      || data.requestId.length > 100 || !('request' in data) || !data.request || typeof data.request !== 'object') return
    const request = data.request as Record<string, unknown>
    const source = frame.contentWindow
    const requestOwner = owner
    const reply = (result: unknown, error = false): void => {
      if (active && owner === requestOwner && source === frame.contentWindow) source?.postMessage({
        type: 'mantur:cut-export-result', version: 1, requestId: data.requestId, result, error,
      }, origin)
    }
    if (request.op !== 'ready' && busy) { reply(null, true); return }
    const requestReady = ready
    const operation = (async () => {
      if (request.op === 'ready') {
        await requestReady
        return Boolean(native || host.showSaveFilePicker)
      }
      busy = true
      try {
        await requestReady
        if (!current(requestOwner)) throw new Error('Editor was replaced')
        if (request.op === 'pick' && !navigator.userActivation.isActive) throw new Error('Export selection needs a user action')
        if (native) {
          if (request.op === 'pick') await native.attach(requestOwner)
          if (!current(requestOwner)) throw new Error('Editor was replaced')
          return await native.invoke({ ...request, owner: requestOwner, directory })
        }
        if (request.op === 'pick') {
          if (writable) throw new Error('Export write is active')
          if (typeof request.name !== 'string' || !host.showSaveFilePicker) throw new Error('File picker unavailable')
          try {
            const file = await host.showSaveFilePicker({ suggestedName: request.name })
            if (!current(requestOwner)) throw new Error('Editor was replaced')
            selected = { id: randomUUID(), file }
            return { id: selected.id, name: file.name }
          } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') return null
            throw error
          }
        }
        if (!selected || request.id !== selected.id) throw new Error('Export selection expired')
        if (request.op === 'start') {
          if (writable) throw new Error('Export write already open')
          const stream = await selected.file.createWritable()
          writable = stream
          if (!current(requestOwner)) throw new Error('Editor was replaced')
          offset = 0
        } else if (request.op === 'write') {
          if (!writable || !(request.bytes instanceof Uint8Array) || request.bytes.byteLength === 0
            || request.bytes.byteLength > 1024 * 1024 || request.offset !== offset) throw new Error('Invalid export chunk')
          await writable.write(request.bytes)
          offset += request.bytes.byteLength
        } else if (request.op === 'finish') {
          if (!writable || offset === 0) throw new Error('Export file is empty')
          await writable.close()
          writable = undefined
        } else if (request.op === 'abort') {
          await revoke()
        } else throw new Error('Invalid export operation')
        return undefined
      } catch (error) {
        if (!native) await revoke()
        throw error
      } finally { busy = false }
    })()
    if (request.op !== 'ready') work = operation
    void operation.then((result) => { reply(result) }, () => { reply(null, true) })
  }
  const reload = (): void => { bind() }
  window.addEventListener('message', receive)
  frame.addEventListener('load', reload)
  return () => {
    active = false
    window.removeEventListener('message', receive)
    frame.removeEventListener('load', reload)
    const cleanup = native ? native.release(owner) : Promise.resolve(work).catch(() => undefined).then(revoke)
    void cleanup.catch((error: unknown) => { console.error(error) })
  }
}
