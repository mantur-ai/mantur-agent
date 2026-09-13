import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { InputTriggerController } from '../src/client/contract/input.ts'
import { importedFileReference } from '../src/client/input/imported-files.ts'
import { SessionInputShell } from '../src/client/input/facade.ts'

describe('imported file references', () => {
  it.each([
    { name: '剧本.md', path: '/attachments/剧本.md', kind: 'file' as const, mention: '@/attachments/剧本.md' },
    { name: '资产+剧本', path: '/Application Support/资产+剧本', kind: 'directory' as const, mention: '@"/Application Support/资产+剧本/"' },
    { name: 'script.doc', path: 'C:\\Users\\Test User\\script.doc', kind: 'file' as const, mention: '@"C:\\Users\\Test User\\script.doc"' },
  ])('keeps $name separate from its model-readable path', ({ mention, ...file }) => {
    expect(importedFileReference(file)).toEqual({ source: 'reference', ref: mention,
      clipboardText: mention, label: file.name, appearance: file.kind === 'directory' ? 'folder' : 'file' })
  })

  it.each(['/a/"script.md', '/a/line\nbreak.md'])('rejects paths outside the file-mention grammar: %j', (path) => {
    expect(importedFileReference({ name: 'script.md', path, kind: 'file' })).toBeUndefined()
  })

  it('sends the copied path, restores its chip on failure, and keeps another draft separate', async () => {
    const sink = vi.fn().mockResolvedValue({ kind: 'error', text: 'Host unavailable' })
    const serializeReference = vi.fn((_source: string, ref: string) => Promise.resolve(ref))
    const deps = { actx: {} as Context, defaultSink: sink,
      inputTriggers: () => ({ serializeReference, track: vi.fn(),
        lexicon: { getSnapshot: () => new Map(), subscribe: () => () => {} },
      } as unknown as InputTriggerController),
      commandImages: { serialize: async () => [], release: () => {}, unsupportedNotice: () => '' } }
    const shell = new SessionInputShell(deps)
    const other = new SessionInputShell(deps)
    try {
      shell.setDraft('Read this')
      const file = importedFileReference({ name: '剧本', path: '/copies/剧本', kind: 'directory' })!
      expect(shell.appendReference(file)).toBe(true)
      shell.submit()
      await vi.waitFor(() => { expect(sink).toHaveBeenCalled() })
      expect(sink.mock.calls[0]?.[0]).toBe('Read this @/copies/剧本/')
      await vi.waitFor(() => { expect(shell.snapshot.occurrences).toHaveLength(1) })
      expect(shell.snapshot.occurrences[0]?.label).toBe('剧本')
      expect(other.snapshot.draft).toBe('')
      expect(other.snapshot.occurrences).toHaveLength(0)
      sink.mockResolvedValue({ kind: 'success' })
      shell.submit()
      await vi.waitFor(() => { expect(sink).toHaveBeenCalledTimes(2) })
      expect(shell.snapshot.occurrences).toHaveLength(0)
    } finally { shell.dispose(); other.dispose() }
  })
})
