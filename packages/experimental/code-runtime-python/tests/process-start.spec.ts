import { afterEach, describe, expect, it, vi } from 'vitest'

const { readStat } = vi.hoisted(() => ({ readStat: vi.fn<(path: string, encoding: string) => string>() }))
vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>()
  return {
    ...original,
    readFileSync(...args: Parameters<typeof original.readFileSync>) {
      if (args[0] === '/proc/123/stat' && args[1] === 'utf8') return readStat(args[0], args[1])
      return original.readFileSync(...args)
    },
  }
})

const { readProcessStart } = await import('../src/index.ts')
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!

afterEach(() => {
  Object.defineProperty(process, 'platform', platform)
  readStat.mockReset()
})

describe('process start identity from proc stat', () => {
  it('reads field 22 after a command name containing spaces and closing parentheses', () => {
    Object.defineProperty(process, 'platform', { ...platform, value: 'linux' })
    const fields = ['S', ...Array.from({ length: 18 }, (_, index) => String(index + 4)), '987654321', '4096']
    readStat.mockReturnValue(`123 (python worker) (child)) ${fields.join(' ')}\n`)

    expect(readProcessStart(123)).toBe('987654321')
    expect(readStat).toHaveBeenCalledExactlyOnceWith('/proc/123/stat', 'utf8')
  })

  it('returns no identity when the process entry disappeared before the read', () => {
    Object.defineProperty(process, 'platform', { ...platform, value: 'linux' })
    readStat.mockImplementation(() => { throw Object.assign(new Error('process exited'), { code: 'ENOENT' }) })

    expect(readProcessStart(123)).toBeUndefined()
    expect(readStat).toHaveBeenCalledExactlyOnceWith('/proc/123/stat', 'utf8')
  })

  it('does not consult proc stat on hosts without the Linux process filesystem', () => {
    Object.defineProperty(process, 'platform', { ...platform, value: 'darwin' })

    expect(readProcessStart(123)).toBeUndefined()
    expect(readStat).not.toHaveBeenCalled()
  })
})
