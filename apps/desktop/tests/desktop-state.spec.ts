/** Desktop-owned data paths and explicit cache recovery. */

import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, parse, relative } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  canResetProjectionCache,
  desktopPaths,
  desktopUserDataPath,
  initializeDesktopPaths,
  prepareDesktopPaths,
  resetProjectionCache,
} from '../src/desktop-state.ts'

const roots: string[] = []

function pathApplication(appData: string, isPackaged = true) {
  const values = new Map<string, string>([['appData', appData]])
  return {
    isPackaged,
    getPath: (name: string) => {
      const value = values.get(name)
      if (value === undefined) throw new Error(`test application path is unset: ${name}`)
      return value
    },
    setPath: vi.fn((name: string, path: string) => { values.set(name, path) }),
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('desktop state', () => {
  it('isolates Harness data and process files below stable application data', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mantur-desktop-state-'))
    roots.push(root)
    const userData = desktopUserDataPath(root)
    const paths = desktopPaths(userData)

    expect(paths).toEqual({
      userData: join(root, 'mantur-agent'),
      dshHome: join(root, 'mantur-agent', 'harness'),
      launchRoot: join(root, 'mantur-agent', 'launch-root'),
      logPath: join(root, 'mantur-agent', 'logs', 'harness.log'),
    })
    await prepareDesktopPaths(paths)
    await expect(mkdir(paths.dshHome)).rejects.toMatchObject({ code: 'EEXIST' })
    await expect(mkdir(paths.launchRoot)).rejects.toMatchObject({ code: 'EEXIST' })
  })

  it('keeps development data separate from installed application data', () => {
    expect(desktopUserDataPath('/application-data', 'development')).toBe(
      join('/application-data', 'mantur-agent-dev'),
    )
    expect(desktopUserDataPath('/application-data', 'release')).toBe(
      join('/application-data', 'mantur-agent'),
    )
  })

  it.each([true, false])('preserves default Electron path setup when packaged is %s', (isPackaged) => {
    const application = pathApplication('/application-data', isPackaged)
    const paths = initializeDesktopPaths(application)
    const expected = desktopUserDataPath('/application-data', isPackaged ? 'release' : 'development')
    expect(paths).toEqual(desktopPaths(expected))
    expect(application.setPath).toHaveBeenCalledExactlyOnceWith('userData', expected)
  })

  it('keeps two explicit profiles, browser caches, and Harness homes independent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mantur-desktop-state-'))
    roots.push(root)
    const appData = join(root, 'default-app-data')
    const selected = []
    for (const name of ['first', 'second']) {
      const application = pathApplication(appData)
      const directory = join(root, name)
      const paths = initializeDesktopPaths(application, directory)
      await prepareDesktopPaths(paths)
      await writeFile(join(paths.dshHome, 'fixture.txt'), name)
      expect(application.getPath('sessionData')).toBe(directory)
      selected.push(Object.fromEntries(
        (['userData', 'dshHome', 'launchRoot', 'logPath'] as const)
          .map(key => [key, relative(root, paths[key]).replaceAll('\\', '/')]),
      ))
    }
    expect(selected).toMatchInlineSnapshot(`
      [
        {
          "dshHome": "first/harness",
          "launchRoot": "first/launch-root",
          "logPath": "first/logs/harness.log",
          "userData": "first",
        },
        {
          "dshHome": "second/harness",
          "launchRoot": "second/launch-root",
          "logPath": "second/logs/harness.log",
          "userData": "second",
        },
      ]
    `)
    await expect(readFile(join(root, 'first/harness/fixture.txt'), 'utf8')).resolves.toBe('first')
    await expect(readFile(join(root, 'second/harness/fixture.txt'), 'utf8')).resolves.toBe('second')
    await expect(access(appData)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each(['', ' ', 'relative/profile', '../profile', parse(tmpdir()).root, `${tmpdir()}\0profile`])('rejects explicit value %j before changing or creating default storage', async (configured) => {
    const root = await mkdtemp(join(tmpdir(), 'mantur-desktop-state-'))
    roots.push(root)
    const appData = join(root, 'default-app-data')
    const application = pathApplication(appData)
    expect(() => initializeDesktopPaths(application, configured)).toThrow('--user-data-dir requires an absolute non-root directory')
    expect(application.setPath).not.toHaveBeenCalled()
    await expect(access(appData)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('fails on a file target without using default storage', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mantur-desktop-state-'))
    roots.push(root)
    const appData = join(root, 'default-app-data')
    const file = join(root, 'file')
    await writeFile(file, 'unchanged fixture')
    const application = pathApplication(appData)
    expect(() => initializeDesktopPaths(application, file)).toThrow()
    expect(application.setPath).not.toHaveBeenCalled()
    await expect(readFile(file, 'utf8')).resolves.toBe('unchanged fixture')
    await expect(access(appData)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('removes only current and legacy projection caches after approval', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mantur-desktop-state-'))
    roots.push(root)
    const dshHome = join(root, 'harness')
    const current = join(dshHome, 'storages', 'session_projcache', 'sessions', 'stale.json')
    const legacy = join(dshHome, 'storages', 'session_projcache.json')
    const session = join(dshHome, 'sessions', 'keep.jsonl')
    await Promise.all([
      mkdir(join(current, '..'), { recursive: true }),
      mkdir(join(session, '..'), { recursive: true }),
    ])
    await Promise.all([
      writeFile(current, 'stale'),
      writeFile(legacy, 'legacy'),
      writeFile(session, 'session'),
    ])

    await resetProjectionCache(dshHome)

    await expect(readFile(current)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(legacy)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(session, 'utf8')).resolves.toBe('session')
  })

  it('recognizes only the projection-cache schema failure and refuses broad roots', async () => {
    expect(canResetProjectionCache(new Error(
      "domain 'session_projcache': stored record 'x' does not match its schema",
    ))).toBe(true)
    expect(canResetProjectionCache(new Error('another startup failure'))).toBe(false)
    await expect(resetProjectionCache('/tmp/not-desktop-data')).rejects.toThrow(
      'refusing to reset projection cache outside a desktop Harness home',
    )
  })
})
