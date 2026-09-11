/** Real assembled Mantur UI with a simulated, secret-free preload. Not Electron, OS storage or real-site acceptance. */
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Page } from 'playwright'
import { expect, it, vi } from 'vitest'
import type {} from '@deepseek-ai/dsh-authorization-manturhub'
import type { NativeAccountAction, NativeAccountBridge, NativeAccountReply, NativeAccountSnapshot } from '@deepseek-ai/dsh-authorization-manturhub/types'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode } from './scaffold.ts'
import { ZH_BROWSER_LOCALE } from './support.ts'
import { prepareBundledSkills } from '../../../scripts/mantur-skills-resources.ts'

const overlay = fileURLToPath(new URL('../../../packages/bundle/mantur-app/cordis.patch.yml', import.meta.url))
const anchor = fileURLToPath(new URL('../../../packages/bundle/mantur-app/package.json', import.meta.url))
const expected = fileURLToPath(new URL('./expected/mantur-native-account.md', import.meta.url))
const images = fileURLToPath(new URL('../../../.artifacts/mantur-native-account', import.meta.url))
const bundledSource = fileURLToPath(new URL('../../desktop/mantur-skills/source.json', import.meta.url))

it('returns from both native marketplace entrypoints with the selected detail and complete unsent draft intact', async () => {
  const skill = { slug: 'short-drama', name: '爽文短剧剧本创作', description: '从创意到分集剧本。',
    category: '剧本创作', version: '1.0.0', triggers: ['写剧本'], uses_operators: [], kind: 'skill', assets: null }
  const requests: string[] = []
  const catalog = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`)
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(request.url === '/api/v1/skills' ? { skills: [skill] } : { skill }))
  })
  await new Promise<void>((resolve, reject) => { catalog.once('error', reject); catalog.listen(0, '127.0.0.1', resolve) })
  let scaffold: Awaited<ReturnType<typeof launchWebScaffold>> | undefined
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  let page: Page | undefined
  let restoreMode: (() => void) | undefined
  try {
    const address = catalog.address()
    if (address === null || typeof address === 'string') throw new Error('Expected fixture catalog port')
    scaffold = await launchWebScaffold({ extraOverlayPath: overlay, extraInstallAnchors: [anchor],
      manturHubBaseUrl: `http://127.0.0.1:${address.port}` })
    await prepareBundledSkills(bundledSource, join(scaffold.workspaceCwd, '.bundled-skills'))
    const mode = vi.spyOn(scaffold.ctx.manturAccount, 'identityMode').mockReturnValue('desktop-managed')
    const legacy = vi.spyOn(scaffold.ctx.manturAccount, 'startLogin')
    restoreMode = () => { mode.mockRestore(); legacy.mockRestore() }
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1280, height: 820 }, locale: ZH_BROWSER_LOCALE })
    const console = watchConsole(page)
    let prompts = 0
    page.on('request', (request) => { if (new URL(request.url()).pathname === '/api/session/prompt') prompts++ })
    let snapshot: NativeAccountSnapshot = { phase: 'signed-out', busy: false, authenticated: false, skipped: false, pendingRevocations: 0 }
    let revision = 0
    const preparing = Promise.withResolvers<NativeAccountReply>()
    let holdPreparation = true
    let nextFailure: 'local' | 'network' | 'endpoint-unavailable' | 'protocol' | undefined
    const operations: NativeAccountAction['kind'][] = []
    await page.exposeFunction('invokeNativeAccountFixture', (action: NativeAccountAction) => {
      operations.push(action.kind)
      if (action.kind === 'browser' && nextFailure !== undefined) {
        snapshot = { ...snapshot, phase: 'failed', busy: false, failure: { kind: nextFailure } }
        nextFailure = undefined
        return { ok: false, revision: ++revision, snapshot }
      }
      if (action.kind === 'browser' && holdPreparation) {
        holdPreparation = false
        return preparing.promise
      }
      if (action.kind === 'browser') snapshot = { ...snapshot, phase: 'authorizing',
        attempt: { expiresAt: 1_999_999_999_999 } }
      else if (action.kind === 'skip') snapshot = { phase: 'signed-out', busy: false,
        authenticated: false, skipped: true, pendingRevocations: 0 }
      else if (action.kind !== 'refresh') throw new Error(`Unexpected native action: ${action.kind}`)
      return { ok: true, revision: ++revision, snapshot }
    })
    await page.addInitScript(() => {
      const target = window as unknown as { manturAccount: NativeAccountBridge; invokeNativeAccountFixture: NativeAccountBridge['invoke'] }
      target.manturAccount = { invoke: action => target.invokeNativeAccountFixture(action), subscribe: (listener) => {
        const changed = (event: Event) => { listener((event as CustomEvent<unknown>).detail) }
        window.addEventListener('native-fixture-changed', changed)
        return () => { window.removeEventListener('native-fixture-changed', changed) }
      } }
    })
    await page.goto(scaffold.authenticatedUrl)
    const workspaceButton = page.locator('[data-workspace-footer]').getByRole('button', { name: '选择工作区' })
    await workspaceButton.click()
    const directory = page.getByRole('dialog', { name: '选择工作区目录' })
    await directory.getByRole('button', { name: '编辑路径' }).click()
    await directory.getByRole('textbox', { name: '编辑路径' }).fill(scaffold.workspaceCwd)
    await directory.getByRole('textbox', { name: '编辑路径' }).press('Enter')
    await directory.getByRole('button', { name: '打开', exact: true }).click()
    const selected = page.getByRole('treeitem', { selected: true })
    await selected.waitFor()
    const session = await selected.elementHandle()
    const editor = page.locator('[data-composer-input][contenteditable="true"]')
    const draft = '第一集：保留主角、场景和对白。\n不要发送，也不要安装技能。'
    await editor.fill(draft)
    await editor.evaluate((element) => {
      const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5FkAAAAASUVORK5CYII='), char => char.charCodeAt(0))
      const clipboard = new DataTransfer()
      clipboard.items.add(new File([bytes], 'native-reference.png', { type: 'image/png' }))
      element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true, cancelable: true }))
    })
    await page.getByRole('img', { name: 'native-reference.png' }).waitFor()
    const initialDraft = await editor.innerText()
    expect(initialDraft).toBe(draft)
    expect(operations).not.toContain('skip')
    expect(operations).not.toContain('browser')
    expect(await page.getByRole('heading', { name: '登录漫途账号' }).count()).toBe(0)
    const project = await workspaceButton.innerText()
    const model = await page.getByRole('button', { name: '选择模型' }).innerText()
    const permission = await page.getByRole('button', { name: /访问模式/ }).innerText()
    let detail = page.getByRole('dialog', { name: '剧本改编', exact: true })
    const account = page.getByRole('dialog', { name: '登录漫途账号', exact: true })
    const expectDetailFocus = (name: string) => expect.poll(() => detail.getByRole('button', { name, exact: true })
      .evaluate(element => document.activeElement === element)).toBe(true)
    const captures: string[] = []
    await page.getByRole('button', { name: '更多技能', exact: true }).click()
    await page.getByRole('button', { name: skill.name, exact: true }).click()
    await detail.getByRole('button', { name: '登录后安装' }).focus()
    await page.keyboard.press('Enter')
    await account.getByRole('button', { name: '返回创作' }).waitFor()
    expect(await detail.count()).toBe(0)
    expect(await page.getByRole('dialog').count()).toBe(1)
    captures.push(`## Native account from guide\n\n${await account.ariaSnapshot()}`)
    await page.keyboard.press('Escape')
    await detail.getByRole('button', { name: '登录后安装' }).waitFor()
    await expectDetailFocus('登录后安装')
    for (const kind of ['local', 'network', 'endpoint-unavailable', 'protocol'] as const) {
      await detail.getByRole('button', { name: '登录后安装' }).click()
      nextFailure = kind
      await account.getByRole('button', { name: '登录漫途账号', exact: true }).click()
      await account.getByRole('alert').waitFor()
      for (const name of ['登录漫途账号', '暂时跳过', '返回创作']) {
        await expect.poll(() => account.getByRole('button', { name, exact: true }).isEnabled()).toBe(true)
      }
      expect(snapshot).toMatchObject({ busy: false, authenticated: false, failure: { kind } })
      if (kind === 'endpoint-unavailable' || kind === 'protocol') {
        captures.push(`## ${kind}\n\n${await account.ariaSnapshot()}`)
      }
      await account.getByRole('button', { name: '返回创作' }).click()
      await detail.getByRole('button', { name: '登录后安装' }).waitFor()
      await expectDetailFocus('登录后安装')
      expect(await editor.innerText()).toBe(initialDraft)
      expect(await page.getByRole('img', { name: 'native-reference.png' }).count()).toBe(1)
    }
    await detail.getByRole('button', { name: '登录后安装' }).click()
    await account.getByRole('button', { name: '登录漫途账号', exact: true }).click()
    await expect.poll(() => account.getByRole('button', { name: '正在准备登录…' }).isDisabled()).toBe(true)
    await account.getByRole('button', { name: '暂时跳过' }).click()
    await detail.getByRole('button', { name: '登录后安装' }).waitFor()
    await expectDetailFocus('登录后安装')
    expect(snapshot).toMatchObject({ busy: false, authenticated: false, skipped: true })
    preparing.resolve({ ok: false, revision, failure: { kind: 'cancelled' } })
    captures.push(`## Guide after Skip\n\n${await detail.ariaSnapshot()}`)
    await detail.getByRole('button', { name: '关闭引导' }).click()
    detail = page.getByRole('dialog', { name: skill.name, exact: true })
    await page.getByRole('button', { name: '技能广场', exact: true }).click()
    await page.locator('article').getByRole('button', { name: /爽文短剧剧本创作/ }).click()
    await detail.getByRole('button', { name: '登录后安装' }).click()
    await account.getByRole('button', { name: '返回创作' }).click()
    await detail.getByRole('button', { name: '登录后安装' }).waitFor()
    await expectDetailFocus('登录后安装')
    await detail.getByRole('button', { name: '登录后安装' }).click()
    await account.getByRole('button', { name: '登录漫途账号', exact: true }).click()
    await account.getByRole('heading', { name: '等待网页授权' }).waitFor()
    expect(await detail.count()).toBe(0)
    snapshot = { phase: 'signed-in', authenticated: true, busy: false, skipped: true, pendingRevocations: 0,
      account: { displayName: 'Fixture creator', expiresAt: 1_999_999_999_999 } }
    await page.evaluate((publication) => {
      window.dispatchEvent(new CustomEvent('native-fixture-changed', { detail: publication }))
    }, { revision: ++revision, snapshot })
    await detail.getByRole('button', { name: '安装技能', exact: true }).waitFor()
    await expectDetailFocus('安装技能')
    expect(await account.count()).toBe(0)
    captures.push(`## Marketplace after login\n\n${await detail.ariaSnapshot()}`)
    await detail.getByRole('button', { name: '关闭', exact: true }).click()
    await page.getByRole('button', { name: '返回对话', exact: true }).click()
    await editor.waitFor()
    expect(await editor.innerText()).toBe(initialDraft)
    expect(await page.getByRole('img', { name: 'native-reference.png' }).count()).toBe(1)
    expect(await workspaceButton.innerText()).toBe(project)
    expect(await selected.evaluate((element, original) => element === original, session)).toBe(true)
    await session?.dispose()
    expect(await page.getByRole('button', { name: '选择模型' }).innerText()).toBe(model)
    expect(await page.getByRole('button', { name: /访问模式/ }).innerText()).toBe(permission)
    detail = page.getByRole('dialog', { name: '剧本改编', exact: true })
    await page.getByRole('button', { name: '更多技能', exact: true }).click()
    await page.getByRole('button', { name: skill.name, exact: true }).click()
    await detail.getByRole('button', { name: '安装后使用' }).waitFor()
    expect(legacy).not.toHaveBeenCalled()
    expect(requests.every(request => request === 'GET /api/v1/skills' || request === 'GET /api/v1/skills/short-drama')).toBe(true)
    expect(prompts).toBe(0)
    expect(operations).toEqual(['refresh', 'browser', 'browser', 'browser', 'browser', 'browser', 'skip', 'browser'])
    expect(console.pageErrors).toEqual([])
    await mkdir(images, { recursive: true })
    await page.screenshot({ path: join(images, 'native-entrypoints.png') })
    await compareOrRefreshGolden(fileURLToPath(new URL('./expected/mantur-native-entrypoints.md', import.meta.url)), captures.join('\n\n'), webSnapshotMode())
  } catch (error) {
    if (page !== undefined) {
      await mkdir(images, { recursive: true })
      await page.screenshot({ path: join(images, 'entrypoints-failure.png') })
      await writeFile(join(images, 'entrypoints-failure.md'), await page.locator('body').ariaSnapshot())
    }
    throw error
  } finally {
    await browser?.close()
    restoreMode?.()
    await scaffold?.close()
    await new Promise<void>((resolve, reject) => { catalog.close((error) => { if (error === undefined) resolve(); else reject(error) }) })
  }
})

function luminance(rgb: string): number {
  const channels = rgb.match(/[\d.]+/g)?.slice(0, 3).map(Number)
  if (channels?.length !== 3) throw new Error(`Expected computed RGB color: ${rgb}`)
  return channels.map(channel => channel / 255).map(channel => channel <= 0.04045
    ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index]!, 0)
}

it('opens optional account Settings and renders browser authorization failure and waiting at minimum size', async () => {
  const catalog = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ skills: [], recipes: [] }))
  })
  await new Promise<void>((resolve, reject) => { catalog.once('error', reject); catalog.listen(0, '127.0.0.1', resolve) })
  let scaffold: Awaited<ReturnType<typeof launchWebScaffold>> | undefined
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  let page: Page | undefined
  let restoreMode: (() => void) | undefined
  try {
    const address = catalog.address()
    if (address === null || typeof address === 'string') throw new Error('Expected fixture catalog port')
    scaffold = await launchWebScaffold({ extraOverlayPath: overlay, extraInstallAnchors: [anchor],
      manturHubBaseUrl: `http://127.0.0.1:${address.port}` })
    // Only the identity-selection observation is substituted. Production never selects mode from the presence of a browser global.
    const mode = vi.spyOn(scaffold.ctx.manturAccount, 'identityMode').mockReturnValue('desktop-managed')
    restoreMode = () => { mode.mockRestore() }
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1280, height: 820 }, locale: ZH_BROWSER_LOCALE })
    const console = watchConsole(page)
    let state: NativeAccountSnapshot = { phase: 'signed-out', busy: false, authenticated: false, skipped: false, pendingRevocations: 0 }
    let revision = 0
    const operations: NativeAccountAction['kind'][] = []
    await page.exposeFunction('invokeNativeAccountFixture', (request: NativeAccountAction) => {
      operations.push(request.kind)
      let ok = true
      switch (request.kind) {
        case 'snapshot': case 'refresh': case 'reopen-browser': case 'retry-revocations': break
        case 'switch-account': case 'browser':
          if (operations.filter(kind => kind === 'browser').length === 1) {
            state = { ...state, phase: 'failed', failure: { kind: 'network' } }
            ok = false
          } else {
            state = { ...state, phase: 'authorizing', failure: undefined, attempt: { expiresAt: Date.now() + 600_000 } }
          }
          break
        case 'skip': case 'sign-out': state = { phase: 'signed-out', busy: false, authenticated: false,
          skipped: request.kind === 'skip' || state.skipped, pendingRevocations: 0 }; break
      }
      return { ok, revision: ++revision, snapshot: state }
    })
    await page.addInitScript(() => {
      const target = window as unknown as { manturAccount: NativeAccountBridge; invokeNativeAccountFixture: NativeAccountBridge['invoke'] }
      target.manturAccount = { invoke: action => target.invokeNativeAccountFixture(action), subscribe: () => () => {} }
    })
    await page.goto(scaffold.authenticatedUrl)
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByRole('dialog', { name: '设置', exact: true }).getByRole('button', { name: '漫途账号', exact: true }).click()
    await page.getByRole('heading', { name: '登录漫途账号' }).waitFor()
    await mkdir(images, { recursive: true })
    const captures: string[] = []
    captures.push(`## Login\n\n${await captureStableAria(page, 'section[aria-labelledby]', scaffold.workspaceCwd)}`)
    await page.screenshot({ path: join(images, 'login-1280.png') })
    await page.setViewportSize({ width: 880, height: 600 })
    await page.getByRole('button', { name: '登录漫途账号', exact: true }).focus()
    await page.keyboard.press('Enter')
    await page.getByRole('region', { name: '登录漫途账号', exact: true }).getByRole('alert').waitFor()
    expect(await page.getByRole('region', { name: '登录漫途账号', exact: true }).getByRole('alert').innerText()).toBe('暂时无法连接漫途，请检查网络后重试。')
    expect(await page.getByRole('button', { name: '重新检查登录状态' }).count()).toBe(1)
    await page.getByRole('button', { name: '重新检查登录状态' }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(images, 'login-error-880.png') })
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme })
      await expect.poll(() => page!.locator('body').getAttribute('data-ds-dark-theme')).toBe(theme === 'dark' ? '' : null)
      const colors = await page.getByRole('region', { name: '登录漫途账号', exact: true }).getByRole('alert').evaluate((element) => {
        const layers: number[][] = []
        for (let parent: Element | null = element; parent !== null; parent = parent.parentElement) {
          const color = getComputedStyle(parent).backgroundColor.match(/[\d.]+/g)?.map(Number)
          if (color === undefined || (color.length !== 3 && color.length !== 4)) throw new Error('Unsupported computed background')
          layers.push([color[0]!, color[1]!, color[2]!, color[3] ?? 1])
          if (layers.at(-1)![3] === 1) break
        }
        if (layers.at(-1)?.[3] !== 1) throw new Error('Account background has no measured opaque ancestor')
        let background = layers.pop()!.slice(0, 3)
        for (const color of layers.reverse()) {
          const alpha = color[3]!
          background = background.map((channel, index) => color[index]! * alpha + channel * (1 - alpha))
        }
        return { error: getComputedStyle(element).color, background: `rgb(${background.join(', ')})` }
      })
      const contrast = (Math.max(luminance(colors.error), luminance(colors.background)) + 0.05)
        / (Math.min(luminance(colors.error), luminance(colors.background)) + 0.05)
      expect(contrast).toBeGreaterThanOrEqual(4.5)
      await page.screenshot({ path: join(images, `login-error-${theme}-880.png`) })
    }
    await page.emulateMedia({ colorScheme: 'light' })
    await page.getByRole('button', { name: '登录漫途账号', exact: true }).click()
    await page.getByRole('heading', { name: '等待网页授权' }).waitFor()
    expect(await page.getByText('已登录', { exact: true }).count()).toBe(0)
    expect(await page.locator('input').count()).toBe(0)
    captures.push(`## Browser waiting\n\n${await captureStableAria(page, 'section[aria-labelledby]', scaffold.workspaceCwd)}`)
    await page.screenshot({ path: join(images, 'browser-waiting-880.png') })
    await page.getByRole('button', { name: '重新打开授权页' }).click()
    expect(operations.filter(kind => kind === 'browser')).toHaveLength(2)
    expect(operations.filter(kind => kind === 'reopen-browser')).toHaveLength(1)
    await page.getByRole('button', { name: '取消登录' }).click()
    await page.reload()
    await page.getByRole('button', { name: '打开侧边栏', exact: true }).click()
    await page.getByRole('button', { name: '设置', exact: true }).waitFor()
    expect(await page.getByRole('heading', { name: '登录漫途账号' }).count()).toBe(0)
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByRole('dialog', { name: '设置', exact: true }).getByRole('button', { name: '漫途账号', exact: true }).click()
    await page.getByRole('heading', { name: '登录漫途账号' }).waitFor()
    expect(await page.getByRole('button', { name: '登录漫途账号', exact: true }).count()).toBe(1)
    expect(console.pageErrors).toEqual([])
    await compareOrRefreshGolden(expected, captures.join('\n\n'), webSnapshotMode())
  } catch (error) {
    if (page !== undefined) {
      await mkdir(images, { recursive: true })
      await page.screenshot({ path: join(images, 'failure.png') })
      await writeFile(join(images, 'failure.md'), await page.locator('body').ariaSnapshot())
    }
    throw error
  } finally {
    await browser?.close()
    restoreMode?.()
    await scaffold?.close()
    await new Promise<void>((resolve, reject) => { catalog.close((error) => { if (error === undefined) resolve(); else reject(error) }) })
  }
})
