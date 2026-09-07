import { describe, expect, it } from 'vitest'
import { macApplicationPath, parseMacArchitecture } from './create-macos-dmg.ts'

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
