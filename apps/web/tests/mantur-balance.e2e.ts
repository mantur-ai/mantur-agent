/** Real Mantur composition with a controlled account endpoint and secret-free native metadata. */
import { mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it, vi } from 'vitest'
import type {} from '@deepseek-ai/dsh-authorization-manturhub'
import { prepareBundledSkills } from '../../../scripts/mantur-skills-resources.ts'
import { compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode } from './scaffold.ts'

const overlay = fileURLToPath(new URL('../../../packages/bundle/mantur-app/cordis.patch.yml', import.meta.url))
const anchor = fileURLToPath(new URL('../../../packages/bundle/mantur-app/package.json', import.meta.url))
const artifacts = fileURLToPath(new URL('../../../.artifacts/mantur-balance/', import.meta.url))

it('shows server Mantou credits at the sidebar foot and clears stale balances on failures and logout', async () => {
  let balance = 1234.5
  let failed = false
  let accountReads = 0
  const server = createServer((request, response) => {
    if (request.url === '/api/v1/cli/session') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ device_code: 'fixture-device', user_code: 'TEST', verify_url: `http://${request.headers.host}/device`, interval: 1 }))
      return
    }
    if (request.url?.startsWith('/api/v1/cli/poll')) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ status: 'ready', key: 'fixture-only' }))
      return
    }
    const me = request.url === '/api/v1/me'
    if (me) accountReads++
    response.writeHead(me && failed ? 503 : 200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(me ? { email: 'artist@example.com', balance } : { skills: [] }))
  })
  let scaffold: Awaited<ReturnType<typeof launchWebScaffold>> | undefined
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('Fixture server did not bind')
    const origin = `http://127.0.0.1:${address.port}`
    scaffold = await launchWebScaffold({ extraOverlayPath: overlay, extraInstallAnchors: [anchor], manturHubBaseUrl: origin })
    await prepareBundledSkills(fileURLToPath(new URL('../../desktop/mantur-skills/source.json', import.meta.url)), join(scaffold.workspaceCwd, '.bundled-skills'))
    const login = await scaffold.ctx.manturAccount.startLogin()
    const account = scaffold.ctx.manturAccount
    await vi.waitFor(() => { expect(account.loginProgress(login.attemptId)).toMatchObject({ status: 'authorized' }) })
    vi.spyOn(scaffold.ctx.manturAccount, 'identityMode').mockReturnValue('desktop-managed')
    browser = await chromium.launch()
    const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1200, height: 800 } })
    const console = watchConsole(page)
    await page.addInitScript(() => {
      let listener: ((value: unknown) => void) | undefined
      let revision = 0
      let authenticated = true
      const snapshot = () => ({ revision: ++revision, snapshot: { phase: authenticated ? 'signed-in' : 'signed-out',
        busy: false, authenticated, skipped: false, pendingRevocations: 0,
        ...(authenticated ? { account: { displayName: 'Artist', expiresAt: 1_999_999_999_999 } } : {}) } })
      Object.assign(window, { balanceFixtureLogout: () => { authenticated = false; listener?.(snapshot()) },
        manturAccount: { invoke: async () => ({ ok: true, ...snapshot() }),
          subscribe: (next: (value: unknown) => void) => { listener = next; return () => { listener = undefined } } } })
    })
    await page.goto(scaffold.authenticatedUrl)
    const panel = page.getByRole('region', { name: '剩余馒头', exact: true })
    await panel.getByText('1,234.5', { exact: true }).waitFor()
    const settings = page.getByRole('button', { name: '设置', exact: true })
    const box = await panel.boundingBox()
    const settingsBox = await settings.boundingBox()
    if (box === null || settingsBox === null) throw new Error('Sidebar footer is hidden')
    expect(box.x).toBeLessThan(300)
    expect(box.y + box.height).toBeLessThanOrEqual(settingsBox.y)
    const captures = [`## Available\n\n${await panel.ariaSnapshot()}`]
    await mkdir(artifacts, { recursive: true })
    await page.screenshot({ animations: 'disabled', path: `${artifacts}/expanded.png` })
    balance = 0
    await panel.getByText('0', { exact: true }).waitFor()
    captures.push(`## Zero\n\n${await panel.ariaSnapshot()}`)
    failed = true
    await panel.getByRole('status', { name: '剩余馒头 · 余额读取失败', exact: true }).waitFor()
    expect(await panel.getByText('0', { exact: true }).count()).toBe(0)
    captures.push(`## Failed\n\n${await panel.ariaSnapshot()}`)
    failed = false
    balance = 88
    await panel.getByText('88', { exact: true }).waitFor()
    await page.getByRole('button', { name: '收起侧边栏' }).click()
    await expect.poll(async () => (await panel.boundingBox())?.width).toBeLessThan(50)
    await panel.getByText('88', { exact: true }).waitFor()
    captures.push(`## Collapsed\n\n${await panel.ariaSnapshot()}`)
    await page.screenshot({ animations: 'disabled', path: `${artifacts}/collapsed.png` })
    await page.evaluate(() => { (window as unknown as { balanceFixtureLogout: () => void }).balanceFixtureLogout() })
    expect(await panel.getByText('88', { exact: true }).count()).toBe(0)
    await panel.getByRole('status', { name: '剩余馒头 · 登录后查看', exact: true }).waitFor()
    expect(await panel.getByRole('button').count()).toBe(0)
    captures.push(`## Signed out\n\n${await panel.ariaSnapshot()}`)
    expect(accountReads).toBeGreaterThanOrEqual(4)
    await compareOrRefreshGolden(fileURLToPath(new URL('./expected/mantur-balance.md', import.meta.url)), captures.join('\n\n'), webSnapshotMode())
    expect(console.pageErrors).toEqual([])
  } finally {
    await browser?.close()
    vi.restoreAllMocks()
    await scaffold?.close()
    await new Promise<void>((resolve, reject) => server.close((error) => { if (error) reject(error); else resolve() }))
  }
})
