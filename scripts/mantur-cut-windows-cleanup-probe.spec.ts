/** Check fresh-tree ownership and real deletion operations used by the native cleanup diagnostic. */
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
// @ts-expect-error The native diagnostic is plain JavaScript without a declaration artifact.
import { runCleanupCase } from './mantur-cut-windows-cleanup-probe.mjs'

it('observes each actual deletion and refuses existing case directories', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mantur-cleanup-probe-'))
  try {
    const comparisons = [
      { alphabet: 'ascii', method: 'rmSync' },
      { alphabet: 'chinese', method: 'rmSync' },
      { alphabet: 'chinese', method: 'rmAsync' },
      { alphabet: 'chinese', method: 'unlinkRmdirSync' },
    ]
    for (const comparison of comparisons) {
      const events: Array<{ event: string; profile?: string; removed?: boolean }> = []
      await runCleanupCase(join(root, `${comparison.alphabet}-${comparison.method}`), comparison,
        (event: { event: string; profile?: string; removed?: boolean }) => { events.push(event) })
      expect(events.map(event => event.event)).toEqual(['created', 'remove-call', 'remove-return'])
      expect(events[2]?.removed).toBe(true)
      expect(existsSync(events[0]!.profile!)).toBe(false)
      expect(events[0]!.profile).toContain(comparison.alphabet === 'chinese' ? '剪辑' : 'editing')
    }
    const existing = join(root, 'existing')
    await mkdir(existing)
    await writeFile(join(existing, 'sentinel'), 'preserve')
    await expect(runCleanupCase(existing, comparisons[0]!, () => {})).rejects.toMatchObject({ code: 'EEXIST' })
    expect(await readFile(join(existing, 'sentinel'), 'utf8')).toBe('preserve')
    await expect(runCleanupCase(join(root, 'invalid'), { alphabet: 'chinese', method: 'unknown' }, () => {}))
      .rejects.toThrow('Unknown comparison')
    expect(existsSync(join(root, 'invalid'))).toBe(false)
  } finally { await rm(root, { recursive: true, force: true }) }
})
