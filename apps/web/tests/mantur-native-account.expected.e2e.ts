/** Real assembled Mantur UI with a simulated, secret-free preload. Not Electron, OS storage or real-site acceptance. */
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Page } from 'playwright'
import { expect, it, vi } from 'vitest'
import type {} from '@deepseek-ai/dsh-authorization-manturhub'
import type { NativeAccountAction, NativeAccountBridge, NativeAccountSnapshot } from '@deepseek-ai/dsh-authorization-manturhub/types'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode } from './scaffold.ts'
import { ZH_BROWSER_LOCALE } from './support.ts'

const overlay = fileURLToPath(new URL('../../../packages/bundle/mantur-app/cordis.patch.yml', import.meta.url))
const anchor = fileURLToPath(new URL('../../../packages/bundle/mantur-app/package.json', import.meta.url))
const expected = fileURLToPath(new URL('./expected/mantur-native-account.md', import.meta.url))
const images = fileURLToPath(new URL('../../../.artifacts/mantur-native-account', import.meta.url))

function luminance(rgb: string): number {
  const channels = rgb.match(/[\d.]+/g)?.slice(0, 3).map(Number)
  if (channels?.length !== 3) throw new Error(`Expected computed RGB color: ${rgb}`)
  return channels.map(channel => channel / 255).map(channel => channel <= 0.04045
    ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index]!, 0)
}

it('renders native registration and browser waiting at minimum size, then keeps Skip across renderer reload', async () => {
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
      let codeExpirySeconds: number | undefined
      switch (request.kind) {
        case 'snapshot': case 'refresh': case 'poll': case 'reopen-browser': case 'retry-revocations': break
        case 'send-code': codeExpirySeconds = 600; break
        case 'register': state = { ...state, phase: 'pending-activation', failure: undefined }; break
        case 'browser': state = { ...state, phase: 'authorizing', failure: undefined, attempt: {
          userCode: 'ABCD-EFGH', verificationUrl: 'https://fixture.invalid/auth/agent?user_code=ABCD-EFGH', expiresAt: Date.now() + 600_000,
        } }; break
        case 'password': state = { ...state, phase: 'failed', failure: { kind: 'remote', code: 'INVALID_CREDENTIALS' } }; ok = false; break
        case 'skip': case 'sign-out': state = { phase: 'signed-out', busy: false, authenticated: false,
          skipped: request.kind === 'skip' || state.skipped, pendingRevocations: 0 }; break
      }
      return { ok, revision: ++revision, snapshot: state, ...(codeExpirySeconds === undefined ? {} : { codeExpirySeconds }) }
    })
    await page.addInitScript(() => {
      const target = window as unknown as { manturAccount: NativeAccountBridge; invokeNativeAccountFixture: NativeAccountBridge['invoke'] }
      target.manturAccount = { invoke: action => target.invokeNativeAccountFixture(action), subscribe: () => () => {} }
    })
    await page.goto(scaffold.authenticatedUrl)
    await page.getByRole('heading', { name: '登录漫途账号' }).waitFor()
    await mkdir(images, { recursive: true })
    const captures: string[] = []
    captures.push(`## Login\n\n${await captureStableAria(page, 'section[aria-labelledby]', scaffold.workspaceCwd)}`)
    await page.screenshot({ path: join(images, 'login-1280.png') })
    await page.setViewportSize({ width: 880, height: 600 })
    await page.getByLabel('邮箱', { exact: true }).focus()
    await page.keyboard.press('Tab')
    expect(await page.getByLabel('密码', { exact: true }).evaluate(element => document.activeElement === element)).toBe(true)
    await page.getByLabel('邮箱', { exact: true }).fill('fixture@example.com')
    await page.getByLabel('密码', { exact: true }).fill('Fixture-only password')
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await page.getByRole('alert').waitFor()
    expect(await page.getByRole('alert').innerText()).toBe('账号或登录凭据不正确，请检查后重试。')
    expect(await page.getByRole('button', { name: '重新检查登录状态' }).count()).toBe(0)
    await page.getByRole('button', { name: '暂时跳过' }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(images, 'login-error-880.png') })
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme })
      await expect.poll(() => page!.locator('body').getAttribute('data-ds-dark-theme')).toBe(theme === 'dark' ? '' : null)
      const colors = await page.getByRole('alert').evaluate(element => ({
        error: getComputedStyle(element).color,
        background: getComputedStyle(element.closest('section')!.parentElement!).backgroundColor,
      }))
      const contrast = (Math.max(luminance(colors.error), luminance(colors.background)) + 0.05)
        / (Math.min(luminance(colors.error), luminance(colors.background)) + 0.05)
      expect(contrast).toBeGreaterThanOrEqual(4.5)
      await page.screenshot({ path: join(images, `login-error-${theme}-880.png`) })
    }
    await page.emulateMedia({ colorScheme: 'light' })
    await page.getByRole('button', { name: '注册账号', exact: true }).click()
    await page.getByRole('heading', { name: '注册漫途账号' }).waitFor()
    await page.getByLabel('邮箱', { exact: true }).fill('fixture-new@example.com')
    await page.getByLabel('密码', { exact: true }).fill('Fixture-only new password')
    await page.getByRole('button', { name: '发送验证码' }).click()
    await page.getByText('验证码已发送，请查收邮件。', { exact: true }).waitFor()
    await page.getByRole('button', { name: '有邀请码？' }).click()
    await page.getByLabel('邀请码（选填）').fill('fixture-invite')
    await page.getByRole('button', { name: '注册账号', exact: true }).click()
    await page.getByText('请输入邮箱验证码。', { exact: true }).waitFor()
    captures.push(`## Registration validation\n\n${await captureStableAria(page, 'section[aria-labelledby]', scaffold.workspaceCwd)}`)
    await page.getByRole('button', { name: '暂时跳过' }).scrollIntoViewIfNeeded()
    expect(await page.getByRole('button', { name: '暂时跳过' }).evaluate((element) => {
      const rect = element.getBoundingClientRect()
      return rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth
    })).toBe(true)
    await page.screenshot({ path: join(images, 'registration-expanded-880.png') })
    await page.getByRole('heading', { name: '注册漫途账号' }).scrollIntoViewIfNeeded()
    expect(await page.getByRole('heading', { name: '注册漫途账号' }).isVisible()).toBe(true)
    await page.getByRole('button', { name: '暂时跳过' }).scrollIntoViewIfNeeded()
    await page.getByLabel('邮箱验证码').fill('123456')
    await page.getByRole('button', { name: '注册账号', exact: true }).click()
    await page.getByRole('heading', { name: '注册申请已提交' }).waitFor()
    expect(await page.getByText('已登录', { exact: true }).count()).toBe(0)
    await page.getByRole('button', { name: '返回登录' }).click()
    await page.getByRole('button', { name: '使用 Google 登录' }).click()
    await page.getByRole('heading', { name: '完成 Google 登录' }).waitFor()
    captures.push(`## Google waiting\n\n${await captureStableAria(page, 'section[aria-labelledby]', scaffold.workspaceCwd)}`)
    await page.screenshot({ path: join(images, 'google-waiting-880.png') })
    await page.getByRole('button', { name: '重新打开授权页' }).click()
    expect(operations.filter(kind => kind === 'browser')).toHaveLength(1)
    expect(operations.filter(kind => kind === 'reopen-browser')).toHaveLength(1)
    await page.getByRole('button', { name: '取消登录' }).click()
    await page.getByRole('button', { name: '暂时跳过' }).click()
    await page.getByRole('heading', { name: '登录漫途账号' }).waitFor({ state: 'detached' })
    await page.reload()
    await page.getByRole('button', { name: '打开侧边栏', exact: true }).click()
    await page.getByRole('button', { name: '设置', exact: true }).waitFor()
    expect(await page.getByRole('heading', { name: '登录漫途账号' }).count()).toBe(0)
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByRole('dialog', { name: '设置', exact: true }).getByRole('button', { name: '漫途账号', exact: true }).click()
    await page.getByRole('heading', { name: '登录漫途账号' }).waitFor()
    expect(await page.getByRole('button', { name: '使用 Google 登录' }).count()).toBe(1)
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
