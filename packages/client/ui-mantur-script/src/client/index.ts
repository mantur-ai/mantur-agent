/** Common workbench shell and the Session's script document editor. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ScriptDocument, ScriptEntry, ScriptSelection } from '../types.ts'
import scriptRemote from '@deepseek-ai/dsh-client-ui-mantur-script/remote'
import { createWorkbenchStore } from './store.ts'
import { Workbench, WorkbenchToggle } from './Workbench.tsx'
import { en, zh, type ScriptKey } from './locales.ts'

/** File commands capture the initiating Session rather than resolving the current selection later. */
export interface ScriptCommands {
  /** @param session - Owning conversation. @param directory - Selected project folder. @returns Script entries. */
  list: (session: SessionId, directory: string) => Promise<ScriptEntry[]>
  /** @param session - Owning conversation. @param path - File. @returns Observed document. */
  read: (session: SessionId, path: string) => Promise<ScriptDocument>
  /** @param session - Owning conversation. @param document - Last observation. @param text - Draft. @returns Written document. */
  save: (session: SessionId, document: ScriptDocument, text: string) => Promise<ScriptDocument>
  /** @param session - Captured conversation. @param selection - Versioned exact passage. @param instruction - User rewrite request. */
  send: (session: SessionId, selection: ScriptSelection, instruction: string) => Promise<void>
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'script.mantur': ScriptKey }
  interface SlotMap {
    /** Optional asset tab; its plugin owns its label and availability. */
    'main.workbench.assets.tab': { kind: 'single'; scope: 'root'; owner: { selected: boolean; selectAssets: () => void } }
    /** Asset drafts remain mounted across same-Session content switches. */
    'main.workbench.assets.content': { kind: 'single'; scope: 'root'; owner: { closeWorkbench: () => void } }
    /** Optional editing tab; its plugin owns its label and availability. */
    'main.workbench.editing.tab': { kind: 'single'; scope: 'root'; owner: { selected: boolean; selectEditing: () => void } }
    /** Editing stays mounted after first activation within this Session. */
    'main.workbench.editing.content': { kind: 'single'; scope: 'root'; owner: { closeWorkbench: () => void } }
    /** Resident live-opening observer with explicit editing selection. */
    'main.workbench.toggle.editing': {
      kind: 'single'
      scope: 'root'
      owner: { expanded: boolean; openWorkbench: () => void; closeWorkbench: () => void }
    }
  }
}
/** Required browser services; no account or model-provider dependency. */
export const inject = ['slots', 'locale', 'layout', 'remote', 'sessions', 'uiConversation']

/** @param ctx - Client services used by the shared workbench. */
export async function apply(ctx: Context): Promise<void> {
  const dispose = await ctx.remote.$mount(scriptRemote)
  ctx.effect(() => dispose, 'script: client remote')
  await ctx.inject(['remote.manturScript'], (ctx) => {
    const store = createWorkbenchStore()
    ctx.effect(() => ctx.locale.register('script.mantur', { en, zh }), 'script: dictionaries')
    ctx.slots.inject('main.workbench', () => ctx.slots.register({
      name: 'main.workbench', locale: 'script.mantur', store,
      children: {
        'main.workbench.assets.tab': { kind: 'single', scope: 'root' },
        'main.workbench.assets.content': { kind: 'single', scope: 'root' },
        'main.workbench.editing.tab': { kind: 'single', scope: 'root' },
        'main.workbench.editing.content': { kind: 'single', scope: 'root' },
      },
      inject: (): ScriptCommands => ({
        list: async (session, path) => unwrap(await ctx.remote.manturScript.list(session, path)),
        read: async (session, path) => unwrap(await ctx.remote.manturScript.read(session, path)),
        save: async (session, document, text) => unwrap(await ctx.remote.manturScript.save(session, {
          path: document.path, version: document.version, content: text,
        })),
        send: async (session, selection, instruction) => {
          if (ctx.sessions.list.getSnapshot().current !== session) throw new Error('The selected conversation changed. Send from the original conversation.')
          const binding = ctx.sessions.binding(session)
          const conversation = binding?.ctx.get('conversation')
          if (conversation === undefined) throw new Error('The owning conversation is unavailable.')
          await conversation.send(JSON.stringify({
            task: 'Rewrite only this selected script passage using replace_script_selection. Stop if the file version is stale. Preserve every other passage.',
            ...selection, instruction,
          }))
        },
      }),
    }, Workbench))
    ctx.slots.inject('main.workbench.toggle', () => ctx.slots.register({
      name: 'main.workbench.toggle', locale: 'script.mantur', store,
      children: { 'main.workbench.toggle.editing': { kind: 'single', scope: 'root' } },
    }, WorkbenchToggle))
    ctx.effect(() => () => { ctx.layout.closeWorkbench() }, 'script: close owned shell on unload')
  }).await()
}

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}
