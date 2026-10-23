/** Local catalog ownership: no online substitute, overlapping load or late publication. */
import { expect, it, vi } from 'vitest'
import type { ManturBundledSkillsUpdateResult } from '@deepseek-ai/dsh-manturhub-marketplace/types'
import { BundledSkills } from '../src/client/bundled-skills.ts'

it('shares a pending discovery and publishes the local result', async () => {
  const pending = Promise.withResolvers<ManturBundledSkillsUpdateResult>()
  const read = vi.fn(() => pending.promise)
  const subject = new BundledSkills(read)
  try {
    const first = subject.load()
    await subject.load()
    expect(read).toHaveBeenCalledOnce()
    expect(subject.store.getSnapshot()).toEqual({ phase: 'loading', skills: [], updates: [] })
    pending.resolve({ skills: [], updates: [] })
    await first
    expect(subject.store.getSnapshot()).toEqual({ phase: 'ready', skills: [], updates: [] })
  } finally { subject.dispose() }
})

it('exposes failure and retries only on an explicit load', async () => {
  const read = vi.fn<() => Promise<ManturBundledSkillsUpdateResult>>().mockRejectedValueOnce(new Error('Missing manifest')).mockResolvedValueOnce({ skills: [], updates: [] })
  const subject = new BundledSkills(read)
  try {
    await subject.load()
    expect(subject.store.getSnapshot()).toEqual({ phase: 'failed', skills: [], updates: [] })
    expect(read).toHaveBeenCalledOnce()
    await subject.load()
    expect(subject.store.getSnapshot()).toEqual({ phase: 'ready', skills: [], updates: [] })
  } finally { subject.dispose() }
})

it.each([true, false])('cancels on teardown without publishing a late success=%s', async (success) => {
  const pending = Promise.withResolvers<ManturBundledSkillsUpdateResult>()
  const read = vi.fn((_signal: AbortSignal) => pending.promise)
  const subject = new BundledSkills(read)
  const load = subject.load()
  subject.dispose()
  expect(read.mock.calls[0]![0].aborted).toBe(true)
  if (success) pending.resolve({ skills: [], updates: [] })
  else pending.reject(new Error('Aborted'))
  await load
  expect(subject.store.getSnapshot()).toEqual({ phase: 'loading', skills: [], updates: [] })
  await subject.load()
  expect(read).toHaveBeenCalledOnce()
})

it('retains available identities and per-skill failures during a retry and transport failure', async () => {
  const available: ManturBundledSkillsUpdateResult = {
    skills: [{ name: 'short-drama', title: 'Short drama', version: '1.0.0', digest: 'a'.repeat(64),
      reference: `short-drama@1.0.0#${'a'.repeat(64)}`, source: 'app-bundled' }],
    updates: [{ name: 'short-drama', status: 'failed', stage: 'metadata', error: 'HTTP 404' }],
  }
  const pending = Promise.withResolvers<ManturBundledSkillsUpdateResult>()
  const read = vi.fn<() => Promise<ManturBundledSkillsUpdateResult>>()
    .mockResolvedValueOnce(available).mockReturnValueOnce(pending.promise)
  const subject = new BundledSkills(read)
  try {
    await subject.load()
    expect(subject.store.getSnapshot()).toEqual({ ...available, phase: 'ready' })
    const retry = subject.load()
    expect(subject.store.getSnapshot()).toEqual({ ...available, phase: 'loading' })
    pending.reject(new Error('Disconnected'))
    await retry
    expect(subject.store.getSnapshot()).toEqual({ ...available, phase: 'failed' })
  } finally { subject.dispose() }
})
