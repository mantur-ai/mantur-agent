/** Mantur conversation controls over a real persisted, keyless replayed turn. */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { launchWebScaffold, readPersistedEvents, watchConsole } from './scaffold.ts'
import { writeComposerDraft, ZH_BROWSER_LOCALE } from './support.ts'

it('keeps the conversation and durable history without diagnostic tabs, log download or footer statistics', async () => {
  const scaffold = await launchWebScaffold({
    extraOverlayPath: fileURLToPath(new URL('../../../packages/bundle/mantur-app/cordis.patch.yml', import.meta.url)),
    extraInstallAnchors: [fileURLToPath(new URL('../../../packages/bundle/mantur-app/package.json', import.meta.url))],
    replayFixture: fileURLToPath(new URL('../../../snapshots/web/lifecycle-chrome/session.jsonl', import.meta.url)),
    compareReplaySession: false,
  })
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    browser = await chromium.launch()
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 }, locale: ZH_BROWSER_LOCALE })
    const console = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl)
    const workspace = join(scaffold.workspaceCwd, 'conversation')
    await mkdir(workspace)
    await page.getByRole('button', { name: '选择工作区', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '选择工作区目录' })
    await dialog.getByRole('button', { name: '编辑路径' }).click()
    const path = dialog.getByRole('textbox', { name: '编辑路径' })
    await path.fill(workspace)
    await path.press('Enter')
    await dialog.getByRole('button', { name: '打开', exact: true }).click()
    const editor = page.locator('[data-composer-input][contenteditable="true"]').first()
    await writeComposerDraft(page, editor, 'Reply with the single word LIGHTHOUSE and stop.')
    const settled = scaffold.whenTurnSettled()
    await page.getByRole('button', { name: '发送消息', exact: true }).click()
    const sessionId = await settled
    await page.getByText('LIGHTHOUSE', { exact: true }).waitFor()
    for (const reload of [false, true]) {
      if (reload) {
        await page.reload()
        await page.getByText('LIGHTHOUSE', { exact: true }).waitFor()
      }
      await page.getByRole('navigation', { name: '会话层级' }).waitFor()
      expect(await page.getByRole('tab', { name: '轨迹', exact: true }).count()).toBe(0)
      expect(await page.getByRole('tab', { name: '对话', exact: true }).count()).toBe(0)
      expect(await page.getByRole('button', { name: 'Session 日志', exact: true }).count()).toBe(0)
      expect(await page.getByText(/\d+ 轮 · \d+ 步/).count()).toBe(0)
    }
    const events = await readPersistedEvents(scaffold, sessionId)
    expect(events.some(event => event.type === 'user/message')).toBe(true)
    expect(events.some(event => event.type === 'assistant/message')).toBe(true)
    expect(console.pageErrors).toEqual([])
    const artifacts = fileURLToPath(new URL('../../../.artifacts/mantur-conversation-chrome/', import.meta.url))
    await mkdir(artifacts, { recursive: true })
    await page.screenshot({ path: join(artifacts, 'conversation.png'), animations: 'disabled' })
  } finally {
    await browser?.close()
    await scaffold.close()
  }
})
