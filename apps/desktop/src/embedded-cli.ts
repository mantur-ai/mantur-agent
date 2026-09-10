/** Profile-local CLI launchers use the application's Node runtime and Main-managed identity. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { delimiter, isAbsolute, join } from 'node:path'
import { z } from 'zod'

/** Exact app resources and profile location selected by Electron Main. */
export interface EmbeddedCliOptions {
  readonly resourceRoot: string
  readonly userData: string
  readonly executable: string
  readonly platform: 'darwin' | 'win32'
}

const quote = (value: string): string => "'" + value.replaceAll("'", "'\\''") + "'"

/**
 * Write the platform's CLI launcher only after validating the packaged CLI resource.
 * @param options - Main-owned resource directory, runtime executable and profile.
 * @returns directory to prepend to the supervised Host's PATH.
 */
export async function prepareEmbeddedCli(options: EmbeddedCliOptions): Promise<string> {
  if (![options.resourceRoot, options.userData, options.executable].every(isAbsolute)) {
    throw new Error('Embedded CLI requires absolute application paths')
  }
  const manifest = JSON.parse(await readFile(join(options.resourceRoot, 'source.json'), 'utf8')) as unknown
  z.strictObject({ formatVersion: z.literal(1), package: z.literal('@manturhub/cli'), version: z.literal('0.11.0'),
    sourceCommit: z.literal('c43f29eba2f6e63ac37f64a6a51a70b76a533d2d'),
    archiveSha256: z.literal('44e93ee513e9cad0805679209e27298b85dfdd9d7a1537d535c660206bd14013'),
  }).parse(manifest)
  const entry = join(options.resourceRoot, 'node_modules/@manturhub/cli/bin/cli.js')
  await readFile(entry)
  const bin = join(options.userData, 'managed-cli-bin')
  await mkdir(bin, { recursive: true, mode: 0o700 })
  const variables = ['ELECTRON_RUN_AS_NODE=1', 'NODE_OPTIONS=', 'MANTURHUB_IDENTITY_MODE=desktop-managed',
    'MANTURHUB_DISABLE_UPDATE_CHECK=1', 'MANTURHUB_DISABLE_SKILL_UPDATE_CHECK=1']
  if (options.platform === 'darwin') {
    await writeFile(join(bin, 'manturhub'), '#!/bin/sh\n' + variables.map(value => 'export ' + value).join('\n')
      + '\nexec ' + quote(options.executable) + ' ' + quote(entry) + ' "$@"\n', { mode: 0o700 })
  } else {
    // Windows file names cannot contain quotes or line breaks; percent signs need batch-file escaping.
    if ([options.executable, entry].some(value => /["\r\n]/u.test(value))) throw new Error('Embedded CLI Windows path is invalid')
    const escape = (value: string): string => value.replaceAll('%', '%%')
    await writeFile(join(bin, 'manturhub.cmd'), '@echo off\r\nsetlocal DisableDelayedExpansion\r\n'
      + variables.map(value => 'set "' + value + '"').join('\r\n') + '\r\n"'
      + escape(options.executable) + '" "' + escape(entry) + '" %*\r\nexit /b %errorlevel%\r\n')
  }
  return bin
}

/**
 * Put the embedded launcher ahead of ambient CLI installations without creating a global command.
 * @param bin - profile-local directory returned by prepareEmbeddedCli.
 * @param ambient - Main's environment before its supervised child is launched.
 * @returns copied environment with one PATH key and desktop-managed identity.
 */
export function embeddedCliEnvironment(bin: string, ambient: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const entries = Object.entries(ambient)
  const path = entries.find(([key]) => key.toUpperCase() === 'PATH')?.[1]
  const environment = Object.fromEntries(entries.filter(([key]) => key.toUpperCase() !== 'PATH'))
  environment.PATH = bin + (path === undefined ? '' : delimiter + path)
  environment.MANTURHUB_IDENTITY_MODE = 'desktop-managed'
  return environment
}
