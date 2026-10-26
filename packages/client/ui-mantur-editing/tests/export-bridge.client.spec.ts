// @vitest-environment jsdom
/** Cross-origin exports use only the current iframe and abort incomplete browser writes. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installExportBridge } from '../src/client/export-bridge.ts'

const cleanups: Array<() => void> = []
afterEach(() => { cleanups.splice(0).forEach((dispose) => { dispose() }); vi.unstubAllGlobals(); document.body.replaceChildren() })
async function fixture(native = true) {
  const bridge = { attach: vi.fn(async (_owner: string) => undefined), release: vi.fn(async (_owner: string) => undefined),
    invoke: vi.fn(async (_request: unknown): Promise<unknown> => null) }
  Object.defineProperty(window, 'manturCutExport', { configurable: true, value: native ? bridge : undefined })
  const activation = { isActive: true }
  Object.defineProperty(navigator, 'userActivation', { configurable: true, value: activation })
  const frame = document.createElement('iframe')
  document.body.append(frame)
  await new Promise((resolve) => { setTimeout(resolve, 0) })
  const post = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => {})
  const dispose = installExportBridge(frame, 'http://127.0.0.1:45991/', '/project/剪辑/session/导出')
  cleanups.push(dispose)
  let counter = 0
  const send = async (request: Record<string, unknown>, overrides: Partial<MessageEventInit> = {}) => {
    const requestId = String(++counter)
    window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, origin: 'http://127.0.0.1:45991',
      data: { type: 'mantur:cut-export', version: 1, requestId, request }, ...overrides }))
    const replies = () => post.mock.calls.map(([data]) => data as { requestId: string; result: unknown; error: boolean })
    await vi.waitFor(() => { expect(replies().some(data => data.requestId === requestId)).toBe(true) })
    return replies().find(data => data.requestId === requestId)!
  }
  return { bridge, frame, post, activation, send, dispose }
}

describe('editor export relay', () => {
  it('forwards a native selection with a main-owned editor identity and default directory', async () => {
    const s = await fixture()
    expect(await s.send({ op: 'ready' })).toEqual(expect.objectContaining({ result: true, error: false }))
    s.bridge.invoke.mockResolvedValueOnce({ id: 'grant', name: 'chosen.mp4' })
    expect(await s.send({ op: 'pick', name: 'clip.mp4', owner: 'forged', directory: '/forged' }))
      .toEqual(expect.objectContaining({ result: { id: 'grant', name: 'chosen.mp4' } }))
    expect(s.bridge.invoke).toHaveBeenCalledWith({ op: 'pick', name: 'clip.mp4',
      owner: s.bridge.attach.mock.calls[0]![0], directory: '/project/剪辑/session/导出' })
  })
  it('ignores another frame or origin and refuses selection without activation', async () => {
    const s = await fixture()
    for (const overrides of [{ source: window }, { origin: 'https://foreign.example' }]) {
      window.dispatchEvent(new MessageEvent('message', { source: s.frame.contentWindow, origin: 'http://127.0.0.1:45991',
        data: { type: 'mantur:cut-export', version: 1, requestId: 'foreign', request: { op: 'pick' } }, ...overrides }))
    }
    await Promise.resolve()
    expect(s.bridge.invoke).not.toHaveBeenCalled()
    expect(s.post).not.toHaveBeenCalled()
    s.activation.isActive = false
    expect((await s.send({ op: 'pick', name: 'clip.mp4' })).error).toBe(true)
    expect(s.bridge.invoke).not.toHaveBeenCalled()
  })

  it('reattaches the current native owner before a fresh selection after shutdown recovery', async () => {
    const s = await fixture()
    const owner = s.bridge.attach.mock.calls[0]![0]
    s.bridge.attach.mockClear()
    let attached = false
    s.bridge.attach.mockImplementation(async (id) => { expect(id).toBe(owner); attached = true })
    s.bridge.invoke.mockImplementation(async () => {
      if (!attached) throw new Error('Editor was replaced')
      return { id: 'new-grant', name: 'new.mp4' }
    })
    expect((await s.send({ op: 'pick', name: 'clip.mp4' })).error).toBe(false)
    expect(s.bridge.attach).toHaveBeenCalledExactlyOnceWith(owner)
  })
  it('rebinds reloads and releases the active owner on unmount', async () => {
    const s = await fixture()
    const first = s.bridge.attach.mock.calls[0]![0]
    s.frame.dispatchEvent(new Event('load'))
    expect(s.bridge.attach).toHaveBeenCalledTimes(2)
    const second = s.bridge.attach.mock.calls[1]![0]
    expect(second).not.toBe(first)
    s.dispose()
    expect(s.bridge.release).toHaveBeenCalledWith(second)
  })
  it('uses the top-level browser picker, treats cancel as normal, and aborts write failures', async () => {
    const s = await fixture(false)
    const stream = { write: vi.fn(async () => undefined), close: vi.fn(async () => undefined), abort: vi.fn(async () => undefined) }
    const picker = vi.fn(async () => ({ name: 'browser.mp4', createWritable: async () => stream }))
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: picker })
    picker.mockRejectedValueOnce(new DOMException('cancel', 'AbortError'))
    expect((await s.send({ op: 'pick', name: 'clip.mp4' })).result).toBeNull()
    const picked = (await s.send({ op: 'pick', name: 'clip.mp4' })).result as { id: string }
    await s.send({ op: 'start', id: picked.id })
    stream.write.mockRejectedValueOnce(new Error('disk full'))
    expect((await s.send({ op: 'write', id: picked.id, offset: 0, bytes: new Uint8Array([1]) })).error).toBe(true)
    expect(stream.abort).toHaveBeenCalledOnce()
    expect(stream.close).not.toHaveBeenCalled()
  })
  it('aborts a browser stream on reload and rejects selecting a second file while writing', async () => {
    const s = await fixture(false)
    const stream = { write: vi.fn(async () => undefined), close: vi.fn(async () => undefined), abort: vi.fn(async () => undefined) }
    const picker = vi.fn(async () => ({ name: 'browser.mp4', createWritable: async () => stream }))
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: picker })
    const picked = (await s.send({ op: 'pick', name: 'clip.mp4' })).result as { id: string }
    await s.send({ op: 'start', id: picked.id })
    expect((await s.send({ op: 'pick', name: 'second.mp4' })).error).toBe(true)
    expect(picker).toHaveBeenCalledOnce()
    expect(stream.abort).toHaveBeenCalledOnce()
    const next = (await s.send({ op: 'pick', name: 'clip.mp4' })).result as { id: string }
    await s.send({ op: 'start', id: next.id })
    s.frame.dispatchEvent(new Event('load'))
    await vi.waitFor(() => { expect(stream.abort).toHaveBeenCalledTimes(2) })
  })
  it('waits for an accepted write after a busy rejection before reload aborts the browser stream', async () => {
    const s = await fixture(false)
    const writing = Promise.withResolvers<undefined>()
    const stream = { write: vi.fn(() => writing.promise), close: vi.fn(async () => undefined), abort: vi.fn(async () => undefined) }
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true,
      value: async () => ({ name: 'browser.mp4', createWritable: async () => stream }) })
    const picked = (await s.send({ op: 'pick', name: 'clip.mp4' })).result as { id: string }
    await s.send({ op: 'start', id: picked.id })
    window.dispatchEvent(new MessageEvent('message', { source: s.frame.contentWindow, origin: 'http://127.0.0.1:45991',
      data: { type: 'mantur:cut-export', version: 1, requestId: 'held',
        request: { op: 'write', id: picked.id, offset: 0, bytes: new Uint8Array([1]) } } }))
    await vi.waitFor(() => { expect(stream.write).toHaveBeenCalledOnce() })
    expect((await s.send({ op: 'finish', id: picked.id })).error).toBe(true)
    s.frame.dispatchEvent(new Event('load'))
    await Promise.resolve()
    expect(stream.abort).not.toHaveBeenCalled()
    writing.resolve(undefined)
    await vi.waitFor(() => { expect(stream.abort).toHaveBeenCalledOnce() })
  })

  it('retains a late acquired browser stream when reload cleanup fails', async () => {
    const s = await fixture(false)
    const stream = { write: vi.fn(async () => undefined), close: vi.fn(async () => undefined), abort: vi.fn(async () => undefined) }
    stream.abort.mockRejectedValue(new Error('temporary close failure'))
    const acquiring = Promise.withResolvers<typeof stream>()
    const createWritable = vi.fn(() => acquiring.promise)
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true,
      value: async () => ({ name: 'browser.mp4', createWritable }) })
    const picked = (await s.send({ op: 'pick', name: 'clip.mp4' })).result as { id: string }
    window.dispatchEvent(new MessageEvent('message', { source: s.frame.contentWindow, origin: 'http://127.0.0.1:45991',
      data: { type: 'mantur:cut-export', version: 1, requestId: 'acquiring', request: { op: 'start', id: picked.id } } }))
    await vi.waitFor(() => { expect(createWritable).toHaveBeenCalledOnce() })
    s.frame.dispatchEvent(new Event('load'))
    acquiring.resolve(stream)
    await vi.waitFor(() => { expect(stream.abort).toHaveBeenCalledTimes(2) })
    expect((await s.send({ op: 'ready' })).error).toBe(true)
    stream.abort.mockResolvedValue(undefined)
    s.frame.dispatchEvent(new Event('load'))
    await vi.waitFor(() => { expect(stream.abort).toHaveBeenCalledTimes(3) })
    expect((await s.send({ op: 'ready' })).result).toBe(true)
  })

  it.each(['reload', 'abort'])('keeps a failed browser %s reachable until a later reload cleans it', async (operation) => {
    const s = await fixture(false)
    const stream = { write: vi.fn(async () => undefined), close: vi.fn(async () => undefined), abort: vi.fn(async () => undefined) }
    stream.abort.mockRejectedValue(new Error('temporary close failure'))
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true,
      value: async () => ({ name: 'browser.mp4', createWritable: async () => stream }) })
    const picked = (await s.send({ op: 'pick', name: 'clip.mp4' })).result as { id: string }
    await s.send({ op: 'start', id: picked.id })
    if (operation === 'reload') {
      s.frame.dispatchEvent(new Event('load'))
      await vi.waitFor(() => { expect(stream.abort).toHaveBeenCalledOnce() })
      expect((await s.send({ op: 'ready' })).error).toBe(true)
    } else {
      expect((await s.send({ op: 'abort', id: picked.id })).error).toBe(true)
      expect(stream.abort).toHaveBeenCalledTimes(2)
    }
    stream.abort.mockResolvedValue(undefined)
    const failedAttempts = stream.abort.mock.calls.length
    s.frame.dispatchEvent(new Event('load'))
    await vi.waitFor(() => { expect(stream.abort).toHaveBeenCalledTimes(failedAttempts + 1) })
    expect((await s.send({ op: 'ready' })).result).toBe(true)
  })

})
