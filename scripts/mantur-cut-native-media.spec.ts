/** Candidate identity and loader paths keep CLI and compositor FFmpeg ABIs separate. */

import { createHash } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { installNativeMedia, nativeMediaDependency, verifyNativeMediaDefaults, verifyNativeMediaInventory, windowsMediaDependencies } from './mantur-cut-native-media.ts'

const directories: string[] = []
async function temporary(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'mantur-native-media-'))
  directories.push(directory)
  return directory
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('reviewed native media', () => {
  it('checks PE x64 imports against sibling DLLs and the actual Windows system', () => {
    const files = new Set(['compositor/remotion.exe', 'compositor/avcodec-61.dll'])
    const system = new Set(['kernel32.dll'])
    const output = (name: string) => `file format pei-x86-64\n\tDLL Name: ${name}\n`
    expect(windowsMediaDependencies('compositor/remotion.exe', output('AVCODEC-61.dll') + '\tDLL Name: KERNEL32.dll\n', files, system)).toEqual(['AVCODEC-61.dll', 'KERNEL32.dll'])
    expect(windowsMediaDependencies('bin/ffmpeg.exe', output('api-ms-win-crt-runtime-l1-1-0.dll'), files, system)).toHaveLength(1)
    for (const [binary, text] of [
      ['bin/ffmpeg.exe', output('avcodec-61.dll')],
      ['compositor/remotion.exe', output('unreviewed.dll')],
      ['compositor/remotion.exe', output('../avcodec-61.dll')],
      ['compositor/remotion.exe', output('folder\\avcodec-61.dll')],
      ['compositor/remotion.exe', output('KERNEL32.dll').replace('pei-x86-64', 'pei-i386')],
      ['compositor/remotion.exe', 'file format pei-x86-64\n'],
    ]) expect(() => windowsMediaDependencies(binary!, text!, files, system)).toThrow()
  })

  it('resolves each ABI only within its owned library directory', () => {
    const files = new Set(['lib/libavutil.58.dylib', 'compositor/libavutil.dylib'])
    expect(nativeMediaDependency('bin/ffmpeg', '@loader_path/../lib/libavutil.58.dylib', files)).toBe('lib/libavutil.58.dylib')
    expect(nativeMediaDependency('compositor/ffprobe', '@loader_path/../lib/libavutil.58.dylib', files)).toBe('lib/libavutil.58.dylib')
    expect(nativeMediaDependency('compositor/remotion', '@loader_path/libavutil.dylib', files)).toBe('compositor/libavutil.dylib')
    expect(nativeMediaDependency('lib/libavcodec.60.dylib', '@loader_path/libavutil.58.dylib', files)).toBe('lib/libavutil.58.dylib')
    expect(nativeMediaDependency('bin/ffmpeg', '/usr/lib/libSystem.B.dylib', files)).toBe('/usr/lib/libSystem.B.dylib')
    for (const [binary, dependency] of [
      ['compositor/ffprobe', '@loader_path/libavutil.dylib'],
      ['compositor/remotion', '@loader_path/../lib/libavutil.58.dylib'],
      ['bin/ffmpeg', '@loader_path/../../outside.dylib'],
      ['bin/ffmpeg', '@loader_path/../lib/libavcodec.60.dylib'],
      ['bin/ffmpeg', '/opt/homebrew/lib/libavutil.dylib'],
      ['bin/ffmpeg', '/usr/lib/../../Applications/unreviewed.dylib'],
      ['bin/ffmpeg', '/System/Library/../../opt/unreviewed.dylib'],
      ['bin/ffmpeg', '@rpath/libavutil.58.dylib'],
    ]) expect(() => nativeMediaDependency(binary!, dependency!, files)).toThrow('Unresolved native media dependency')
  })

  it('rejects changed, extra, missing and linked candidate files', async () => {
    const directory = await temporary()
    const path = join(directory, 'file')
    await writeFile(path, 'approved')
    const expected = { file: createHash('sha256').update('approved').digest('hex') }
    await expect(verifyNativeMediaInventory(directory, expected)).resolves.toEqual(expected)
    await writeFile(path, 'changed')
    await expect(verifyNativeMediaInventory(directory, expected)).rejects.toThrow('digest does not match')
    await writeFile(path, 'approved')
    await writeFile(join(directory, 'extra'), '')
    await expect(verifyNativeMediaInventory(directory, expected)).rejects.toThrow('file inventory does not match')
    await rm(join(directory, 'extra'))
    await rm(path)
    await expect(verifyNativeMediaInventory(directory, expected)).rejects.toThrow('file inventory does not match')
    if (process.platform !== 'win32') {
      await symlink('/etc/hosts', path)
      await expect(verifyNativeMediaInventory(directory, expected)).rejects.toThrow('only files and directories')
    }
  })

  it.skipIf(process.platform === 'win32')('preserves both library trees and default npm aliases without changing the candidate', async () => {
    const directory = await temporary()
    const candidate = join(directory, 'candidate')
    const runtime = join(directory, 'runtime')
    const files = ['bin/ffmpeg', 'bin/ffprobe', 'lib/libavutil.58.dylib', 'compositor/remotion', 'compositor/libavutil.dylib']
    const expected: Record<string, string> = {}
    for (const path of files) {
      await mkdir(dirname(join(candidate, path)), { recursive: true })
      await writeFile(join(candidate, path), path)
      expected[path] = createHash('sha256').update(path).digest('hex')
    }
    await installNativeMedia(candidate, runtime, expected)
    await expect(verifyNativeMediaInventory(candidate, expected)).resolves.toEqual(expected)
    expect(await realpath(join(runtime, 'node_modules/@remotion/compositor-darwin-arm64'))).toBe(await realpath(join(runtime, 'native-media/compositor')))
    expect(await readFile(join(runtime, 'node_modules/ffmpeg-static/ffmpeg'), 'utf8')).toBe('bin/ffmpeg')
    expect(await readFile(join(runtime, 'node_modules/@ffprobe-installer/darwin-arm64/ffprobe'), 'utf8')).toBe('bin/ffprobe')
    expect(await readFile(join(runtime, 'native-media/lib/libavutil.58.dylib'), 'utf8')).toBe('lib/libavutil.58.dylib')
    expect(await readFile(join(runtime, 'native-media/compositor/libavutil.dylib'), 'utf8')).toBe('compositor/libavutil.dylib')
  })

  it('installs Windows npm defaults as exact owned copies without symlink privileges', async () => {
    const directory = await temporary()
    const candidate = join(directory, 'candidate')
    const runtime = join(directory, 'runtime')
    const contents = {
      'bin/ffmpeg.exe': 'CLI ffmpeg', 'bin/ffprobe.exe': 'CLI ffprobe',
      'compositor/remotion.exe': 'remotion', 'compositor/avutil-59.dll': 'LGPL DLL',
      'compositor/package.json': '{"name":"@remotion/compositor-win32-x64-msvc"}',
    }
    const expected: Record<string, string> = {}
    for (const [path, content] of Object.entries(contents)) {
      await mkdir(dirname(join(candidate, path)), { recursive: true })
      await writeFile(join(candidate, path), content)
      expected[path] = createHash('sha256').update(content).digest('hex')
    }
    for (const [path, content] of [
      ['ffmpeg-static/index.js', "module.exports = require('path').join(__dirname, 'ffmpeg.exe')"],
      ['@ffprobe-installer/ffprobe/index.js', "exports.path = require('path').join(__dirname, '../win32-x64/ffprobe.exe')"],
    ]) {
      const file = join(runtime, 'node_modules', path!)
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, content!)
    }
    await installNativeMedia(candidate, runtime, expected, 'win32-x64')
    const compositor = join(runtime, 'node_modules/@remotion/compositor-win32-x64-msvc')
    expect((await lstat(compositor)).isSymbolicLink()).toBe(false)
    expect((await lstat(join(runtime, 'node_modules/ffmpeg-static/ffmpeg.exe'))).isFile()).toBe(true)
    await expect(verifyNativeMediaDefaults(runtime, 'win32-x64')).resolves.toBeUndefined()
    await expect(verifyNativeMediaInventory(candidate, expected)).resolves.toEqual(expected)
    await writeFile(join(compositor, 'avutil-59.dll'), 'unreviewed DLL')
    await expect(verifyNativeMediaDefaults(runtime, 'win32-x64')).rejects.toThrow('digest does not match')
    await writeFile(join(compositor, 'avutil-59.dll'), 'LGPL DLL')
    await writeFile(join(runtime, 'node_modules/ffmpeg-static/ffmpeg.exe'), 'unreviewed CLI')
    await expect(verifyNativeMediaDefaults(runtime, 'win32-x64')).rejects.toThrow('fallback differs from its candidate')
  })
})
