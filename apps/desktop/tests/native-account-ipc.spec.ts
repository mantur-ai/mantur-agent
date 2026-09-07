/** Main-frame authorization and secret-free replies through the real native login controller. */
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import type { NativeAccountController } from '../src/auth/controller.ts'
import type { NativeAccountReply } from '@deepseek-ai/dsh-authorization-manturhub/types'
import { installNativeAccountBridge } from '../src/auth/ipc.ts'
import { nativeBrokerBench } from './native-account-broker-support.ts'

afterEach(() => { vi.restoreAllMocks() })

function bridgeFixture(controller: NativeAccountController) {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, input: unknown) => Promise<NativeAccountReply>>()
  const frame = { url: 'http://127.0.0.1:40001/' }
  const send = vi.fn<(channel: string, value: { revision: number }) => void>()
  const window = { isDestroyed: () => false, webContents: { mainFrame: frame, send, isDestroyed: () => false } }
  const event = { sender: window.webContents, senderFrame: frame } as unknown as IpcMainInvokeEvent
  let current: NativeAccountController | undefined = controller
  const bridge = installNativeAccountBridge({
    ipc: { handle: (name: string, handler: (event: IpcMainInvokeEvent, input: unknown) => Promise<NativeAccountReply>) => {
      handlers.set(name, handler)
    }, removeHandler: (name: string) => { handlers.delete(name) } } as unknown as IpcMain,
    window: () => window as unknown as BrowserWindow, origin: () => 'http://127.0.0.1:40001', controller: () => current,
  })
  onTestFinished(() => { bridge.dispose() })
  const invoke = (input: unknown, source = event): Promise<NativeAccountReply> => {
    const handler = handlers.get('mantur:account:invoke')
    if (handler === undefined) throw new Error('Expected account handler')
    return handler(source, input)
  }
  return { bridge, invoke, frame, event, send, handlers, disable: () => { current = undefined } }
}

describe('native account Main IPC', () => {
  it('rejects foreign windows, subframes and external navigation before any account operation', async () => {
    const b = await nativeBrokerBench((_request, response) => { response.end() })
    const subject = bridgeFixture(b.controller)
    const logout = vi.spyOn(b.controller, 'signOut')
    await expect(subject.invoke({ kind: 'sign-out' }, { ...subject.event, sender: {} } as IpcMainInvokeEvent)).rejects.toThrow('main frame')
    await expect(subject.invoke({ kind: 'sign-out' }, {
      ...subject.event, senderFrame: { ...subject.frame },
    } as IpcMainInvokeEvent)).rejects.toThrow('main frame')
    subject.frame.url = 'https://external.example/'
    await expect(subject.invoke({ kind: 'sign-out' })).rejects.toThrow('main frame')
    expect(logout).not.toHaveBeenCalled()
  })

  it('does not echo rejected passwords, URLs or arbitrary action input', async () => {
    const b = await nativeBrokerBench((_request, response) => { response.end() })
    const subject = bridgeFixture(b.controller)
    const password = vi.spyOn(b.controller, 'password')
    for (const input of [
      { kind: 'password', email: 'broker@example.com', password: b.password, consent: false },
      { kind: 'password', email: 'broker@example.com', password: b.password, consent: true, origin: 'https://other.invalid' },
      { kind: 'spawn', password: b.password },
    ]) {
      const result = await subject.invoke(input)
      expect(result).toMatchObject({ ok: false, failure: { kind: 'invalid-request' } })
      expect(JSON.stringify(result)).not.toContain(b.password)
    }
    expect(password).not.toHaveBeenCalled()
  })

  it('reads and publishes only public account fields with monotonically increasing revisions', async () => {
    const b = await nativeBrokerBench((_request, response) => { response.end() })
    const subject = bridgeFixture(b.controller)
    expect(await subject.invoke({ kind: 'snapshot' })).toMatchObject({ ok: true, revision: 0, snapshot: { phase: 'signed-in' } })
    subject.bridge.publish()
    subject.bridge.publish()
    expect(subject.send.mock.calls.map(call => call[1].revision)).toEqual([1, 2])
    const wire = JSON.stringify(subject.send.mock.calls)
    expect(wire).not.toContain(b.bearer())
    expect(wire).not.toContain(b.password)
    expect(await subject.invoke({ kind: 'snapshot' })).toMatchObject({ revision: 2 })
  })

  it('persists Skip through the actual controller and blocks later credential use', async () => {
    const b = await nativeBrokerBench((_request, response) => { response.end() })
    const subject = bridgeFixture(b.controller)
    expect(await subject.invoke({ kind: 'skip' })).toMatchObject({ ok: true, snapshot: { phase: 'signed-out', skipped: true } })
    expect(b.store.skipped()).toBe(true)
    expect(() => b.controller.withCredential(new AbortController().signal, async () => {})).toThrow('signed out')
  })

  it('reports failed logout persistence without publishing a still-authorized renderer state', async () => {
    const b = await nativeBrokerBench((_request, response) => { response.end() })
    const subject = bridgeFixture(b.controller)
    vi.spyOn(b.store, 'disable').mockImplementationOnce(() => { throw new Error('Isolated logout write failure') })
    expect(await subject.invoke({ kind: 'sign-out' })).toMatchObject({
      ok: false, failure: { kind: 'logout-storage' }, snapshot: { authenticated: false, phase: 'failed' },
    })
    expect(await subject.invoke({ kind: 'snapshot' })).toMatchObject({
      ok: true, snapshot: { authenticated: false, failure: { kind: 'logout-storage' } },
    })
    expect(b.store.records(b.origin)).toMatchObject([{ phase: 'active' }])
  })

  it('redacts unexpected operation errors and refuses a reply after frame navigation', async () => {
    const b = await nativeBrokerBench((_request, response) => { response.end() })
    const subject = bridgeFixture(b.controller)
    vi.spyOn(b.controller, 'sendCode').mockRejectedValueOnce(new Error(`${b.password} ${String(b.bearer())}`))
    const failed = await subject.invoke({ kind: 'send-code', email: 'broker@example.com' })
    expect(failed).toMatchObject({ ok: false, failure: { kind: 'local' } })
    expect(JSON.stringify(failed)).not.toContain(b.password)
    const release = Promise.withResolvers<{ ok: true; expiresInSec: number }>()
    vi.spyOn(b.controller, 'sendCode').mockImplementationOnce(() => release.promise)
    const running = subject.invoke({ kind: 'send-code', email: 'broker@example.com' })
    subject.frame.url = 'https://external.example/'
    release.resolve({ ok: true, expiresInSec: 600 })
    await expect(running).rejects.toThrow('main frame')
  })

  it('exposes server code expiry and removes handlers without touching the controller', async () => {
    const b = await nativeBrokerBench((_request, response) => { response.end() })
    const subject = bridgeFixture(b.controller)
    vi.spyOn(b.controller, 'sendCode').mockResolvedValueOnce({ ok: true, expiresInSec: 600 })
    expect(await subject.invoke({ kind: 'send-code', email: 'broker@example.com' })).toMatchObject({ ok: true, codeExpirySeconds: 600 })
    subject.disable()
    expect(await subject.invoke({ kind: 'snapshot' })).toMatchObject({ ok: false, failure: { kind: 'unavailable' } })
    subject.bridge.dispose()
    subject.bridge.publish()
    expect(subject.handlers.size).toBe(0)
    expect(subject.send).not.toHaveBeenCalled()
    expect(b.controller.getSnapshot().phase).toBe('signed-in')
  })
})
