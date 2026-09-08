import { spawnSync } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMacMountPoint, macApplicationPath, parseMacArchitecture } from './create-macos-dmg.ts'

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }))
vi.mock('node:fs/promises', async importOriginal => ({
  ...await importOriginal<typeof import('node:fs/promises')>(),
  mkdtemp: vi.fn(),
}))

describe('macOS DMG inputs', () => {
  it('requires one supported architecture', () => {
    expect(parseMacArchitecture(['--arch', 'arm64'])).toBe('arm64')
    expect(parseMacArchitecture(['--arch', 'x64'])).toBe('x64')
    expect(() => parseMacArchitecture(['--arch', 'ia32'])).toThrow('Unsupported macOS architecture')
    expect(() => parseMacArchitecture([])).toThrow('Usage:')
  })

  it('uses electron-builder unpacked directory names', () => {
    expect(macApplicationPath('/desktop', 'arm64')).toBe('/desktop/dist/mac-arm64/漫途Agent.app')
    expect(macApplicationPath('/desktop', 'x64')).toBe('/desktop/dist/mac/漫途Agent.app')
  })
})

describe('macOS DMG mount directory', () => {
  beforeEach(() => { vi.resetAllMocks() })

  function getconfResult(stdout: string, status = 0, error?: Error): void {
    vi.mocked(spawnSync).mockReturnValue({ pid: 1, output: [null, stdout, ''], stdout, stderr: '', status, signal: null, ...(error === undefined ? {} : { error }) })
  }

  it('uses the macOS user temporary directory instead of an external build directory', async () => {
    getconfResult('/var/folders/user/T/\n')
    vi.mocked(mkdtemp).mockResolvedValue('/var/folders/user/T/mantur-dmg-mount-unique')
    await expect(createMacMountPoint()).resolves.toBe('/var/folders/user/T/mantur-dmg-mount-unique')
    expect(spawnSync).toHaveBeenCalledWith('getconf', ['DARWIN_USER_TEMP_DIR'], { encoding: 'utf8' })
    expect(mkdtemp).toHaveBeenCalledExactlyOnceWith('/var/folders/user/T/mantur-dmg-mount-')
  })

  it.each([['', 0], ['relative/path', 0], ['/var/folders/user/T/', 1]])('rejects unusable getconf output %j with status %i', async (stdout, status) => {
    getconfResult(stdout, status)
    await expect(createMacMountPoint()).rejects.toThrow('Could not resolve macOS user temporary directory')
    expect(mkdtemp).not.toHaveBeenCalled()
  })

  it('propagates command launch failures without creating a directory', async () => {
    const error = new Error('getconf could not start')
    getconfResult('', 1, error)
    await expect(createMacMountPoint()).rejects.toBe(error)
    expect(mkdtemp).not.toHaveBeenCalled()
  })

  it('propagates temporary-directory creation failure without another path attempt', async () => {
    getconfResult('/var/folders/user/T/\n')
    const error = new Error('permission denied')
    vi.mocked(mkdtemp).mockRejectedValue(error)
    await expect(createMacMountPoint()).rejects.toBe(error)
    expect(mkdtemp).toHaveBeenCalledTimes(1)
  })
})
