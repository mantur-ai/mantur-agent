/** Isolated native-message fixture over the real Mantur UI; never runs an installer or release check. */
import { mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode } from './scaffold.ts'

const overlay = fileURLToPath(new URL('../../../packages/bundle/mantur-app/cordis.patch.yml', import.meta.url))
const anchor = fileURLToPath(new URL('../../../packages/bundle/mantur-app/package.json', import.meta.url))
const artifacts = fileURLToPath(new URL('../../../.artifacts/desktop-update-fixture/', import.meta.url))

it('places native update status above Settings in expanded and collapsed sidebars', async () => {
  const server = createServer((_request, response) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end('{"skills":[]}') })
  let scaffold: Awaited<ReturnType<typeof launchWebScaffold>> | undefined
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    const address = server.address() as AddressInfo
    scaffold = await launchWebScaffold({ extraOverlayPath: overlay, extraInstallAnchors: [anchor], manturHubBaseUrl: `http://127.0.0.1:${address.port}` })
    browser = await chromium.launch()
    const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1200, height: 800 } })
    const console = watchConsole(page)
    await page.addInitScript(() => {
      let listener: ((snapshot: unknown) => void) | undefined
      let revision = 0
      const snapshot = (state: unknown) => ({ revision: ++revision, enabled: true, currentVersion: '1.0.0', state })
      const actions: string[] = []
      Object.assign(window, {
        testNativeActions: actions,
        testNativeState: (state: unknown) => listener?.(snapshot(state)),
        manturUpdates: {
          getSnapshot: async () => snapshot({ kind: 'idle' }),
          subscribe: (next: (value: unknown) => void) => { listener = next; return () => { listener = undefined } },
          check: async () => { actions.push('check') }, download: async () => { actions.push('download') }, install: async () => { actions.push('install') },
        },
      })
    })
    await page.goto(scaffold.authenticatedUrl)
    const settings = page.getByRole('button', { name: '设置', exact: true })
    await settings.waitFor()
    const captures: string[] = []
    const check = page.getByRole('button', { name: '检查更新', exact: true })
    await check.waitFor()
    captures.push(`## Idle\n\n${await page.getByRole('region', { name: '当前版本 1.0.0', exact: true }).ariaSnapshot()}`)
    await check.click()
    expect(await page.getByRole('button', { name: '下载更新', exact: true }).count()).toBe(0)
    const state = async (value: unknown) => page.evaluate((value) => {
      (window as unknown as { testNativeState: (state: unknown) => void }).testNativeState(value)
    }, value)
    await state({ kind: 'up-to-date', requestedByUser: true })
    await page.getByText('已是最新版本', { exact: true }).waitFor()
    captures.push(`## Current\n\n${await page.getByRole('region', { name: '已是最新版本', exact: true }).ariaSnapshot()}`)
    await check.click()
    await state({ kind: 'error', detail: 'Release feed unavailable', requestedByUser: false })
    await page.getByRole('button', { name: '重新检查', exact: true }).waitFor()
    expect(await page.getByText('已是最新版本', { exact: true }).count()).toBe(0)
    captures.push(`## Failed\n\n${await page.getByRole('region', { name: '更新未完成', exact: true }).ariaSnapshot()}`)
    await page.getByRole('button', { name: '重新检查', exact: true }).click()
    await state({ kind: 'available', version: '1.2.0', prompting: false })
    const download = page.getByRole('button', { name: '下载更新', exact: true })
    await download.waitFor()
    const downloadBox = await download.boundingBox()
    const settingsBox = await settings.boundingBox()
    if (downloadBox === null || settingsBox === null) throw new Error('Native update or Settings control is hidden')
    expect(downloadBox.y + downloadBox.height).toBeLessThanOrEqual(settingsBox.y)
    await download.click()
    expect(await page.evaluate(() => (window as unknown as { testNativeActions: string[] }).testNativeActions)).toEqual(['check', 'check', 'check', 'download'])
    await state({ kind: 'downloading', version: '1.2.0', percent: 37, transferred: 38797312, total: 104857600 })
    await page.getByRole('progressbar').waitFor()
    expect(await page.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('37')
    await mkdir(artifacts, { recursive: true })
    await page.screenshot({ path: `${artifacts}/expanded.png` })
    await page.getByRole('button', { name: '收起侧边栏' }).click()
    await page.getByText('37%', { exact: true }).waitFor()
    await state({ kind: 'downloading', version: '1.2.0', percent: null, transferred: 40000000, total: null })
    expect(await page.getByRole('progressbar').getAttribute('aria-valuenow')).toBeNull()
    await state({ kind: 'ready', version: '1.2.0', prompting: false })
    const install = page.getByRole('button', { name: /下载完成，重启安装.*重启并更新/u })
    await install.waitFor()
    await page.screenshot({ path: `${artifacts}/collapsed.png` })
    await install.click()
    await state({ kind: 'idle' })
    const collapsedCheck = page.getByRole('button', { name: '当前版本 1.0.0 · 检查更新', exact: true })
    await collapsedCheck.waitFor()
    captures.push(`## Collapsed idle\n\n${await collapsedCheck.ariaSnapshot()}`)
    await collapsedCheck.click()
    await page.screenshot({ path: `${artifacts}/check-collapsed.png` })
    expect(await page.evaluate(() => (window as unknown as { testNativeActions: string[] }).testNativeActions)).toEqual(['check', 'check', 'check', 'download', 'install', 'check'])
    await compareOrRefreshGolden(fileURLToPath(new URL('./expected/desktop-updates.md', import.meta.url)), captures.join('\n\n'), webSnapshotMode())
    expect(console.pageErrors).toEqual([])
    expect(console.warnings).toEqual([])
  } finally {
    try { await browser?.close() }
    finally {
      try { await scaffold?.close() }
      finally {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error === undefined) resolve()
            else reject(error)
          })
        })
      }
    }
  }
})
