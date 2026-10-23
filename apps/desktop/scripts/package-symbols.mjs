/** Archive desktop compiler maps before electron-builder filters its release copy. */
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/** @param {Buffer} bytes */
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
/** @param {string} path */
const portable = path => path.split(sep).join('/')

/**
 * Preserve maps, generated files and exact source bytes outside the application payload.
 * Missing sources, invalid maps or backup failures reject packaging before any file filtering.
 * @param {{ outDir: string, arch: number, electronPlatformName: string, packager: { info: { appDir: string }, appInfo: { version: string } } }} context Electron-builder beforePack context.
 * @returns {Promise<void>} Resolves after the completed symbol inventory is written.
 */
export default async function beforePack(context) {
  const appDir = await realpath(context.packager.info.appDir)
  await mkdir(context.outDir, { recursive: true })
  const output = await realpath(context.outDir)
  const symbols = join(output, 'symbols')
  await mkdir(symbols, { recursive: true })
  const destination = await mkdtemp(join(symbols, 'desktop-'))
  /** @type {Array<{map: {path: string, sha256: string, bytes: number}, generated: {path: string, sha256: string, bytes: number}, sources: Array<{path: string, sha256: string, bytes: number}>}>} */
  const entries = []
  const files = new Map()
  /** @param {string} path */
  async function preserve(path) {
    const actual = await realpath(path)
    const local = relative(appDir, actual)
    if (isAbsolute(local) || local === '..' || local.startsWith(`..${sep}`)) {
      throw new Error(`Desktop symbol source escapes the application directory: ${path}`)
    }
    const bytes = await readFile(actual)
    const key = portable(relative(appDir, path))
    const hash = digest(bytes)
    if (files.has(key) && files.get(key) !== hash) throw new Error(`Desktop symbol source changed during backup: ${key}`)
    const target = join(destination, key)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, bytes)
    if (digest(await readFile(target)) !== hash) throw new Error(`Desktop symbol backup digest mismatch: ${key}`)
    files.set(key, hash)
    return { path: key, sha256: hash, bytes: bytes.length }
  }
  /** @param {string} directory */
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`Desktop lib contains a symbolic link: ${path}`)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile() && /\.(js|d\.ts)\.map$/.test(entry.name)) {
        const map = JSON.parse(await readFile(path, 'utf8'))
        if (map.version !== 3 || !Array.isArray(map.sources) || map.sources.length === 0
          || map.sources.some((/** @type {unknown} */ source) => typeof source !== 'string')
          || (map.sourceRoot !== undefined && map.sourceRoot !== '')) {
          throw new Error(`Desktop compiler map has unsupported source locations: ${path}`)
        }
        const sources = []
        for (const source of map.sources) sources.push(await preserve(resolve(dirname(path), source)))
        entries.push({ map: await preserve(path), generated: await preserve(path.slice(0, -4)), sources })
      }
    }
  }
  await visit(join(appDir, 'lib'))
  await writeFile(join(destination, 'manifest.json'), `${JSON.stringify({
    formatVersion: 1,
    applicationVersion: context.packager.appInfo.version,
    platform: context.electronPlatformName,
    arch: context.arch,
    entries,
  }, null, 2)}\n`)
}
