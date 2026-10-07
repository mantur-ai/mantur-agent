/** Materialize the fixed CLI package and its locked production dependencies as desktop resources. */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { z } from 'zod'

const desktop = resolve(import.meta.dirname, '..')
const source = join(desktop, 'cli-runtime')
const archive = await readFile(join(source, 'manturhub-cli-1.2.6.tgz'))
const sha256 = createHash('sha256').update(archive).digest('hex')
if (sha256 !== '98d2eefe59566b220950ac201f7ad133c47e469e3e0dfcad180027d6a623f86d') {
  throw new Error('Embedded Mantur CLI archive does not match its reviewed source')
}
const options = { cwd: source, stdio: 'inherit' as const }
if (process.platform === 'win32') execFileSync('cmd.exe', ['/d', '/s', '/c', 'npm.cmd ci --omit=dev'], options)
else execFileSync('npm', ['ci', '--omit=dev'], options)
const output = join(desktop, '.generated/mantur-cli')
await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
await cp(join(source, 'node_modules'), join(output, 'node_modules'), { recursive: true })
await rm(join(output, 'node_modules/.bin'), { recursive: true, force: true })
const cli = join(output, 'node_modules/@manturhub/cli')
z.object({ name: z.literal('@manturhub/cli'), version: z.literal('1.2.6'), license: z.literal('MIT') })
  .parse(JSON.parse(await readFile(join(cli, 'package.json'), 'utf8')) as unknown)
await readFile(join(cli, 'LICENSE'))
await writeFile(join(output, 'source.json'), JSON.stringify({
  formatVersion: 1, package: '@manturhub/cli', version: '1.2.6',
  sourceCommit: 'c9b569d198f1b65690a28b5b1f2584b9c2e76f82', archiveSha256: sha256,
}, null, 2) + '\n')
console.log('Prepared embedded Mantur CLI 1.2.6 from the verified archive and lockfile')
