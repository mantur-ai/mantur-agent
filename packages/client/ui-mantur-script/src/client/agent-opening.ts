/** Successful live opening calls drive visibility without replaying historical UI actions. */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { ConversationNodeDefinition, ConversationViewDefinition, ConversationViewNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-tools/types'
import { z } from 'zod'
import { webWorkbenchUrl } from '../web-url.ts'
const WEB_META_KIND = 'mantur-web-open'

const target = 'mantur-web-open'
const metadata = z.object({
  kind: z.literal(WEB_META_KIND), sessionId: z.string().min(1),
  url: z.string(), status: z.literal('requested'),
})

/** Exact Session and durable result sequence of a completed opening call. */
export interface WebOpening {
  readonly sessionId: SessionId
  readonly seq: SessionSeq
  readonly url: string
}

interface OpeningState { readonly opening?: WebOpening }
interface OpeningNode extends ConversationViewNode { readonly data: OpeningState }

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationViewSnapshotMap {
    /** Latest successful opening whose pending call was observed before completion. */
    'mantur-web-open': WebOpening | undefined
  }
}

const definition: ConversationNodeDefinition<OpeningState> = {
  kind: target, target,
  match(event) {
    if (event.type === 'tool/call' && event.data.name === 'open_web_page') {
      return { id: event.data.callId, role: 'start' }
    }
    if (event.type === 'tool/code-dispatch-start' && event.data.name === 'open_web_page') {
      return { id: event.data.subCallId, role: 'start' }
    }
    if (event.type === 'tool/code-dispatch' && event.data.name === 'open_web_page' && !event.data.isError) {
      return { id: event.data.subCallId, role: 'update' }
    }
    if (event.type === 'tool/result' && event.data.message.content[0].isError !== true
      && event.data.error === undefined && event.data.meta !== null && typeof event.data.meta === 'object'
      && 'kind' in event.data.meta && event.data.meta.kind === WEB_META_KIND) {
      return { id: event.data.message.source.callId, role: 'update' }
    }
    return null
  },
  start: () => ({}),
  update(context, match) {
    if (match.event.type === 'tool/code-dispatch') {
      const content = match.event.data.content
      if (content.length !== 1 || content[0]?.type !== 'text') throw new Error('Web opening requires one JSON result block')
      const parsed = metadata.omit({ kind: true }).parse(JSON.parse(content[0].text) as unknown)
      return { opening: { sessionId: parsed.sessionId as SessionId, seq: match.event.seq, url: webWorkbenchUrl(parsed.url) } }
    }
    /* v8 ignore next -- match() admits updates only for tool/result and tool/code-dispatch. */
    if (match.event.type !== 'tool/result') return context.state
    const parsed = metadata.parse(match.event.data.meta)
    return { opening: { sessionId: parsed.sessionId as SessionId, seq: match.event.seq, url: webWorkbenchUrl(parsed.url) } }
  },
  buildViewNode(context) {
    return context.state === undefined ? null
      : { key: context.key, kind: target, id: context.id, target, data: context.state }
  },
}

const view: ConversationViewDefinition<OpeningNode, WebOpening | undefined> = {
  target,
  isActive: () => false,
  create() {
    const pending = new Set<string>()
    let latest: WebOpening | undefined
    return {
      empty: undefined,
      replace({ nodes }) {
        pending.clear()
        latest = undefined
        for (const node of nodes) if (node.data.opening === undefined) pending.add(node.id)
        return latest
      },
      apply({ upserts }) {
        for (const node of upserts) {
          if (node.data.opening === undefined) pending.add(node.id)
          else if (pending.delete(node.id)) latest = node.data.opening
        }
        return latest
      },
    }
  },
}

/** Register live requests without reopening historical results.
 * @param ctx - Conversation and session services.
 * @returns An observer receiving openings only for the selected session.
 */
export function installAgentOpening(ctx: Context): (open: (opening: WebOpening) => void) => () => void {
  ctx.uiConversation.events.register(definition)
  ctx.uiConversation.views.register(view)
  return (open) => {
    const dispose = ctx.effect(() => {
      let current: SessionId | undefined
      let unsubscribe = () => {}
      const select = () => {
        const selected = ctx.sessions.list.getSnapshot().current
        if (selected === current) return
        unsubscribe()
        current = selected
        if (selected === undefined) { unsubscribe = () => {}; return }
        const source = ctx.uiConversation.binding(selected).target(target)
        let observed = source.getSnapshot()?.seq
        unsubscribe = source.subscribe(() => {
          if (ctx.sessions.list.getSnapshot().current !== selected) return
          const opening = source.getSnapshot()
          if (opening === undefined || opening.seq === observed) return
          observed = opening.seq
          if (opening.sessionId === selected) open(opening)
        })
      }
      const off = ctx.sessions.list.subscribe(select)
      select()
      return () => { off(); unsubscribe() }
    }, 'web: live opening visibility')
    return () => { void dispose() }
  }
}
