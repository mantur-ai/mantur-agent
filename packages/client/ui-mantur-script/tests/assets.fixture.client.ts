/** Test-only bridge to the isolated asset protocol; never mounted by a shipped profile. */
import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'

interface State {
  rows: {
    id: string
    kind: string
    version: number
    media: unknown
    generation: unknown
    source: { documentId: string; table: string; revision: string }
  }[]
  drafts: Record<string, { prompt: string }>
  requests: { id: string; sessionId: string; projectId: string; targets: { id: string; attempt: number; status: string }[] }[]
}
interface Envelope {
  requestId: string
  sessionId: string
  projectId: string
  targets: { id: string; attempt: number }[]
}
interface Protocol {
  prepareHandoff(
    state: State, input: { sessionId: string; requestId: string; ids: string[]; requirement: string }, sources: Record<string, string>
  ): Envelope
  receiveHandoff(state: State, event: object): void
  confirmHandoff(state: State, address: object, sources: Record<string, string>): void
}
interface Model {
  createState(fixture: unknown): State
  saveDraft(state: State, id: string, fields: { prompt: string; negativePrompt: string }, version: number): void
}
interface Sender {
  sendHandoffToSession(sessions: Context['sessions'], envelope: Envelope): Promise<object[]>
}

/** @returns Explicit synthetic data and the existing proposal protocol, with no file writes or model calls. */
export async function createAssetFixture() {
  const currentModule = import.meta.url
  const base = new URL('../../../../prototypes/drama-asset-workbench/', currentModule)
  // The independent JavaScript prototype has no TypeScript face; this test declares only the operations it invokes.
  const model = await import(new URL('model.mjs', base).href) as Model
  const protocol = await import(new URL('handoff.mjs', base).href) as Protocol
  const sender = await import(new URL('session-sender.mjs', base).href) as Sender
  const state = model.createState(JSON.parse(await readFile(new URL('fixture.json', base), 'utf8')))
  const sources: Record<string, string> = {}
  for (const row of state.rows) {
    const documentId = row.kind === 'image' ? 'asset-report' : 'clip-report'
    const revision = (row.kind === 'image' ? 'a' : 'b').repeat(64)
    row.source = { documentId, table: row.kind === 'image' ? 'images' : 'clips', revision }
    sources[documentId] = revision
  }
  const clip = 'CLIP-EP01-001', character = 'CHAR-001-V01'
  let sequence = 0
  let packet: Envelope
  return {
    state, clip, character,
    async submit(sessions: Context['sessions'], ids: string[]) {
      const sessionId = sessions.list.getSnapshot().current
      if (sessionId === undefined) throw new Error('SESSION_UNAVAILABLE')
      packet = protocol.prepareHandoff(state, { sessionId, requestId: `asset-${++sequence}`, ids, requirement: '保持身份，调整光线' }, sources)
      const events = await sender.sendHandoffToSession(sessions, packet)
      events.forEach((event) => { protocol.receiveHandoff(state, event) })
    },
    edit(text: string) { model.saveDraft(state, clip, { prompt: text, negativePrompt: '' }, 1) },
    changeSource() { sources['asset-report'] = 'c'.repeat(64) },
    proposeAndConfirm() {
      protocol.receiveHandoff(state, { ...packet, type: 'proposals', results: packet.targets.map(target => ({
        ...target, fields: { prompt: '受控提案', negativePrompt: '' },
      })) })
      protocol.confirmHandoff(state, { ...packet, ids: packet.targets.map(target => target.id) }, sources)
    },
  }
}
