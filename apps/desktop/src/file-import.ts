/** Durable local copies of files and directory trees explicitly selected by the user. */
import { copyFile, lstat, mkdir, mkdtemp, readdir, realpath, rm } from 'node:fs/promises'
import { basename, isAbsolute, join, relative } from 'node:path'

/** A copied attachment that remains readable after its original is moved. */
export interface ImportedFile {
  name: string
  path: string
  kind: 'file' | 'directory'
}

async function copyEntry(source: string, target: string): Promise<void> {
  const stat = await lstat(source)
  if (stat.isSymbolicLink()) throw new Error(`Symbolic links cannot be imported: ${source}`)
  if (stat.isFile()) { await copyFile(source, target); return }
  if (!stat.isDirectory()) throw new Error(`Not a regular file or directory: ${source}`)
  await mkdir(target)
  for (const name of await readdir(source)) await copyEntry(join(source, name), join(target, name))
}

/**
 * Copy a complete batch into unique private directories, preserving names and nested paths.
 * @param root - Application-owned attachment storage.
 * @param sources - Absolute paths obtained from a native drop or file dialog.
 * @returns Copied entries only after every copy succeeds; failed batches are removed.
 */
export async function importLocalFiles(root: string, sources: readonly string[]): Promise<ImportedFile[]> {
  if (sources.some(source => !isAbsolute(source) || source.includes('\0') || basename(source) === '')) {
    throw new Error('File import requires absolute non-root paths')
  }
  if (sources.length === 0) return []
  await mkdir(root, { recursive: true, mode: 0o700 })
  const resolvedRoot = await realpath(root)
  for (const source of sources) {
    if ((await lstat(source)).isSymbolicLink()) throw new Error(`Symbolic links cannot be imported: ${source}`)
    const relation = relative(await realpath(source), resolvedRoot)
    if (relation === '' || (!relation.startsWith('..') && !isAbsolute(relation))) {
      throw new Error('Cannot import a directory containing attachment storage')
    }
  }
  const batch = await mkdtemp(join(root, 'batch-'))
  try {
    const result: ImportedFile[] = []
    for (const [index, source] of sources.entries()) {
      const parent = join(batch, String(index))
      await mkdir(parent, { mode: 0o700 })
      const name = basename(source)
      const path = join(parent, name)
      await copyEntry(source, path)
      result.push({ name, path, kind: (await lstat(path)).isDirectory() ? 'directory' : 'file' })
    }
    return result
  } catch (error) {
    await rm(batch, { recursive: true })
    throw error
  }
}
