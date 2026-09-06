/** UI-only creation-guide behavior through the real Mantur Loader and Remote composition. */
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode } from './scaffold.ts'
import { connectFreshWorkspaceZh, ZH_BROWSER_LOCALE } from './support.ts'

const overlay = fileURLToPath(new URL('../../../packages/bundle/mantur-app/cordis.patch.yml', import.meta.url))
const anchor = fileURLToPath(new URL('../../../packages/bundle/mantur-app/package.json', import.meta.url))
const expected = fileURLToPath(new URL('./expected/mantur-guide.md', import.meta.url))
const images = fileURLToPath(new URL('../../../.artifacts/mantur-guide', import.meta.url))
const skill = {
  slug: 'short-drama', name: '爽文短剧剧本创作', description: '提供从创意构思、人物关系到分集剧本的创作支持。',
  category: '剧本创作', version: '1.0.0', triggers: ['创作短剧剧本'], uses_operators: [], kind: 'skill', assets: null,
}

it('preserves a live draft, attachments and controls while changing modes and adding a Skill without sending', async () => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(request.url === '/api/v1/skills' ? { skills: [skill] } : { skill }))
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  let scaffold: Awaited<ReturnType<typeof launchWebScaffold>> | undefined
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    const address = server.address() as AddressInfo
    scaffold = await launchWebScaffold({ extraOverlayPath: overlay, extraInstallAnchors: [anchor], manturHubBaseUrl: `http://127.0.0.1:${address.port}` })
    const skillRoot = join(scaffold.harnessHome, 'skills', skill.slug)
    await mkdir(skillRoot, { recursive: true })
    await writeFile(join(skillRoot, 'SKILL.md'), `---\nname: ${skill.slug}\ntitle: ${skill.name}\ndescription: ${skill.description}\n---\nHelp write a script.\n`)
    browser = await chromium.launch()
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, locale: ZH_BROWSER_LOCALE })
    const console = watchConsole(page)
    let prompts = 0
    page.on('request', (request) => { if (new URL(request.url()).pathname === '/api/session/prompt') prompts++ })
    await page.goto(scaffold.authenticatedUrl)
    await page.getByRole('button', { name: '暂时跳过' }).click()
    await connectFreshWorkspaceZh(page, scaffold.workspaceCwd)
    const script = page.getByRole('tab', { name: '剧本创作' })
    await expect.poll(() => script.getAttribute('aria-selected')).toBe('true')
    await page.getByText('你好呀，我是馒头仔，漫途的创作小助手！', { exact: true }).waitFor()
    const mascot = page.getByRole('button', { name: '馒头仔' }).locator('img')
    await expect.poll(() => mascot.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBe(552)
    const alpha = await mascot.evaluate((element) => {
      const canvas = document.createElement('canvas')
      canvas.width = 552
      canvas.height = 300
      const context = canvas.getContext('2d')!
      context.drawImage(element as HTMLImageElement, 0, 0)
      return [context.getImageData(0, 0, 1, 1).data[3], context.getImageData(350, 150, 1, 1).data[3]]
    })
    expect(alpha).toEqual([0, 255])
    await mkdir(images, { recursive: true })
    await page.screenshot({ path: join(images, 'desktop.png') })
    const initial = await captureStableAria(page, '[data-composer-seat]', scaffold.workspaceCwd)
    const editor = page.locator('[contenteditable="true"]').first()
    await editor.fill('保留这个故事和参考图 ')
    await editor.evaluate((element) => {
      const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5FkAAAAASUVORK5CYII='), char => char.charCodeAt(0))
      const data = new DataTransfer()
      data.items.add(new File([bytes], 'reference.png', { type: 'image/png' }))
      element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    })
    await page.getByRole('img', { name: 'reference.png' }).waitFor()
    const attachments = await page.getByRole('img', { name: 'reference.png' }).count()
    const model = await page.getByRole('button', { name: '选择模型' }).innerText()
    const permission = await page.getByRole('button', { name: /访问模式/ }).innerText()
    await page.getByRole('button', { name: skill.name, exact: true }).click()
    await page.getByRole('button', { name: skill.name, exact: true }).click()
    await expect.poll(() => editor.innerText()).toContain(skill.name)
    expect((await editor.innerText()).split(skill.name)).toHaveLength(2)
    expect(await editor.evaluate(element => document.activeElement === element)).toBe(true)
    await page.getByRole('tab', { name: '漫剧制作' }).click()
    await expect.poll(() => page.getByRole('tab', { name: '漫剧制作' }).getAttribute('aria-selected')).toBe('true')
    expect(await editor.innerText()).toContain('保留这个故事和参考图')
    expect(await editor.innerText()).toContain(skill.name)
    expect(await page.getByRole('img', { name: 'reference.png' }).count()).toBe(attachments)
    expect(await page.getByRole('button', { name: '选择模型' }).innerText()).toBe(model)
    expect(await page.getByRole('button', { name: /访问模式/ }).innerText()).toBe(permission)
    expect(prompts).toBe(0)
    await page.keyboard.press('Escape')
    await expect.poll(() => page.getByRole('button', { name: '馒头仔' }).getAttribute('aria-expanded')).toBe('false')
    await page.getByRole('tab', { name: '素材创作' }).click()
    await expect.poll(() => page.getByRole('tab', { name: '素材创作' }).getAttribute('aria-selected')).toBe('true')
    expect(await page.getByRole('button', { name: '馒头仔' }).getAttribute('aria-expanded')).toBe('false')
    await page.reload()
    await page.getByRole('button', { name: '暂时跳过' }).click()
    await expect.poll(() => page.getByRole('tab', { name: '素材创作' }).getAttribute('aria-selected')).toBe('true')
    expect(await page.getByRole('button', { name: '馒头仔' }).getAttribute('aria-expanded')).toBe('false')
    await page.getByRole('button', { name: '馒头仔' }).click()
    await page.getByText('缺一个人物、一处场景，还是一段声音？描述你需要的素材，或上传参考。', { exact: true }).waitFor()
    await page.setViewportSize({ width: 720, height: 900 })
    await page.screenshot({ path: join(images, 'narrow.png') })
    const geometry = await page.locator('[data-composer-seat]').evaluate((element) => {
      const bubble = element.querySelector('section[aria-label="馒头仔"]')?.getBoundingClientRect()
      const shortcuts = element.querySelector('[aria-label="推荐技能"]')?.getBoundingClientRect()
      const editor = element.querySelector('[contenteditable="true"]')?.getBoundingClientRect()
      const mascot = element.querySelector('img[src$="mantou-clapper.png"]')?.getBoundingClientRect()
      const card = element.querySelector('[data-composer-card]')?.getBoundingClientRect()
      const empty = element.querySelector('[aria-label="推荐技能"] span')
      return {
        fits: element.getBoundingClientRect().right <= window.innerWidth,
        bubbleBottom: bubble?.bottom, shortcutTop: shortcuts?.top, editorTop: editor?.top,
        mascotBottom: mascot?.bottom,
        handOverlap: mascot !== undefined && card !== undefined ? mascot.top + mascot.height * 0.94 - card.top : undefined,
        emptyFits: empty !== null && empty.clientWidth >= empty.scrollWidth,
      }
    })
    expect(geometry.fits).toBe(true)
    expect(geometry.bubbleBottom).toBeLessThanOrEqual(geometry.shortcutTop ?? 0)
    expect(geometry.bubbleBottom).toBeLessThanOrEqual(geometry.editorTop ?? 0)
    expect(geometry.mascotBottom).toBeLessThanOrEqual(geometry.editorTop ?? 0)
    expect(geometry.handOverlap).toBeGreaterThanOrEqual(2)
    expect(geometry.handOverlap).toBeLessThanOrEqual(4)
    expect(geometry.emptyFits).toBe(true)
    await compareOrRefreshGolden(expected, initial, webSnapshotMode())
    expect(console.pageErrors).toEqual([])
  } finally {
    await browser?.close()
    await scaffold?.close()
    await new Promise<void>((resolve, reject) => server.close((error) => { if (error === undefined) resolve(); else reject(error) }))
  }
})
