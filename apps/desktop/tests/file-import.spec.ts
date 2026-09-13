import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { importLocalFiles } from '../src/file-import.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'mantur-import-test-'))
  roots.push(root)
  return { root, target: join(root, 'attachments') }
}

describe('native attachment import', () => {
  it('preserves nested Chinese names, Markdown and Word bytes, and empty directories', async () => {
    const { root, target } = await setup()
    const folder = join(root, '她带五崽种葡萄 资产+剧本')
    await mkdir(join(folder, '素材', '空目录'), { recursive: true })
    await writeFile(join(folder, '剧本.md'), '# 第一集\n剧本内容')
    const word = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 255])
    await writeFile(join(folder, '素材', '剧本.doc'), word)
    const [result] = await importLocalFiles(target, [folder])
    expect(result?.kind).toBe('directory')
    expect(await readFile(join(result!.path, '剧本.md'), 'utf8')).toBe('# 第一集\n剧本内容')
    expect(await readFile(join(result!.path, '素材', '剧本.doc'))).toEqual(word)
    expect(await readdir(join(result!.path, '素材', '空目录'))).toEqual([])
    expect(await readFile(join(folder, '剧本.md'), 'utf8')).toBe('# 第一集\n剧本内容')
  })
  it('keeps same-name files distinct across one batch and repeated imports', async () => {
    const { root, target } = await setup()
    const file = join(root, 'script.docx')
    await writeFile(file, 'bytes')
    const first = await importLocalFiles(target, [file, file])
    const next = await importLocalFiles(target, [file])
    expect(new Set([...first, ...next].map(entry => entry.path)).size).toBe(3)
  })
  it('rejects invalid paths and removes partial batches without touching originals', async () => {
    const { root, target } = await setup()
    await expect(importLocalFiles(target, ['relative.md'])).rejects.toThrow('absolute')
    const file = join(root, 'script.md')
    await writeFile(file, 'original')
    await expect(importLocalFiles(target, [file, join(root, 'missing')])).rejects.toThrow()
    expect(await readdir(target)).toEqual([])
    expect(await readFile(file, 'utf8')).toBe('original')
  })
  it('rejects symlinks instead of importing unrelated trees', async () => {
    const { root, target } = await setup()
    const link = join(root, 'link')
    await symlink(root, link, 'junction')
    await expect(importLocalFiles(target, [link])).rejects.toThrow('Symbolic links')
    expect(await readdir(target)).toEqual([])
  })
})
