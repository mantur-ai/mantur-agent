/** The isolated preload derives activation itself and never accepts a renderer authorization flag. */
import { afterEach, expect, it, vi } from 'vitest'
const exposed = vi.hoisted(() => new Map<string, unknown>())
const invoke = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: (name: string, value: unknown) => { exposed.set(name, value) } },
  ipcRenderer: { invoke }, webUtils: {},
}))
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); invoke.mockClear() })
it('rejects synthetic selection even with a supplied activation flag and permits a real active document', async () => {
  const activation = { isActive: false }
  vi.stubGlobal('navigator', { userActivation: activation })
  await import('../src/preload.ts')
  const bridge = exposed.get('manturCutExport') as { invoke(value: unknown): Promise<unknown> }
  await expect(bridge.invoke({ op: 'pick', userActivation: true })).rejects.toThrow('user action')
  expect(invoke).not.toHaveBeenCalled()
  activation.isActive = true
  await bridge.invoke({ op: 'pick' })
  expect(invoke).toHaveBeenCalledExactlyOnceWith('mantur:cut-export:invoke', { op: 'pick' })
})
