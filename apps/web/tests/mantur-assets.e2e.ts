/** Both operator reports through the shipped browser, generated RPC and local media route. */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { launchWebScaffold, watchConsole, captureStableAria, compareOrRefreshGolden, webSnapshotMode } from './scaffold.ts'
import { writeComposerDraft, ZH_BROWSER_LOCALE } from './support.ts'

it('loads asset and Clip operator outputs and previews real image and video bytes through RPC', async () => {
  const scaffold = await launchWebScaffold({
    extraOverlayPath: fileURLToPath(new URL('../../../packages/bundle/mantur-app/cordis.patch.yml', import.meta.url)),
    extraInstallAnchors: [fileURLToPath(new URL('../../../packages/bundle/mantur-app/package.json', import.meta.url))],
    replayFixture: fileURLToPath(new URL('../../../snapshots/web/lifecycle-chrome/session.jsonl', import.meta.url)),
    compareReplaySession: false,
  })
  let imageRequests = 0
  let imagesOnline = true
  const imageServer = createServer((_request, response) => {
    imageRequests++
    if (!imagesOnline) { response.writeHead(403); response.end(); return }
    response.writeHead(200, { 'content-type': 'image/png' })
    response.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP9sAAAAASUVORK5CYII=', 'base64'))
  })
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    await new Promise<void>((resolve, reject) => { imageServer.once('error', reject); imageServer.listen(0, '127.0.0.1', resolve) })
    const referenceUrl = `http://127.0.0.1:${(imageServer.address() as AddressInfo).port}/image.png`
    const workspace = join(scaffold.workspaceCwd, 'asset-preview')
    const reportDir = join(workspace, '资产/资产提取结果')
    await mkdir(reportDir, { recursive: true })
    await writeFile(join(workspace, 'character.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP9sAAAAASUVORK5CYII=', 'base64'))
    await copyFile(fileURLToPath(new URL('../../../prototypes/drama-asset-workbench/media/clip.mp4', import.meta.url)), join(workspace, 'clip.mp4'))
    const asset = { schema_version: '1.0', 项目美术规范: [],
      角色资产: [{ 资产ID: 'CHAR-001', 角色名: '测试角色', 角色提示词: '窗边自然光', 负面提示词: '模糊', 图片URL: '', 变体名: '校服' }],
      场景资产: [{ 资产ID: 'SCENE-001', 场景名: '庭院', 场景提示词: '清晨庭院', 负面提示词: '', 图片URL: '' }], 道具资产: [] }
    const clip = { schema_version: 'drama-storyboard-seedance-v2',
      Clip总表: [{ 'Clip ID': 'CLIP-001', 集数: 1, 集内序号: 1, 时长秒: 3, 场景: '庭院', 场次组: 'SCENE-001', 最终提示词: '缓慢推进' }],
      'Seedance2.0请求体': [{ 'Clip ID': 'CLIP-001', 最终提示词: '缓慢推进', 成片URL: 'clip.mp4', 图片引用: [{ asset_id: 'CHAR-001', url: referenceUrl }], 请求体模板JSON: { prompt: '缓慢推进' }, 实际提示词: '实际提交记录', 实际请求体JSON: { prompt: '实际提交记录' } }] }
    await mkdir(join(workspace, 'exports'))
    await writeFile(join(reportDir, 'clips.manifest.json'), JSON.stringify([{ clip_id: 'CLIP-001', file: '../../clip.mp4', sha256: createHash('sha256').update(await readFile(join(workspace, 'clip.mp4'))).digest('hex') }]))
    const assetsPath = join(reportDir, 'assets-report.json'); const clipsPath = join(reportDir, 'clip-seedance-report.json')
    await writeFile(assetsPath, JSON.stringify(asset)); await writeFile(clipsPath, JSON.stringify(clip))
    browser = await chromium.launch()
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, locale: ZH_BROWSER_LOCALE })
    const console = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl)
    await page.getByRole('button', { name: '选择工作区', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '选择工作区目录' })
    await dialog.getByRole('button', { name: '编辑路径' }).click()
    const path = dialog.getByRole('textbox', { name: '编辑路径' })
    await path.fill(workspace); await path.press('Enter')
    await dialog.getByRole('button', { name: '打开', exact: true }).click()
    const editor = page.locator('[data-composer-input][contenteditable="true"]').first()
    await writeComposerDraft(page, editor, 'Reply with the single word LIGHTHOUSE and stop.')
    const settled = scaffold.whenTurnSettled()
    await page.getByRole('button', { name: '发送消息', exact: true }).click(); await settled
    await page.getByText('LIGHTHOUSE', { exact: true }).waitFor()
    await page.getByRole('button', { name: '展开工作台', exact: true }).click()
    await page.getByRole('button', { name: '资产', exact: true }).click()
    const panel = page.getByRole('region', { name: '资产工作台', exact: true })
    expect(await panel.getByLabel('流水线报告', { exact: true }).count()).toBe(0)
    expect(await panel.getByLabel('关联分镜报告（可选）').count()).toBe(0)
    await panel.getByRole('button', { name: 'CHAR-001 测试角色' }).click()
    await expect.poll(() => panel.locator('article img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1)
    await panel.getByRole('textbox', { name: '提示词', exact: true }).fill('用户保存的草稿')
    await panel.getByRole('button', { name: '保存草稿' }).click()
    await expect.poll(() => panel.getAttribute('aria-busy')).toBe('false')
    expect(JSON.parse(await readFile(assetsPath, 'utf8'))).toEqual(asset)
    const artifacts = fileURLToPath(new URL('../../../.artifacts/mantur-assets/', import.meta.url))
    await mkdir(artifacts, { recursive: true })
    await page.screenshot({ path: join(artifacts, 'assets.png'), animations: 'disabled' })
    const assetAria = await captureStableAria(page, '[aria-label="资产工作台"]', scaffold.workspaceCwd)
    imagesOnline = false
    const remoteRequestsBefore = imageRequests
    await writeFile(join(reportDir, 'local-images.manifest.json'), JSON.stringify([{ asset_id: 'CHAR-001', file: '../../character.png', sha256: createHash('sha256').update(await readFile(join(workspace, 'character.png'))).digest('hex') }]))
    await panel.getByRole('button', { name: '刷新', exact: true }).click()
    await panel.getByRole('button', { name: 'CHAR-001 测试角色' }).click()
    await expect.poll(() => panel.locator('article img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1)
    expect(await panel.locator('article img').getAttribute('src')).toContain('/api/mantur-assets.media?token=')
    expect(await panel.locator('article header').innerText()).toContain('本地文件')
    expect(imageRequests).toBe(remoteRequestsBefore)
    expect(JSON.parse(await readFile(assetsPath, 'utf8'))).toEqual(asset)
    await panel.getByRole('tab', { name: '分镜 / Clip 列表' }).click()
    await panel.getByRole('button', { name: 'CLIP-001 庭院' }).click()
    const video = panel.locator('article video')
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(1)
    await video.evaluate(async (element: HTMLVideoElement) => { element.muted = true; await element.play() })
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0)
    await video.evaluate((element: HTMLVideoElement) =>{  element.pause() })
    await panel.getByText('全部原始字段', { exact: true }).click()
    await panel.getByText('时长秒', { exact: true }).waitFor()
    await panel.evaluate((element) => { element.scrollTop = 0 })
    await page.screenshot({ path: join(artifacts, 'clips.png'), animations: 'disabled' })
    for (const width of [1024, 1280]) {
      await page.setViewportSize({ width, height: 820 })
      expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    }
    expect(await panel.getByRole('alert').count()).toBe(0)
    expect(console.pageErrors).toEqual([])
    await compareOrRefreshGolden(fileURLToPath(new URL('./expected/mantur-assets.md', import.meta.url)), assetAria, webSnapshotMode())
  } finally {
    await browser?.close()
    await new Promise<void>((resolve, reject) => imageServer.close((error) => { if (error) reject(error); else resolve() }))
    await scaffold.close()
  }
})
