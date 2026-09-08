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
    expect(await page.locator('img[src*="mantoo-"]').count()).toBe(0)
  } finally {
    await browser?.close()
    await scaffold.close()
  }
})

it('keeps an uninstalled shortcut confirmation brief and leaves the current draft untouched on cancel', async () => {
  const detail = { ...skill, description: '这是一段很长的技能说明。'.repeat(100), introduction: '完整技能正文不在首页展示。'.repeat(100) }
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(request.url === '/api/v1/skills' ? { skills: [detail] } : { skill: detail }))
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  let scaffold: Awaited<ReturnType<typeof launchWebScaffold>> | undefined
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    scaffold = await launchWebScaffold({ extraOverlayPath: overlay, extraInstallAnchors: [anchor],
      manturHubBaseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` })
    browser = await chromium.launch()
    const page = await browser.newPage({ viewport: { width: 880, height: 600 }, locale: ZH_BROWSER_LOCALE })
    const console = watchConsole(page)
    const writes: string[] = []
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname
      if (path === '/api/session/prompt' || path === '/api/manturMarketplace/installSkill') writes.push(path)
    })
    await page.goto(scaffold.authenticatedUrl)
    await page.getByRole('button', { name: '暂时跳过', exact: true }).click()
    const editor = page.locator('[data-composer-input][contenteditable="true"]').first()
    await editor.fill('保留未发送的创作需求')
    await page.getByRole('button', { name: '短剧编剧', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '短剧编剧', exact: true })
    await dialog.getByRole('button', { name: '登录后安装', exact: true }).waitFor()
    expect(await dialog.innerText()).toContain('尚未安装此技能。安装后可添加到当前对话。')
    expect(await dialog.innerText()).not.toContain(detail.description)
    expect(await dialog.innerText()).not.toContain(detail.introduction)
    expect(await dialog.evaluate((element) => {
      const box = element.getBoundingClientRect()
      return box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth
    })).toBe(true)
    await mkdir(images, { recursive: true })
    await page.screenshot({ path: join(images, 'skill-install-confirmation.png') })
    const aria = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await dialog.getByRole('button', { name: '关闭引导', exact: true }).click()
    expect(await editor.innerText()).toBe('保留未发送的创作需求')
    expect(scaffold.ctx.workspaceRegistry.list()).toHaveLength(0)
    expect(writes).toEqual([])
    expect(console.pageErrors).toEqual([])
    await compareOrRefreshGolden(fileURLToPath(new URL('./expected/mantur-guide-install-confirmation.md', import.meta.url)), aria, webSnapshotMode())
  } finally {
    await browser?.close()
    await scaffold?.close()
    await new Promise<void>((resolve, reject) => server.close((error) => { if (error === undefined) resolve(); else reject(error) }))
  }
})

it('keeps guidance readable at the desktop minimum without moving the composer or covering controls', async () => {
  const skills = [skill, ...[
    'drama-asset-seedance-pipeline', 'character-forge', 'mantur-video-prompt-director', 'mantur-acting-director',
    'mantur-smartclip', 'four-dimensional-voice-director', 'mantur-image-prompt-director', 'chinese-wonderland-director',
  ].map(slug => ({ ...skill, slug }))]
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ skills }))
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  let scaffold: Awaited<ReturnType<typeof launchWebScaffold>> | undefined
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    const address = server.address() as AddressInfo
    scaffold = await launchWebScaffold({ extraOverlayPath: overlay, extraInstallAnchors: [anchor], manturHubBaseUrl: `http://127.0.0.1:${address.port}` })
    browser = await chromium.launch()
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 }, locale: ZH_BROWSER_LOCALE })
    const console = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl)
    await page.getByRole('button', { name: '暂时跳过' }).click()
    await page.getByRole('button', { name: '短剧编剧', exact: true }).waitFor()
    const positions = () => page.locator('[data-composer-seat]').evaluate(element =>
      ['[data-composer-card]', '[data-skill-rail]'].map((selector) => {
        const rect = element.querySelector(selector)!.getBoundingClientRect()
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      }))
    const sidebarWidth = () => page.locator('[data-details-collapsed]').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ')[0])
    const expandedSidebarWidth = await sidebarWidth()
    for (const [width, height] of [[880, 600], [800, 900], [720, 900], [1280, 820]] as const) {
      await page.setViewportSize({ width, height })
      await expect.poll(() => page.locator('[data-sidebar-collapsed]').count()).toBe(width < 1024 ? 1 : 0)
      await expect.poll(sidebarWidth).toBe(width < 1024 ? '56px' : expandedSidebarWidth)
      const before = await positions()
      for (const [mode, name] of [['script', '剧本创作'], ['production', '漫剧制作'], ['editing', '剪辑成片'], ['assets', '素材创作']] as const) {
        const tab = page.getByRole('tab', { name, exact: true })
        await tab.click()
        await expect.poll(() => tab.getAttribute('aria-selected')).toBe('true')
        const rail = page.getByLabel('推荐技能', { exact: true })
        expect(await rail.evaluate(element => getComputedStyle(element).scrollbarWidth)).toBe('none')
        expect(await rail.getByRole('button').evaluateAll(elements => elements.every(element =>
          element.getBoundingClientRect().height >= 40 && getComputedStyle(element).borderTopWidth === '1px',
        ))).toBe(true)
        if (await page.getByRole('button', { name: '向右查看技能' }).count() > 0) {
          await page.getByRole('button', { name: '向右查看技能' }).click()
          await expect.poll(() => rail.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
          await page.getByRole('button', { name: '向左查看技能' }).click()
          await expect.poll(() => rail.evaluate(element => element.scrollLeft)).toBe(0)
          await rail.hover()
          await page.mouse.wheel(120, 0)
          await expect.poll(() => rail.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
          await rail.evaluate((element) => { element.scrollLeft = 0 })
          await rail.getByRole('button').first().focus()
          for (let index = 1; index < await rail.getByRole('button').count(); index++) await page.keyboard.press('Tab')
          expect(await rail.getByRole('button').last().evaluate(element => element === document.activeElement)).toBe(true)
          await rail.evaluate((element) => { element.scrollLeft = 0 })
        }
        const artwork = page.getByRole('button', { name: '馒头仔', exact: true }).locator('img')
        await expect.poll(() => artwork.getAttribute('src')).toBe(`./mantoo-${mode}-peek@3x.png`)
        await artwork.evaluate(image => (image as HTMLImageElement).decode())
        expect(await artwork.evaluate((image) => {
          const rect = image.getBoundingClientRect()
          const card = image.closest('[data-composer-seat]')!.querySelector('[data-composer-card]')!.getBoundingClientRect()
          return { width: rect.width, height: rect.height, contact: rect.top + 104 - card.top, right: card.right - rect.right }
        })).toEqual({ width: 184, height: 120, contact: 0, right: 12 })
        await expect.poll(() => page.getByRole('region', { name: '馒头仔' }).evaluate((element) => {
          const panel = element.getBoundingClientRect()
          const body = element.querySelector<HTMLElement>('[tabindex="0"]')!
          const seat = element.closest('[data-composer-seat]')!
          const mascot = seat.querySelector('img[src*="mantoo-"]')!.getBoundingClientRect()
          const protectedRects = [...seat.querySelectorAll(
            '[role="tablist"], [aria-label="推荐技能"] > *, [data-composer-card], [data-workspace-footer]',
          )]
            .map(node => node.getBoundingClientRect())
          return {
            readable: body.clientHeight >= parseFloat(getComputedStyle(body).lineHeight),
            fits: panel.left >= 0 && panel.right <= innerWidth && panel.top >= 0 && panel.bottom <= innerHeight,
            clear: protectedRects.every(rect => rect.right <= panel.left || rect.left >= panel.right
              || rect.bottom <= panel.top || rect.top >= panel.bottom),
            near: Math.abs(mascot.top - panel.bottom - 8) < 1,
          }
        })).toEqual({ readable: true, fits: true, clear: true, near: true }).catch(async (error: unknown) => {
          await mkdir(images, { recursive: true })
          await page.screenshot({ path: join(images, 'desktop-minimum-failure.png') })
          const geometry = await page.getByRole('region', { name: '馒头仔' }).evaluate((element) => {
            const body = element.querySelector<HTMLElement>('[tabindex="0"]')!
            const bounds = (node: Element) => {
              const { x, y, width, height } = node.getBoundingClientRect()
              return { x, y, width, height }
            }
            return { panel: bounds(element), textHeight: body.clientHeight,
              lineHeight: getComputedStyle(body).lineHeight, controls: [...element.closest('[data-composer-seat]')!
                .querySelectorAll('[role="tablist"], button[aria-haspopup="menu"], [data-composer-card]')]
                .map(node => ({ label: node.textContent, bounds: bounds(node) })) }
          })
          throw new Error(`Guide at ${width}×${height} (${name}): ${JSON.stringify(geometry)}`, { cause: error })
        })
        if (width === 880 && name === '漫剧制作') {
          await mkdir(images, { recursive: true })
          await page.screenshot({ path: join(images, 'desktop-minimum.png') })
        }
        if (width === 1280) {
          await mkdir(images, { recursive: true })
          for (const colorScheme of ['light', 'dark'] as const) {
            await page.emulateMedia({ colorScheme })
            await page.screenshot({ path: join(images, `mascot-${mode}-${colorScheme}.png`) })
          }
          await page.emulateMedia({ colorScheme: 'light' })
        }
        const body = page.getByRole('region', { name: '馒头仔' }).locator('[tabindex="0"]')
        if (await body.evaluate(element => element.scrollHeight > element.clientHeight)) {
          await body.hover()
          await page.mouse.wheel(0, 400)
          await expect.poll(() => body.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
          await page.mouse.wheel(0, -400)
          await expect.poll(() => body.evaluate(element => element.scrollTop)).toBe(0)
        }
        expect(await positions()).toEqual(before)
        await page.getByRole('button', { name: '关闭引导', exact: true }).click()
        expect(await positions()).toEqual(before)
        await page.getByRole('button', { name: '馒头仔', exact: true }).click()
        expect(await positions()).toEqual(before)
      }
    }
    expect(console.pageErrors).toEqual([])
  } finally {
    await browser?.close()
    await scaffold?.close()
    await new Promise<void>((resolve, reject) => server.close((error) => { if (error === undefined) resolve(); else reject(error) }))
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
    const selectWorkspace = async (pick: () => Promise<void>): Promise<void> => {
      const selected = page.getByRole('treeitem', { selected: true })
      const previous = (await selected.elementHandles())[0] ?? null
      try {
        await pick()
        // The chip changes optimistically; only the selected Session proves that draft handoff has settled.
        await expect.poll(() => selected.evaluateAll(
          (elements, before) => elements.length === 1 && elements[0] !== before, previous,
        )).toBe(true)
      } finally {
        await previous?.dispose()
      }
    }
    const chooseDirectory = async (path: string): Promise<void> => {
      const dialog = page.getByRole('dialog', { name: '选择工作区目录' })
      await dialog.getByRole('button', { name: '编辑路径' }).click()
      const pathInput = dialog.getByRole('textbox', { name: '编辑路径' })
      await pathInput.fill(path)
      await pathInput.press('Enter')
      await selectWorkspace(() => dialog.getByRole('button', { name: '打开', exact: true }).click())
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
    expect(await page.getByRole('button', { name: /访问模式/ }).count()).toBe(1)
    expect(await page.locator('[data-composer-card]').getByRole('button', { name: /访问模式/ }).count()).toBe(0)
    expect(await page.locator('[data-workspace-footer]').getByRole('button', { name: /访问模式/ }).count()).toBe(1)
    await page.getByRole('button', { name: '发送消息', exact: true }).focus()
    await page.keyboard.press('Tab')
    expect(await workspaceButton.evaluate(element => document.activeElement === element)).toBe(true)
    await page.keyboard.press('Tab')
    expect(await page.getByRole('button', { name: /访问模式/ }).evaluate(element => document.activeElement === element)).toBe(true)
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
    await selectWorkspace(() => menu.getByRole('menuitem', { name: 'workspace', exact: true }).click())
    await expect.poll(() => workspaceButton.innerText()).toBe('workspace')
    expect(await editor.innerText()).toContain('保留这个故事和参考图')
    expect(await page.getByRole('img', { name: 'reference.png' }).count()).toBe(attachments)
    const shortcut = page.getByRole('button', { name: '短剧编剧', exact: true })
    expect(await shortcut.getAttribute('title')).toBe(skill.name)
    await shortcut.click()
    await shortcut.click()
    await expect.poll(() => editor.innerText()).toContain('短剧编剧')
    expect((await editor.innerText()).split('短剧编剧')).toHaveLength(2)
    expect(await editor.innerText()).not.toContain(skill.name)
    expect(await page.getByRole('dialog').count()).toBe(0)
    expect(await editor.evaluate(element => document.activeElement === element)).toBe(true)
    const draftPositions = await composerPositions()
    await page.getByRole('tab', { name: '漫剧制作' }).click()
    await expect.poll(() => page.getByRole('tab', { name: '漫剧制作' }).getAttribute('aria-selected')).toBe('true')
    expect((await composerPositions()).card).toEqual(draftPositions.card)
    expect((await composerPositions()).shortcuts.y).toBe(draftPositions.shortcuts.y)
    expect(await editor.innerText()).toContain('保留这个故事和参考图')
    expect(await editor.innerText()).toContain('短剧编剧')
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
      const editorNode = element.querySelector('[contenteditable="true"]')
      const editor = editorNode?.getBoundingClientRect()
      const mascot = element.querySelector('img[src*="mantoo-"]')?.getBoundingClientRect()
      const helper = element.querySelector('button[aria-label="馒头仔"]')?.getBoundingClientRect()
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
        helperBottom: helper?.bottom,
        inputReceivesPointer: mascot !== undefined && editor !== undefined
          && document.elementFromPoint(mascot.left + mascot.width / 2, editor.top + 1)?.closest('[contenteditable="true"]') === editorNode,
        contactOffset: mascot !== undefined && card !== undefined ? mascot.top + 104 - card.top : undefined,
        emptyFits: empty !== null && empty.clientWidth >= empty.scrollWidth,
      }
    })
    expect(geometry.fits).toBe(true)
    expect(geometry.bubbleFits).toBe(true)
    expect(geometry.bubbleOverlaps).toBe(false)
    expect(geometry.bubbleAnchorGap).toBeGreaterThanOrEqual(7)
    expect(geometry.bubbleAnchorGap).toBeLessThanOrEqual(9)
    expect(geometry.helperBottom).toBeLessThanOrEqual(geometry.editorTop ?? 0)
    expect(geometry.inputReceivesPointer).toBe(true)
    expect(geometry.contactOffset).toBe(0)
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
  } catch (error) {
    const page = browser?.contexts()[0]?.pages()[0]
    if (page === undefined) throw error
    throw new Error(`${String(error)}\nVisible guide state:\n${await page.locator('body').ariaSnapshot()}`, { cause: error })
  } finally {
    await browser?.close()
    await scaffold?.close()
    await new Promise<void>((resolve, reject) => server.close((error) => { if (error === undefined) resolve(); else reject(error) }))
  }
})
