/** GUI runner console preparation preserves pipes and fails before restricted execution. */
import { describe, expect, it, vi } from 'vitest'
import type { Win32Bindings } from '../src/ffi.ts'
import { ensureRunnerConsole } from '../src/console.ts'

function fixture(attached = false) {
  const api = {
    getConsoleCP: vi.fn(() => attached ? 65001 : 0),
    getStdHandle: vi.fn((selector: number) => BigInt(-selector)),
    allocConsole: vi.fn(() => 1), getConsoleWindow: vi.fn(() => 90n),
    showWindow: vi.fn(() => 0), setStdHandle: vi.fn((_selector: number, _handle: bigint) => 1),
    getLastError: vi.fn(() => 5), formatMessageW: vi.fn(() => 0),
  }
  return { api, run: () => { ensureRunnerConsole(api as unknown as Win32Bindings) } }
}

describe('runner console', () => {
  it('leaves an existing terminal console and its handles untouched', () => {
    const { api, run } = fixture(true)
    run()
    expect(api.allocConsole).not.toHaveBeenCalled()
    expect(api.getStdHandle).not.toHaveBeenCalled()
    expect(api.showWindow).not.toHaveBeenCalled()
  })
  it('allocates before confinement and restores all redirected handles', () => {
    const { api, run } = fixture()
    run()
    expect(api.showWindow).toHaveBeenCalledWith(90n, 0)
    expect(api.setStdHandle.mock.calls).toEqual([[-10, 10n], [-11, 11n], [-12, 12n]])
    expect(api.getStdHandle.mock.invocationCallOrder[2]).toBeLessThan(api.allocConsole.mock.invocationCallOrder[0]!)
    expect(api.allocConsole.mock.invocationCallOrder[0]).toBeLessThan(api.setStdHandle.mock.invocationCallOrder[0]!)
  })
  it('reports console allocation refusal', () => {
    const { api, run } = fixture()
    api.allocConsole.mockReturnValue(0)
    expect(run).toThrow('AllocConsole')
    expect(api.setStdHandle).not.toHaveBeenCalled()
  })
  it('reports failure to restore redirected handles', () => {
    const { api, run } = fixture()
    api.setStdHandle.mockReturnValue(0)
    expect(run).toThrow('SetStdHandle')
  })
  it('preserves pipes when the console has no local window', () => {
    const { api, run } = fixture()
    api.getConsoleWindow.mockReturnValue(0n)
    run()
    expect(api.showWindow).not.toHaveBeenCalled()
    expect(api.setStdHandle).toHaveBeenCalledTimes(3)
  })
})
