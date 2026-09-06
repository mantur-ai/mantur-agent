/** UI-only creation-guide behavior through the real Mantur Loader and Remote composition. */
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode } from './scaffold.ts'
import { ZH_BROWSER_LOCALE } from './support.ts'

const overlay = fileURLToPath(new URL('../../../packages/bundle/mantur-app/cordis.patch.yml', import.meta.url))
const anchor = fileURLToPath(new URL('../../../packages/bundle/mantur-app/package.json', import.meta.url))
const expected = fileURLToPath(new URL('./expected/mantur-guide.md', import.meta.url))
const images = fileURLToPath(new URL('../../../.artifacts/mantur-guide', import.meta.url))
const skill = {
  slug: 'short-drama', name: '爽文短剧剧本创作', description: '提供从创意构思、人物关系到分集剧本的创作支持。',
  category: '剧本创作', version: '1.0.0', triggers: ['创作短剧剧本'], uses_operators: [], kind: 'skill', assets: null,
}

it('does not display Mantur artwork or mode controls without the Mantur plugin', async () => {
  const scaffold = await launchWebScaffold()
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    browser = await chromium.launch()
    const page = await browser.newPage({ locale: ZH_BROWSER_LOCALE })
    await page.goto(scaffold.authenticatedUrl)
    await page.getByRole('textbox', { name: '选择工作区' }).waitFor()
    expect(await page.getByRole('button', { name: '馒头仔', exact: true }).count()).toBe(0)
    expect(await page.getByRole('tablist', { name: '创作方向' }).count()).toBe(0)
    expect(await page.locator('[data-workspace-footer]').count()).toBe(0)
    expect(await page.locator('img[src$="mantou-clapper.png"]').count()).toBe(0)
  } finally {
    await browser?.close()
    await scaffold.close()
  }
})

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
    const workspaceButton = page.locator('[data-workspace-footer]').getByRole('button', { name: '选择工作区' })
    await workspaceButton.waitFor()
    expect(await page.getByRole('button', { name: '发送消息', exact: true }).isDisabled()).toBe(true)
    expect(await workspaceButton.innerText()).toContain('选择工作区')
    const chooseDirectory = async (path: string): Promise<void> => {
      const dialog = page.getByRole('dialog', { name: '选择工作区目录' })
      await dialog.getByRole('button', { name: '编辑路径' }).click()
      const pathInput = dialog.getByRole('textbox', { name: '编辑路径' })
      await pathInput.fill(path)
      await pathInput.press('Enter')
      await dialog.getByRole('button', { name: '打开', exact: true }).click()
      await page.locator('[data-composer-input][contenteditable="true"]').waitFor()
    }
    const firstWorkspace = join(scaffold.workspaceCwd, 'workspace')
    const secondWorkspace = join(scaffold.workspaceCwd, 'second-workspace')
    await mkdir(firstWorkspace)
    await mkdir(secondWorkspace)
    await workspaceButton.click()
    await chooseDirectory(firstWorkspace)
    await expect.poll(() => workspaceButton.innerText()).toContain('workspace')
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
    const composerPositions = () => page.locator('[data-composer-seat]').evaluate((element) => {
      const rect = (selector: string) => {
        const bounds = element.querySelector(selector)!.getBoundingClientRect()
        return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
      }
      return { shortcuts: rect('[aria-label="推荐技能"]'), card: rect('[data-composer-card]') }
    })
    const openPositions = await composerPositions()
    await mkdir(images, { recursive: true })
    await page.screenshot({ path: join(images, 'desktop.png') })
    const initial = await captureStableAria(page, '[data-composer-seat]', scaffold.workspaceCwd)
    await page.getByRole('button', { name: '关闭引导', exact: true }).click()
    expect(await composerPositions()).toEqual(openPositions)
    await page.getByRole('button', { name: '馒头仔', exact: true }).click()
    expect(await composerPositions()).toEqual(openPositions)
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
    await page.getByRole('button', { name: '发送消息', exact: true }).focus()
    await page.keyboard.press('Tab')
    expect(await workspaceButton.evaluate(element => document.activeElement === element)).toBe(true)
    expect(await workspaceButton.evaluate((element) => {
      const card = document.querySelector('[data-composer-card]')!.getBoundingClientRect()
      const footer = element.closest('[data-workspace-footer]')!.getBoundingClientRect()
      return footer.top >= card.bottom && Math.abs(footer.left - card.left) < 1
    })).toBe(true)
    await workspaceButton.click()
    await page.getByRole('menuitem', { name: '添加工作区…', exact: true }).click()
    await chooseDirectory(secondWorkspace)
    await expect.poll(() => workspaceButton.innerText()).toContain('second-workspace')
    expect(await editor.innerText()).toContain('保留这个故事和参考图')
    expect(await page.getByRole('img', { name: 'reference.png' }).count()).toBe(attachments)
    await workspaceButton.click()
    const menu = page.getByRole('menu').last()
    await menu.waitFor()
    expect(await menu.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight
    })).toBe(true)
    await menu.getByRole('menuitem', { name: 'workspace', exact: true }).click()
    await expect.poll(() => workspaceButton.innerText()).toBe('workspace')
    expect(await editor.innerText()).toContain('保留这个故事和参考图')
    expect(await page.getByRole('img', { name: 'reference.png' }).count()).toBe(attachments)
    const shortcut = page.getByRole('button', { name: '短剧编剧', exact: true })
    expect(await shortcut.getAttribute('title')).toBe(skill.name)
    await shortcut.click()
    await shortcut.click()
    await expect.poll(() => editor.innerText()).toContain(skill.name)
    expect((await editor.innerText()).split(skill.name)).toHaveLength(2)
    expect(await editor.evaluate(element => document.activeElement === element)).toBe(true)
    const draftPositions = await composerPositions()
    await page.getByRole('tab', { name: '漫剧制作' }).click()
    await expect.poll(() => page.getByRole('tab', { name: '漫剧制作' }).getAttribute('aria-selected')).toBe('true')
    expect((await composerPositions()).card).toEqual(draftPositions.card)
    expect((await composerPositions()).shortcuts.y).toBe(draftPositions.shortcuts.y)
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
    // Finish the app frame's responsive sidebar transition before measuring guide-only changes.
    await page.locator('[data-sidebar-collapsed]').waitFor()
    await expect.poll(() => page.locator('[data-sidebar-collapsed]').evaluate(
      element => getComputedStyle(element).gridTemplateColumns.split(' ')[0],
    )).toBe('56px')
    const narrowPositions = await composerPositions()
    await page.getByRole('button', { name: '关闭引导', exact: true }).click()
    expect(await composerPositions()).toEqual(narrowPositions)
    await page.getByRole('button', { name: '馒头仔', exact: true }).click()
    expect(await composerPositions()).toEqual(narrowPositions)
    const bubbleBody = page.getByRole('region', { name: '馒头仔' }).locator('[tabindex="0"]')
    await bubbleBody.focus()
    await page.keyboard.press('End')
    await expect.poll(() => bubbleBody.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    expect(await page.getByRole('button', { name: '关闭引导', exact: true }).isVisible()).toBe(true)
    await page.keyboard.press('Home')
    await expect.poll(() => bubbleBody.evaluate(element => element.scrollTop)).toBe(0)
    await page.screenshot({ path: join(images, 'narrow.png') })
    const geometry = await page.locator('[data-composer-seat]').evaluate((element) => {
      const bubble = element.querySelector('section[aria-label="馒头仔"]')?.getBoundingClientRect()
      const editor = element.querySelector('[contenteditable="true"]')?.getBoundingClientRect()
      const mascot = element.querySelector('img[src$="mantou-clapper.png"]')?.getBoundingClientRect()
      const card = element.querySelector('[data-composer-card]')?.getBoundingClientRect()
      const empty = element.querySelector('[aria-label="推荐技能"] span')
      const protectedRects = [...element.querySelectorAll(
        '[role="tablist"], [aria-label="推荐技能"] > *, [data-composer-card], button[aria-label="选择工作区"]',
      )].map(node => node.getBoundingClientRect())
      return {
        fits: element.getBoundingClientRect().right <= window.innerWidth,
        bubbleFits: bubble !== undefined && bubble.left >= 0 && bubble.right <= window.innerWidth
          && bubble.top >= 0 && bubble.bottom <= window.innerHeight,
        bubbleOverlaps: bubble !== undefined && protectedRects.some(rect => rect.left < bubble.right
          && rect.right > bubble.left && rect.top < bubble.bottom && rect.bottom > bubble.top),
        bubbleAnchorGap: bubble !== undefined && mascot !== undefined ? mascot.top - bubble.bottom : undefined,
        editorTop: editor?.top,
        mascotBottom: mascot?.bottom,
        handOverlap: mascot !== undefined && card !== undefined ? mascot.top + mascot.height * 0.94 - card.top : undefined,
        emptyFits: empty !== null && empty.clientWidth >= empty.scrollWidth,
      }
    })
    expect(geometry.fits).toBe(true)
    expect(geometry.bubbleFits).toBe(true)
    expect(geometry.bubbleOverlaps).toBe(false)
    expect(geometry.bubbleAnchorGap).toBeGreaterThanOrEqual(7)
    expect(geometry.bubbleAnchorGap).toBeLessThanOrEqual(9)
    expect(geometry.mascotBottom).toBeLessThanOrEqual(geometry.editorTop ?? 0)
    expect(geometry.handOverlap).toBeGreaterThanOrEqual(2)
    expect(geometry.handOverlap).toBeLessThanOrEqual(4)
    expect(geometry.emptyFits).toBe(true)
    expect(await page.getByRole('button', { name: '馒头仔', exact: true }).evaluate(
      element => getComputedStyle(element).backgroundColor,
    )).toBe('rgba(0, 0, 0, 0)')
    await page.getByRole('tab', { name: '剧本创作' }).click()
    await page.getByRole('button', { name: '短剧编剧', exact: true }).waitFor()
    expect((await composerPositions()).card).toEqual(narrowPositions.card)
    await page.screenshot({ path: join(images, 'narrow-recommendations.png') })
    await workspaceButton.click()
    const narrowMenu = page.getByRole('menu').last()
    await narrowMenu.waitFor()
    expect(await narrowMenu.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight
    })).toBe(true)
    await page.keyboard.press('Escape')
    await compareOrRefreshGolden(expected, initial, webSnapshotMode())
    expect(console.pageErrors).toEqual([])
  } finally {
    await browser?.close()
    await scaffold?.close()
    await new Promise<void>((resolve, reject) => server.close((error) => { if (error === undefined) resolve(); else reject(error) }))
  }
})
