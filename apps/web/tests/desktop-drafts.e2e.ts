/** Native draft fixture over real Loader composition and two independent browser origins; no installer runs. */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { expect, it } from 'vitest'
import { DesktopDraftStorage } from '../../desktop/src/draft-storage.ts'
import { launchWebScaffold, seedSession } from './scaffold.ts'

const fixture = fileURLToPath(new URL('../../../snapshots/web/fresh-round-trip/session.jsonl', import.meta.url))
const png = fileURLToPath(new URL('../../../snapshots/session/read-image/workspace/red.png', import.meta.url))
const sessionId = 'native-draft-fixture'

/** Expose a clearly test-owned native transport backed by real isolated disk writes. */
async function installNativeFixture(page: Page, storage: DesktopDraftStorage): Promise<void> {
  await page.exposeFunction('testDraftLoad', () => storage.committed())
  await page.exposeFunction('testDraftSave', (value: unknown) => storage.save(value))
  await page.addInitScript(() => {
    const host = window as unknown as {
      testDraftLoad: () => Promise<unknown>
      testDraftSave: (value: unknown) => Promise<number>
      testDraftPrepare?: () => Promise<number>
      testDraftRelease?: () => void
    }
    Object.assign(window, { manturDrafts: {
      load: () => host.testDraftLoad(), save: (value: unknown) => host.testDraftSave(value),
      onPrepare: (handler: () => Promise<number>) => { host.testDraftPrepare = handler; return () => { delete host.testDraftPrepare } },
      onRelease: (handler: () => void) => { host.testDraftRelease = handler; return () => { delete host.testDraftRelease } },
    } })
  })
}

it.skipIf(process.platform === 'win32')('restores exact selected image bytes and text on a fresh loopback origin without localStorage', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mantur-native-draft-browser-'))
  const storage = new DesktopDraftStorage(root)
  let browser: Browser | undefined
  let first: Awaited<ReturnType<typeof launchWebScaffold>> | undefined
  let second: Awaited<ReturnType<typeof launchWebScaffold>> | undefined
  try {
    browser = await chromium.launch()
    first = await launchWebScaffold()
    const text = await readFile(fixture, 'utf8')
    await seedSession(first, text, sessionId)
    const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1440, height: 900 } })
    await installNativeFixture(page, storage)
    await page.goto(first.authenticatedUrl)
    await page.getByRole('treeitem').first().click()
    await page.getByRole('treeitem').nth(1).click()
    const input = page.locator('[data-composer-input][contenteditable="true"]')
    await input.waitFor()
    await input.fill('A native checkpoint draft')
    const imageBase64 = (await readFile(png)).toString('base64')
    await input.evaluate((element, base64) => {
      const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0))
      const transfer = new DataTransfer()
      transfer.items.add(new File([bytes], 'native-fixture.png', { type: 'image/png', lastModified: 1000 }))
      element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }))
    }, imageBase64)
    await page.getByRole('img', { name: 'native-fixture.png' }).waitFor()
    await page.evaluate(async () => {
      const host = window as unknown as { testDraftPrepare: () => Promise<number> }
      await host.testDraftPrepare()
    })
    const saved = await storage.committed()
    const selected = saved.drafts.find(draft => draft.owner === `session:${sessionId}`)
    expect(selected?.images[0]?.data).toBe(imageBase64)
    await page.close()
    second = await launchWebScaffold()
    await seedSession(second, text, sessionId)
    expect(second.baseUrl).not.toBe(first.baseUrl)
    const reopened = await browser.newPage({ locale: 'en-US', viewport: { width: 1440, height: 900 } })
    await installNativeFixture(reopened, new DesktopDraftStorage(root))
    await reopened.goto(second.authenticatedUrl)
    expect(await reopened.evaluate(id => localStorage.getItem(`dsh.conversation.${id}`), sessionId)).toBeNull()
    await reopened.getByRole('treeitem').first().click()
    await reopened.getByRole('treeitem').nth(1).click()
    await expect.poll(() => reopened.locator('[data-composer-input]').innerText()).toBe('A native checkpoint draft')
    await reopened.getByRole('img', { name: 'native-fixture.png' }).waitFor()
    const after = await storage.committed()
    expect(after.drafts.find(draft => draft.owner === `session:${sessionId}`)?.images[0]?.sha256).toBe(selected?.images[0]?.sha256)
  } finally {
    try {
      await browser?.close()
    } finally {
      try {
        const results = await Promise.allSettled([second?.close(), first?.close()])
        const failures = results.filter(result => result.status === 'rejected')
        if (failures.length > 0) throw new AggregateError(failures.map((result): unknown => result.reason), 'Draft fixture teardown failed')
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    }
  }
})
