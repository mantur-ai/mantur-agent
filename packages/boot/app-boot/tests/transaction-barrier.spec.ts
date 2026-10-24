/** Real Entry/Include transactions paused inside the target plugin's apply. */
import { mkdtempSync, unlinkSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Hmr from '@deepseek-ai/cordis-plugin-hmr'
import Timer from '@deepseek-ai/cordis-plugin-timer'
import { expect, it, vi } from 'vitest'
import { boot, watchUserPatches } from '../src/index.ts'

function bounded<T>(promise: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => { timer = setTimeout(() => { reject(new Error(message)) }, 10_000) }),
  ]).finally(() => { clearTimeout(timer) })
}

it('drains a real paused patch transaction before closing its generation', { timeout: 20_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-hmr-transaction-barrier-'))
  const filename = join(dir, 'cordis.patch.yml')
  const config = join(dir, 'cordis.yml')
  writeFileSync(join(dir, 'noop.mjs'), [
    'export const name = "noop"',
    'export async function apply(ctx, config) {',
    '  const controls = ctx.get("hmrTransactionBarrier")',
    '  if (!controls) return',
    '  const phase = controls.phases[config.value]',
    '  if (!phase) return',
    '  controls.applied.push(config.value)',
    '  phase.entered.resolve(undefined)',
    '  await phase.release.promise',
    '  controls.completed.push(config.value)',
    '}',
    '',
  ].join('\n'))
  writeFileSync(config, '- id: noop\n  name: ./noop.mjs\n  config:\n    value: base\n')
  const phases = {
    old: { entered: Promise.withResolvers<undefined>(), release: Promise.withResolvers<undefined>() },
    identity: { entered: Promise.withResolvers<undefined>(), release: Promise.withResolvers<undefined>() },
  }
  const applied: string[] = []
  const completed: string[] = []
  const transactions: string[] = []
  const ctx = await boot('hmr-transaction-barrier', config)
  ctx.provide('hmrTransactionBarrier', { phases, applied, completed })
  await ctx.plugin(Timer)
  await ctx.plugin(Hmr, { root: [], ignored: [], debounce: 0 })
  const include = ctx.loader.resolve('include')
  const originalUpdate = include.update.bind(include)
  const update = vi.spyOn(include, 'update').mockImplementation(async (...args) => {
    await originalUpdate(...args)
    const value = [...ctx.loader.entries()].find(entry => entry.options.id === 'noop')?.fiber?.config as { value: string }
    transactions.push(value.value)
  })
  let dispose: (() => Promise<void>) | undefined
  let disposeNext: (() => Promise<void>) | undefined
  let closing: Promise<void> | undefined
  let restoreClose: (() => void) | undefined
  try {
    dispose = await watchUserPatches(ctx, { binName: 'hmr-transaction-barrier', filename })
    // The watcher close is observed independently from the enclosing refresh drain.
    const registrations = Reflect.get(ctx.hmr, 'configs') as Map<string, { watcher: { close(): Promise<void> } }>
    expect(registrations.size).toBe(1)
    const watcher = [...registrations.values()][0]!.watcher
    const close = watcher.close.bind(watcher)
    const closed = Promise.withResolvers<undefined>()
    const closeSpy = vi.spyOn(watcher, 'close').mockImplementation(async () => {
      await close()
      closed.resolve(undefined)
    })
    restoreClose = () => { closeSpy.mockRestore() }
    writeFileSync(filename, '- id: noop\n  config:\n    value: old\n')
    await bounded(phases.old.entered.promise, 'old plugin apply did not enter')
    const child = [...ctx.loader.entries()].find(entry => entry.options.id === 'noop')!
    expect(child.options.config).toEqual({ value: 'old' })
    expect(completed).toEqual([])
    expect(transactions).toEqual([])

    let disposed = false
    closing = dispose().then(() => { disposed = true })
    await bounded(closed.promise, 'native watcher did not close')
    // Drain Promise continuations after the observed close. The plugin barrier
    // remains held; this checkpoint neither writes a file nor waits for readiness.
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(disposed).toBe(false)
    expect(completed).toEqual([])
    phases.old.release.resolve(undefined)
    await bounded(closing, 'old disposer did not join its transaction')
    expect(disposed).toBe(true)
    expect(transactions).toEqual(['old'])
    expect(completed).toEqual(['old'])

    unlinkSync(filename)
    disposeNext = await watchUserPatches(ctx, { binName: 'hmr-transaction-barrier', filename })
    writeFileSync(filename, '- id: noop\n  config:\n    value: identity\n')
    await bounded(phases.identity.entered.promise, 'new plugin apply did not enter')
    expect(child.options.config).toEqual({ value: 'identity' })
    expect(transactions).toEqual(['old'])
    expect(completed).toEqual(['old'])
    phases.identity.release.resolve(undefined)
    await bounded(disposeNext(), 'new disposer did not join its transaction')
    expect(applied).toEqual(['old', 'identity'])
    expect(completed).toEqual(['old', 'identity'])
    expect(transactions).toEqual(['old', 'identity'])
    expect(child.fiber?.config).toEqual({ value: 'identity' })
  } finally {
    phases.old.release.resolve(undefined)
    phases.identity.release.resolve(undefined)
    try {
      const outcomes = await Promise.allSettled([closing, disposeNext?.(), dispose?.()])
      const failures = outcomes.filter(result => result.status === 'rejected').map(result => result.reason as unknown)
      if (failures.length) throw new AggregateError(failures, 'Patch watcher cleanup failed')
    } finally {
      restoreClose?.()
      update.mockRestore()
      await ctx.fiber.dispose()
      await rm(dir, { recursive: true, force: true })
    }
  }
})
