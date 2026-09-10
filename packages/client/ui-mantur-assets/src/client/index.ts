/* oxlint-disable @stylistic/max-len -- Remote command wiring remains adjacent to the slot registration. */
/** Register the production asset contribution once the shared workbench declares its slots. */
import type { Context } from '@deepseek-ai/cordis'
import { createElement } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-mantur-script/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import remote from '@deepseek-ai/dsh-client-ui-mantur-assets/remote'
import { AssetsPanel } from './AssetsPanel.tsx'
import { en, zh, type AssetKey } from './locales.ts'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { AssetCandidate, AssetMedia, AssetSnapshot, PromptEdit } from '../types.ts'
export const inject = ['slots', 'remote', 'locale', 'sessions']
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'assets.mantur': AssetKey }
}
/** @param ctx - Locale, Session, slots, and generated Remote services for the asset workbench. */
export async function apply(ctx: Context): Promise<void> {
  const mounted = await ctx.remote.$mount(remote); ctx.effect(() => mounted, 'assets: remote')
  await ctx.inject(['remote.manturAssets'], (child) => {
    child.effect(() => child.locale.register('assets.mantur', { en, zh }), 'assets: dictionaries')
    child.slots.inject('main.workbench.assets.tab', () => child.slots.register({ name: 'main.workbench.assets.tab', locale: 'assets.mantur' }, AssetTab))
    child.slots.inject('main.workbench.assets.content', () => child.slots.register({ name: 'main.workbench.assets.content', locale: 'assets.mantur', inject: () => commands(child) }, AssetsPanel))
  }).await()
}
function AssetTab(props: PropsRuntime<'main.workbench.assets.tab'> & PropsLocale<'assets.mantur'>) {
  return createElement('button', { type: 'button', 'aria-pressed': props.selected, onClick: props.selectAssets }, props.t('assets'))
}
function commands(ctx: Context) {
  const call = <T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T => { if (!result.ok) throw new Error(result.error.message); return result.value }
  return {
    load: async (session: SessionId, path: string) => call(await ctx.remote.manturAssets.load(session, path)),
    save: async (session: SessionId, snapshot: AssetSnapshot, edits: PromptEdit[]) => call(await ctx.remote.manturAssets.saveDraft(session, { source: snapshot.source, stateVersion: snapshot.stateVersion, edits })),
    request: async (session: SessionId, snapshot: AssetSnapshot, edits: PromptEdit[], instruction: string) => { const prepared = call(await ctx.remote.manturAssets.prepare(session, snapshot.source, edits, instruction)); const conversation = ctx.sessions.binding(session)?.ctx.get('conversation'); if (!conversation) throw new Error('The owning conversation is unavailable.'); await conversation.send(JSON.stringify({ task: 'Use propose_asset_prompts for this selected pipeline report. Do not generate media.', requestId: prepared.requestId, source: prepared.source, edits: prepared.edits })); return prepared.requestId },
    apply: async (session: SessionId, requestId: string) => call(await ctx.remote.manturAssets.apply(session, requestId)),
    candidates: async (session: SessionId, directory: string): Promise<AssetCandidate[]> => call(await ctx.remote.manturAssets.candidates(session, directory)),
    preview: async (session: SessionId, path: string): Promise<AssetMedia> => call(await ctx.remote.manturAssets.preview(session, path)),
  }
}
