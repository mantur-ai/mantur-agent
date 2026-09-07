/** Explicit download consent, real progress, confirmation, and failed restart behavior. */
import { EventEmitter } from 'node:events'
import { setImmediate } from 'node:timers/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { allowsPrerelease, startAutoUpdates, type DesktopUpdater, type StartAutoUpdatesOptions } from '../src/updater.ts'

class FakeUpdater extends EventEmitter implements DesktopUpdater {
  autoDownload = true
  autoInstallOnAppQuit = true
  allowPrerelease = false
  checkForUpdates = vi.fn(async () => null)
  downloadUpdate = vi.fn(async () => [])
  quitAndInstall = vi.fn()
}
const disposers: (() => void)[] = []
afterEach(() => { for (const dispose of disposers.splice(0)) dispose(); vi.useRealTimers() })
function start(overrides: Partial<StartAutoUpdatesOptions> = {}) {
  const updater = new FakeUpdater()
  const confirmInstall = vi.fn(async () => false)
  const beforeInstall = vi.fn(async () => {})
  const controller = startAutoUpdates({ updater, currentVersion: '1.0.0', prompts: { confirmInstall }, beforeInstall, onStateChange: vi.fn(), log: vi.fn(), ...overrides })
  disposers.push(controller.dispose)
  return { updater, confirmInstall, beforeInstall, controller }
}

describe('desktop updates', () => {
  it.each([['1.2.3', false], ['1.2.3-alpha.4', true], ['1.2.3-beta.2', true], ['1.2.3-rc.1', true], ['1.2.3-preview.1', false]])('selects the release channel for %s', (version, expected) => {
    expect(allowsPrerelease(version)).toBe(expected)
    expect(start({ currentVersion: version }).updater.allowPrerelease).toBe(expected)
  })
  it('checks silently and leaves an available version until an explicit download', async () => {
    vi.useFakeTimers()
    const { updater, controller, confirmInstall } = start({ checkDelayMs: 10, checkIntervalMs: 100 })
    expect(updater.autoDownload).toBe(false)
    expect(updater.autoInstallOnAppQuit).toBe(false)
    await vi.advanceTimersByTimeAsync(10)
    expect(updater.checkForUpdates).toHaveBeenCalledOnce()
    updater.emit('update-available', { version: '1.2.3' })
    await vi.advanceTimersByTimeAsync(100)
    expect(controller.getState()).toEqual({ kind: 'available', version: '1.2.3', prompting: false })
    expect(updater.checkForUpdates).toHaveBeenCalledOnce()
    expect(updater.downloadUpdate).not.toHaveBeenCalled()
    expect(confirmInstall).not.toHaveBeenCalled()
    controller.downloadAvailableUpdate()
    controller.downloadAvailableUpdate()
    controller.checkNow()
    await Promise.resolve()
    expect(updater.downloadUpdate).toHaveBeenCalledOnce()
    expect(controller.getState()).toEqual({ kind: 'downloading', version: '1.2.3', percent: null, transferred: 0, total: null })
  })
  it('keeps unknown totals indeterminate and publishes actual bytes with finite percentages', () => {
    const { updater, controller } = start()
    updater.emit('update-available', { version: '1.2.3' })
    controller.downloadAvailableUpdate()
    updater.emit('download-progress', { percent: 42.9, transferred: 429, total: 1000 })
    expect(controller.getState()).toMatchObject({ percent: 42, transferred: 429, total: 1000 })
    updater.emit('download-progress', { percent: 100, transferred: 512, total: 0 })
    expect(controller.getState()).toMatchObject({ percent: null, transferred: 512, total: null })
    updater.emit('download-progress', { percent: Number.NaN, transferred: 600, total: 1000 })
    expect(controller.getState()).toMatchObject({ percent: null, transferred: 600, total: 1000 })
    updater.emit('download-progress', { percent: 104, transferred: 1000, total: 1000 })
    expect(controller.getState()).toMatchObject({ percent: 100 })
    updater.emit('update-not-available', { version: '1.0.0' })
    expect(controller.getState().kind).toBe('downloading')
  })
  it('does not start a second operation while a failed download is still settling', async () => {
    let rejectDownload!: (error: Error) => void
    const { updater, controller } = start()
    updater.downloadUpdate.mockImplementation(() => new Promise<[]>((_resolve, reject) => { rejectDownload = reject }))
    updater.emit('update-available', { version: '1.2.3' })
    controller.downloadAvailableUpdate()
    await Promise.resolve()
    updater.emit('error', new Error('network error'))
    controller.checkNow()
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
    rejectDownload(new Error('network error'))
    await vi.waitFor(() => { expect(controller.getState().kind).toBe('error') })
    await setImmediate()
    controller.checkNow()
    expect(updater.checkForUpdates).toHaveBeenCalledOnce()
  })
  it('retains manual no-update and feed-error feedback', async () => {
    const { updater, controller } = start()
    controller.checkNow()
    updater.emit('update-not-available', {})
    expect(controller.getState()).toEqual({ kind: 'up-to-date', requestedByUser: true })
    updater.checkForUpdates.mockRejectedValueOnce(new Error('offline'))
    controller.checkNow()
    await vi.waitFor(() => { expect(controller.getState()).toEqual({ kind: 'error', detail: 'offline', requestedByUser: true }) })
  })
  it('reports download verification errors without ever showing a ready state', async () => {
    const { updater, controller } = start()
    updater.downloadUpdate.mockRejectedValueOnce(new Error('checksum mismatch'))
    updater.emit('update-available', { version: '1.2.3' })
    controller.downloadAvailableUpdate()
    await vi.waitFor(() => { expect(controller.getState()).toEqual({ kind: 'error', detail: 'checksum mismatch', requestedByUser: true }) })
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
  })
  it('Later and repeated downloaded events neither stop tasks nor repeat the dialog', async () => {
    const { updater, controller, confirmInstall, beforeInstall } = start()
    updater.emit('update-downloaded', { version: '1.2.3' })
    await vi.waitFor(() => { expect(controller.getState()).toEqual({ kind: 'ready', version: '1.2.3', prompting: false }) })
    updater.emit('update-downloaded', { version: '1.2.3' })
    expect(confirmInstall).toHaveBeenCalledOnce()
    expect(beforeInstall).not.toHaveBeenCalled()
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
    controller.installReadyUpdate()
    await vi.waitFor(() => { expect(confirmInstall).toHaveBeenCalledTimes(2) })
  })
  it('keeps a verified download retryable after a refused save without running the installer', async () => {
    const beforeInstall = vi.fn(async () => { throw new Error('final checkpoint unavailable') })
    const confirmInstall = vi.fn(async () => true)
    const { updater, controller } = start({ beforeInstall, prompts: { confirmInstall } })
    updater.emit('update-downloaded', { version: '1.2.3' })
    await vi.waitFor(() => { expect(controller.getState()).toEqual({ kind: 'ready', version: '1.2.3', prompting: false, error: 'final checkpoint unavailable' }) })
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
    controller.installReadyUpdate()
    await vi.waitFor(() => { expect(beforeInstall).toHaveBeenCalledTimes(2) })
  })
  it('waits for confirmation and successful persistence, with one installation despite duplicate clicks', async () => {
    let confirm!: (value: boolean) => void
    let saved!: () => void
    const confirmation = new Promise<boolean>((resolve) => { confirm = resolve })
    const persistence = new Promise<void>((resolve) => { saved = resolve })
    const beforeInstall = vi.fn(() => persistence)
    const prompt = vi.fn(() => confirmation)
    const { updater, controller } = start({ beforeInstall, prompts: { confirmInstall: prompt } })
    updater.emit('update-downloaded', { version: '1.2.3' })
    controller.installReadyUpdate()
    await vi.waitFor(() => { expect(prompt).toHaveBeenCalledOnce() })
    expect(beforeInstall).not.toHaveBeenCalled()
    confirm(true)
    await vi.waitFor(() => { expect(beforeInstall).toHaveBeenCalledOnce() })
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
    controller.installReadyUpdate()
    saved()
    await vi.waitFor(() => { expect(updater.quitAndInstall).toHaveBeenCalledExactlyOnceWith(false, true) })
  })
  it('invalidates a pending confirmation on updater error', async () => {
    let confirm!: (value: boolean) => void
    const confirmation = new Promise<boolean>((resolve) => { confirm = resolve })
    const { updater, controller, beforeInstall } = start({ prompts: { confirmInstall: () => confirmation } })
    updater.emit('update-downloaded', { version: '1.2.3' })
    updater.emit('error', new Error('installer unavailable'))
    confirm(true)
    await Promise.resolve(); await Promise.resolve()
    expect(controller.getState()).toMatchObject({ kind: 'ready', prompting: false, error: 'installer unavailable' })
    expect(beforeInstall).not.toHaveBeenCalled()
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
  })
  it('ignores confirmation completion and actions after disposal', async () => {
    let confirm!: (value: boolean) => void
    const confirmation = new Promise<boolean>((resolve) => { confirm = resolve })
    const { updater, controller, beforeInstall } = start({ prompts: { confirmInstall: () => confirmation } })
    updater.emit('update-downloaded', { version: '1.2.3' })
    controller.dispose()
    confirm(true)
    await Promise.resolve(); await Promise.resolve()
    controller.checkNow(); controller.downloadAvailableUpdate(); controller.installReadyUpdate()
    expect(beforeInstall).not.toHaveBeenCalled()
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
    expect(updater.listenerCount('update-downloaded')).toBe(0)
  })
})
