/** First-send creation through Mantur's real Loader, browser editor and persisted Session. */
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ReplayOverrideDoc } from '@deepseek-ai/dsh-llm-replay'
import type {} from '@deepseek-ai/dsh-mantur-projects'
import type { Browser } from 'playwright'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { DesktopDraftStorage, type DraftCheckpoint } from '../../desktop/src/draft-storage.ts'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, readPersistedEvents, watchConsole, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { ZH_BROWSER_LOCALE } from './support.ts'

const overlay = fileURLToPath(new URL('../../../packages/bundle/mantur-app/cordis.patch.yml', import.meta.url))
const anchor = fileURLToPath(new URL('../../../packages/bundle/mantur-app/package.json', import.meta.url))
const referenceImage = fileURLToPath(new URL('../../../snapshots/session/read-image/workspace/red.png', import.meta.url))
const expected = fileURLToPath(new URL('./expected/mantur-automatic-project.md', import.meta.url))
const skill = {
  slug: 'short-drama', name: '爽文短剧剧本创作', description: '提供从创意构思到分集剧本的创作支持。',
  category: '剧本创作', version: '1.0.0', triggers: ['创作短剧剧本'], uses_operators: [], kind: 'skill', assets: null,
}
const reply = 'Automatic project fixture received the first message.'
const replay: ReplayOverrideDoc = [{
  kind: 'chunks', chunks: [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: reply },
    { type: 'block-end', index: 0, block: { type: 'text', text: reply } },
    { type: 'usage', usage: { inputTokens: 256, outputTokens: 16 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ],
}]

// Native durability is explicitly unavailable on Windows until write-through directory publication is implemented.
it.skipIf(webSnapshotMode() === 'record' || process.platform === 'win32')('resumes a lost project response after reload and sends the restored Skill and image once', async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'mantur-first-send-'))
  const storage = new DesktopDraftStorage(fixtureRoot)
  const checkpoints: DraftCheckpoint[] = []
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(request.url === '/api/v1/skills' ? { skills: [skill] } : { skill }))
  })
  let scaffold: WebScaffold | undefined
  let browser: Browser | undefined
  const failures: unknown[] = []
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const replayOverride = join(fixtureRoot, 'replay.override.json')
    await writeFile(replayOverride, JSON.stringify(replay))
    scaffold = await launchWebScaffold({
      extraOverlayPath: overlay, extraInstallAnchors: [anchor],
      manturHubBaseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      replayFixture: join(fixtureRoot, 'override-only.jsonl'), replayOverride,
    })
    const projectRoot = join(scaffold.workspaceCwd, 'automatic-projects')
    await scaffold.ctx.manturProjects.setRoot(projectRoot)
    const skillRoot = join(scaffold.harnessHome, 'skills', skill.slug)
    await mkdir(skillRoot, { recursive: true })
    await writeFile(join(skillRoot, 'SKILL.md'), `---\nname: ${skill.slug}\ntitle: ${skill.name}\ndescription: ${skill.description}\n---\nHelp write a script.\n`)
    browser = await chromium.launch()
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 }, locale: ZH_BROWSER_LOCALE })
    await page.exposeFunction('testDraftLoad', () => storage.committed())
    await page.exposeFunction('testDraftSave', async (value: unknown) => {
      const revision = await storage.save(value)
      checkpoints.push(await storage.committed())
      return revision
    })
    await page.addInitScript(() => {
      const host = window as unknown as {
        testDraftLoad: () => Promise<unknown>
        testDraftSave: (value: unknown) => Promise<number>
      }
      Object.assign(window, { manturDrafts: {
        load: () => host.testDraftLoad(), save: (value: unknown) => host.testDraftSave(value),
        onPrepare: () => () => {}, onRelease: () => () => {},
      } })
    })
    const console = watchConsole(page)
    let prompts = 0
    page.on('request', (request) => { if (new URL(request.url()).pathname === '/api/session/prompt') prompts += 1 })
    await page.goto(scaffold.authenticatedUrl)
    await page.getByRole('button', { name: '暂时跳过', exact: true }).click()
    const editor = page.locator('[data-composer-input][contenteditable="true"]').first()
    await editor.waitFor()
    expect(scaffold.ctx.workspaceRegistry.list()).toHaveLength(0)
    expect(existsSync(projectRoot)).toBe(false)
    expect(await page.getByRole('button', { name: '发送消息', exact: true }).isDisabled()).toBe(true)
    await editor.press('Enter')
    expect(prompts).toBe(0)
    expect(existsSync(projectRoot)).toBe(false)

    await page.getByText('自动创建项目', { exact: true }).click()
    await page.getByText(projectRoot, { exact: true }).waitFor()
    const locationAria = await captureStableAria(page, '[data-workspace-footer]', scaffold.workspaceCwd)
    await page.getByText('自动创建项目', { exact: true }).click()
    await editor.fill('根据参考图编写第一集 ')
    await page.getByRole('button', { name: '短剧编剧', exact: true }).click()
    await expect.poll(() => editor.innerText()).toContain(skill.name)
    await editor.evaluate((element, bytes) => {
      const transfer = new DataTransfer()
      transfer.items.add(new File([new Uint8Array(bytes)], 'reference.png', { type: 'image/png' }))
      element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }))
    }, [...await readFile(referenceImage)])
    await page.getByRole('img', { name: 'reference.png', exact: true }).waitFor()
    expect(existsSync(projectRoot)).toBe(false)
    expect(scaffold.ctx.workspaceRegistry.list()).toHaveLength(0)

    const lostResponse = Promise.withResolvers<undefined>()
    await page.route('**/api/manturProjects/prepare', async (route) => {
      await route.fetch()
      await route.abort('failed')
      lostResponse.resolve(undefined)
    }, { times: 1 })
    await page.getByRole('button', { name: '发送消息', exact: true }).click()
    await lostResponse.promise
    await page.getByText('项目创建未完成，草稿已保留。可以重试或选择已有项目。', { exact: true }).first().waitFor()
    expect(scaffold.ctx.workspaceRegistry.list()).toHaveLength(1)
    expect(scaffold.ctx.workspaceRegistry.list()[0]!.sessionIds).toEqual([])
    expect(prompts).toBe(0)
    const failureAria = await captureStableAria(page, '[data-workspace-footer]', scaffold.workspaceCwd)
    await page.reload()
    await page.getByRole('button', { name: '暂时跳过', exact: true }).click()
    await editor.waitFor()
    await expect.poll(() => editor.innerText()).toContain(skill.name)
    expect(await editor.innerText()).toContain('根据参考图编写第一集')
    await page.getByRole('img', { name: 'reference.png', exact: true }).waitFor()

    const settled = scaffold.whenTurnSettled()
    // Two synchronous gestures hit the same preparation lock before its asynchronous Host result.
    await page.getByRole('button', { name: '发送消息', exact: true }).evaluate((element) => {
      const button = element as HTMLButtonElement
      button.click()
      button.click()
    })
    const sessionId = await settled
    await page.getByText(reply, { exact: true }).waitFor()
    expect(prompts).toBe(1)
    const projects = scaffold.ctx.workspaceRegistry.list()
    expect(projects).toHaveLength(1)
    expect(projects[0]!.title).toMatch(/^新项目 [0-9a-f]{8}$/)
    expect(projects[0]!.sessionIds).toEqual([sessionId])
    const prepared = checkpoints.find(checkpoint => checkpoint.drafts.some(draft => draft.prepareId !== undefined))
    const unassigned = prepared?.drafts.find(draft => draft.owner === 'unassigned')
    expect(`session-${unassigned?.prepareId}`).toBe(sessionId)
    expect(unassigned?.images[0]?.data).toBe((await readFile(referenceImage)).toString('base64'))
    const transferred = checkpoints.find(checkpoint => checkpoint.drafts.some(draft => draft.owner === `session:${sessionId}` && draft.images.length === 1))
    expect(transferred?.drafts.find(draft => draft.owner === 'unassigned')?.prepareId).toBeUndefined()
    expect(transferred?.drafts.find(draft => draft.owner === `session:${sessionId}`)?.editor).toBe(unassigned?.editor)
    expect(await readdir(projectRoot)).toEqual([basename(projects[0]!.path)])
    const events = await readPersistedEvents(scaffold, sessionId)
    const messages = events.flatMap(event => event.type === 'user/message' && event.data.source.kind === 'user' ? [event.data] : [])
    expect(messages).toHaveLength(1)
    expect(messages[0]!.content.map(block => block.type)).toEqual(['image', 'text'])
    const image = messages[0]!.content.find(block => block.type === 'image')
    expect(image?.type === 'image' && image.attachment.name).toBe('reference.png')
    const text = messages[0]!.content.find(block => block.type === 'text')
    expect(text?.type === 'text' && text.text).toContain('根据参考图编写第一集')
    expect(text?.type === 'text' && text.text).toContain('/short-drama')
    expect(JSON.stringify(events)).not.toContain('data:image')
    expect(console.pageErrors).toEqual([])
    expect(console.warnings).toEqual([])
    await compareOrRefreshGolden(expected, `# First-send project location\n\n${locationAria}\n\n# Lost response, retained draft\n\n${failureAria}`, webSnapshotMode())
  } catch (error) {
    failures.push(error)
    const page = browser?.contexts()[0]?.pages()[0]
    if (page !== undefined) {
      const artifact = fileURLToPath(new URL('../../../.artifacts/mantur-automatic-project-failure.md', import.meta.url))
      await mkdir(fileURLToPath(new URL('../../../.artifacts', import.meta.url)), { recursive: true })
      await writeFile(artifact, await page.locator('body').ariaSnapshot())
    }
  } finally {
    await browser?.close().catch((error: unknown) => { failures.push(error) })
    await scaffold?.close().catch((error: unknown) => { failures.push(error) })
    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => { if (error === undefined) resolve(); else reject(error) })
      }).catch((error: unknown) => { failures.push(error) })
    }
    await rm(fixtureRoot, { recursive: true, force: true }).catch((error: unknown) => { failures.push(error) })
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) throw new AggregateError(failures, 'Mantur first-send scenario and cleanup failed', { cause: failures[0] })
})
