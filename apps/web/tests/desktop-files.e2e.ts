/** Native transport fixture over the real Loader, composer and local attachment storage. */
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { expect, it } from 'vitest'
import { importLocalFiles } from '../../desktop/src/file-import.ts'
import { launchWebScaffold, seedSession } from './scaffold.ts'

it('imports a folder and dropped script through the real composer and preserves their bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mantur-files-browser-'))
  let browser: Browser | undefined
  let server: Awaited<ReturnType<typeof launchWebScaffold>> | undefined
  try {
    const folder = join(root, '剧本和素材')
    await mkdir(folder)
    await writeFile(join(folder, '剧本.docx'), Buffer.from([0x50, 0x4b, 3, 4]))
    const script = join(root, '第一集.md')
    await writeFile(script, '# 第一集\n开场')
    const imported: string[] = []
    browser = await chromium.launch()
    server = await launchWebScaffold()
    const fixture = fileURLToPath(new URL('../../../snapshots/web/fresh-round-trip/session.jsonl', import.meta.url))
    await seedSession(server, await readFile(fixture, 'utf8'), 'desktop-files-fixture')
    const page = await browser.newPage({ locale: 'en-US' })
    await page.exposeFunction('testNativeImport', async (kind: string) => {
      const refs = await importLocalFiles(join(root, 'stored'), [kind === 'directory' ? folder : script])
      imported.push(...refs.map(ref => ref.path))
      return refs
    })
    await page.addInitScript(() => {
      const host = window as unknown as { testNativeImport: (kind: string) => Promise<unknown> }
      Object.assign(window, { manturFiles: {
        pick: (kind: string) => host.testNativeImport(kind),
        importFiles: () => host.testNativeImport('file'),
      } })
    })
    await page.goto(server.authenticatedUrl)
    await page.getByRole('treeitem').first().click()
    await page.getByRole('treeitem').nth(1).click()
    const input = page.locator('[data-composer-input][contenteditable="true"]')
    await input.waitFor()
    await input.fill('Read these materials')
    await page.getByRole('button', { name: 'Add folder', exact: true }).click()
    await expect.poll(() => input.textContent()).toContain('剧本和素材')
    await input.evaluate((element) => {
      const transfer = new DataTransfer()
      transfer.items.add(new File(['# 第一集'], '第一集.md', { type: 'text/markdown' }))
      element.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }))
    })
    await expect.poll(() => input.textContent()).toContain('第一集.md')
    expect(imported).toHaveLength(2)
    expect(await readFile(join(imported[0]!, '剧本.docx'))).toEqual(Buffer.from([0x50, 0x4b, 3, 4]))
    expect(await readFile(imported[1]!, 'utf8')).toBe('# 第一集\n开场')
    expect(await input.textContent()).toContain('Read these materials')
  } finally {
    await browser?.close()
    await server?.close()
    await rm(root, { recursive: true, force: true })
  }
}, 120_000)
