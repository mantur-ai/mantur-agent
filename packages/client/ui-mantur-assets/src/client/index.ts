/* oxlint-disable @stylistic/max-len -- Remote command wiring remains adjacent to the slot registration. */
/** Browser registration is reserved for the shared workbench contribution. */
import type { Context } from '@deepseek-ai/cordis'
import { createElement } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-mantur-script/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import remote from '@deepseek-ai/dsh-client-ui-mantur-assets/remote'
import { AssetsPanel } from './AssetsPanel.tsx'
import { en, zh, type AssetKey } from './locales.ts'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
export const inject = ['slots', 'remote']
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'assets.mantur': AssetKey }
}
/** The Host provider is usable independently in headless verification; the shell contribution is added after its slot contract lands. */
export async function apply(ctx: Context): Promise<void> {
  const mounted = await ctx.remote.$mount(remote); ctx.effect(() => mounted, 'assets: remote')
  await ctx.inject(['remote.manturAssets'], (child) => {
    child.effect(() => child.locale.register('assets.mantur', { en, zh }), 'assets: dictionaries')
    child.slots.inject('main.workbench.assets.tab', () => child.slots.register({ name: 'main.workbench.assets.tab' }, AssetTab))
    child.slots.inject('main.workbench.assets.content', () => child.slots.register({ name: 'main.workbench.assets.content' }, owner => createElement(AssetsPanel, { ...owner, ...commands(child) })))
  }).await()
}
function AssetTab(props: PropsRuntime<'main.workbench.assets.tab'> & PropsLocale<'assets.mantur'>) {
  return createElement('button', { type: 'button', 'aria-pressed': props.selected, onClick: props.selectAssets }, props.t('assets'))
}
function commands(ctx: Context) {
  const call = <T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T => { if (!result.ok) throw new Error(result.error.message); return result.value }
  return {
    load: async (session: string, path: string) => call(await ctx.remote.manturAssets.load(session as never, path)),
    save: async (session: string, snapshot: AssetSnapshot, edits: PromptEdit[]) => call(await ctx.remote.manturAssets.saveDraft(session as never, { source: snapshot.source, stateVersion: snapshot.stateVersion, edits } as AssetCommand)),
    request: async (session: string, snapshot: AssetSnapshot, edits: PromptEdit[], instruction: string) => { const prepared = call(await ctx.remote.manturAssets.prepare(session as never, snapshot.source, edits, instruction)); const conversation = ctx.sessions.binding(session as never)?.ctx.get('conversation'); if (!conversation) throw new Error('The owning conversation is unavailable.'); await conversation.send(JSON.stringify({ task: 'Use propose_asset_prompts for this selected pipeline report. Do not generate media.', requestId: prepared.requestId, source: prepared.source, edits: prepared.edits })); return prepared.requestId },
    apply: async (session: string, requestId: string) => call(await ctx.remote.manturAssets.apply(session as never, requestId)),
  }
}
