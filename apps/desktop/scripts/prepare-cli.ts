/** Materialize the fixed CLI package and its locked production dependencies as desktop resources. */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { z } from 'zod'

const desktop = resolve(import.meta.dirname, '..')
const source = join(desktop, 'cli-runtime')
const archive = await readFile(join(source, 'manturhub-cli-1.1.4.tgz'))
const sha256 = createHash('sha256').update(archive).digest('hex')
if (sha256 !== '2d27ab31ce1de4dbd1032f82f63a983539300fbb9598ca6cb78a79233af2473c') {
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
z.object({ name: z.literal('@manturhub/cli'), version: z.literal('1.1.4'), license: z.literal('MIT') })
  .parse(JSON.parse(await readFile(join(cli, 'package.json'), 'utf8')) as unknown)
await readFile(join(cli, 'LICENSE'))
await writeFile(join(output, 'source.json'), JSON.stringify({
  formatVersion: 1, package: '@manturhub/cli', version: '1.1.4',
  sourceCommit: '1caaf98213982c5f811c62967ef6c757b9649062', archiveSha256: sha256,
}, null, 2) + '\n')
console.log('Prepared embedded Mantur CLI 1.1.4 from the verified archive and lockfile')
