/** Registers the target-neutral Conversation assembly, shell, input, and docks. */
import type { Context } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import { createSnapshotStore, type BoundActions, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only service and declaration merges used by this assembly.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { UiConversation } from './conversation/assembly.ts'
import type { ViewTab } from './contract/views.ts'
import type {
  ComposerBarInjected, ComposerControlInjected, ConversationInjected, ConversationSessionHeaderInjected,
  ConversationSessionInjected,
} from './contract/slots.ts'
import { createConversationStore, readConversationViewPreference } from './stores.ts'
import { ConversationController, UnsupportedImageMediaTypeError } from './service.ts'
import type { IConversation } from './service.ts'
import { ComposerBlockRegistry } from './input/blocks.ts'
import type { ComposerBlock } from './contract/composer-blocks.ts'
import { DraftPersistence } from './input/draft-persistence.ts'
import { InputHub } from './input/hub.ts'
import { ConversationDraftController } from './input/draft.ts'
import { ComposerSubmissionPolicy } from './input/submission-policy.ts'
import { queueDockEntry } from './queue/QueueDock.tsx'
import { EnterBehaviorRow } from './settings/EnterBehaviorRow.tsx'
import type { EnterBehaviorRowInjected } from './settings/EnterBehaviorRow.tsx'
import { ConversationRoot } from './skeleton/ConversationRoot.tsx'
import { ConversationSession, ConversationSessionHeader } from './skeleton/ConversationSession.tsx'
import { InputBar } from './skeleton/InputBar.tsx'
import { PermissionControl } from './skeleton/PermissionControl.tsx'
import { todoDockEntry } from './skeleton/TodoPanel.tsx'
import { resolveActiveView } from './view-selection.ts'
import { en, NS, zh, type ConversationKey } from './locales.ts'
import { CONVERSATION_SETTINGS_NAMESPACE, type ConversationSettings } from '../submission-settings.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Conversation shell, composer, queue, and dock copy. */
    conversation: ConversationKey
  }
}

/** Services required by the Conversation plugin. */
export const inject = [
  'slots', 'sessions', 'uiSession', 'uiWorkspace', 'locale', 'settingsScope',
]

// Stable no-session sources keep the renderer's observable-hook cache and
// hook order unchanged across current-Session transitions.
const ABSENT_BLOCK = {
  getSnapshot: (): ComposerBlock | undefined => undefined,
  subscribe: () => () => {},
}
const ABSENT_MENU_LAUNCHER = {
  getSnapshot: (): string | null => null,
  subscribe: () => () => {},
}

interface WorkspaceNavigation {
  connectWorkspace(
    workspaceId: Parameters<ConversationInjected['selectWorkspace']>[0],
  ): Promise<SessionId>
}

/** Resolve the session-scoped Conversation action face, failing loud. */
function scopedConversation(sessions: ISessions, id: SessionId): IConversation {
  const scoped = sessions.scope(id)
  if (scoped === undefined) throw new Error(`ui-conversation: session "${id}" resolved no scope`)
  const conversation = scoped.get('conversation')
  if (conversation === undefined) {
    throw new Error('ui-conversation: conversation service unavailable through the session scope')
  }
  return conversation
}

/** Resolve package-internal attachment operations from the public service. */
function concreteConversation(ctx: Context): ConversationController {
  const conversation = ctx.get('conversation') as ConversationController | undefined
  if (conversation === undefined) throw new Error('ui-conversation: conversation service unavailable')
  return conversation
}

/**
 * Mount the Conversation core and target-neutral presentation.
 * @param ctx - Client root context.
 */
export function apply(ctx: Context): void {
  const sessions = ctx.sessions
  const slots = ctx.slots
  const workspaceNavigation = ctx.get('uiWorkspace') as unknown as WorkspaceNavigation
  const uiConversation = new UiConversation(ctx, sessions)

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-conversation: dictionaries')
  const t = ctx.locale.bind(NS)
  const conversationStore = createConversationStore()
  const submissionPolicy = new ComposerSubmissionPolicy(
    ctx.settingsScope.bind<ConversationSettings>({ namespace: CONVERSATION_SETTINGS_NAMESPACE }),
  )

  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'composer-enter',
    order: 20,
    locale: NS,
    inject: (): EnterBehaviorRowInjected => ({
      hooks: { busyEnter: submissionPolicy.busyEnter },
      setBusyEnter: (behavior) => { submissionPolicy.setBusyEnter(behavior) },
    }),
  }, EnterBehaviorRow))

  const viewTabs = (): ViewTab[] => {
    const tabs: ViewTab[] = []
    for (const entry of slots.entries('conversation.view')) {
      /* v8 ignore next -- list registration validates id at load. */
      if (entry.options.id === undefined) continue
      tabs.push({
        id: entry.options.id,
        label: resolveSlotLabel(entry.options.label) ?? entry.options.id,
      })
    }
    return tabs
  }
  const activateView = (sessionId: SessionId, preferred: string | null): void => {
    const active = resolveActiveView(viewTabs(), preferred)
    if (active !== undefined) uiConversation.binding(sessionId).activate(active.id)
  }
  const restoreView = (sessionId: SessionId): void => {
    activateView(sessionId, readConversationViewPreference(sessionId))
  }
  const restoreCurrentView = (): void => {
    const sessionId = sessions.list.getSnapshot().current
    if (sessionId !== undefined && sessions.binding(sessionId) !== undefined) {
      restoreView(sessionId)
    }
  }
  const conversationViews = createSnapshotStore<readonly ViewTab[]>(viewTabs())
  const refreshViews = (): void => {
    const current = conversationViews.getSnapshot()
    const next = viewTabs()
    const unchanged = current.length === next.length
      && current.every((tab, index) => {
        const candidate = next.at(index)
        return candidate !== undefined && tab.id === candidate.id && tab.label === candidate.label
      })
    if (!unchanged) conversationViews.set(next)
    restoreCurrentView()
  }
  ctx.effect(() => {
    let currentSessionId = sessions.list.getSnapshot().current
    const disposeViews = slots.subscribe('conversation.view', refreshViews)
    const disposeLocale = ctx.locale.subscribe(refreshViews)
    const disposeCurrent = sessions.list.subscribe(() => {
      const nextSessionId = sessions.list.getSnapshot().current
      if (nextSessionId === currentSessionId) return
      currentSessionId = nextSessionId
      restoreCurrentView()
    })
    return () => {
      disposeCurrent()
      disposeLocale()
      disposeViews()
    }
  }, 'ui-conversation: View selection')

  const inputHub = new InputHub(ctx, t)
  const composerBlocks = new ComposerBlockRegistry()
  if (typeof window !== 'undefined' && window.manturDrafts !== undefined) {
    const persistence = new DraftPersistence(window.manturDrafts, {
      capture: ids => concreteConversation(ctx).captureDraftImages(ids),
      restore: images => concreteConversation(ctx).restoreDraftImages(images),
    }, () => t('draft.restartSubmissionFailed'), (error) => {
      const message = t('draft.saveFailed', { detail: String(error) })
      inputHub.reportPersistenceError(message)
      drafts.input.notify('error', message)
    })
    inputHub.persistence = persistence
    ctx.effect(() => () => { persistence.dispose() }, 'ui-conversation: native draft persistence')
  }

  const drafts = new ConversationDraftController(ctx, sessions, inputHub, (ids) => {
    const conversation = ctx.get('conversation') as ConversationController | undefined
    for (const id of ids) conversation?.releaseDraftImage(id)
  }, t)

  // Conversation assembly and input share the Session binding lifecycle. The
  // source roster is installed before any consuming Slot entry.
  ctx.uiSession.provide({
    hooks: ['conversation', 'input'],
    props: ['inputActions'],
    resolve: (binding) => {
      const shell = inputHub.shellFor(binding)
      const conversation = uiConversation.binding(binding)
      restoreView(binding.sessionId)
      return {
        hooks: {
          conversation: conversation.snapshot,
          input: shell.state,
        },
        props: { inputActions: shell.actions },
      }
    },
  })

  const registerConversationRoot = () => slots.register({
    name: 'conversation',
    locale: NS,
    children: {
      'conversation.session': { kind: 'single', scope: 'session' },
      'conversation.session.header': { kind: 'single', scope: 'session' },
      'conversation.composer': { kind: 'chain', scope: 'session' },
      'conversation.composer.bar': { kind: 'single', scope: 'session-maybe' },
      'conversation.input.dock': { kind: 'list', scope: 'session' },
      'conversation.hero.brand.mark': { kind: 'single', scope: 'root' },
      'conversation.hero.headline': { kind: 'single', scope: 'root' },
      'conversation.hero.badge': { kind: 'single', scope: 'root' },
      'conversation.hero.modes': { kind: 'single', scope: 'root' },
      'conversation.composer.guide': { kind: 'single', scope: 'session-maybe' },
      'conversation.composer.layout': { kind: 'single', scope: 'session-maybe' },
      'conversation.hero.workspace': { kind: 'single', scope: 'root' },
      'conversation.hero.agentPreset': { kind: 'single', scope: 'root' },
    },
    inject: (sessionId: SessionId | undefined): ConversationInjected => ({
      hooks: {
        composerBlock: sessionId === undefined ? ABSENT_BLOCK : composerBlocks.storeFor(sessionId),
        draftEnabled: drafts.enabled,
      },
      selectWorkspace: async (workspaceId) => {
        const nextId = await workspaceNavigation.connectWorkspace(workspaceId)
        const from = sessionId === undefined ? drafts.input : inputHub.shell(sessionId)
        try {
          if (nextId !== sessionId && (from.snapshot.draft !== '' || from.snapshot.imageIds.length > 0)) {
            if (sessionId === undefined) await drafts.moveTo(nextId)
            else {
              await inputHub.waitForDraft(nextId)
              from.moveDraftTo(inputHub.shell(nextId))
            }
          }
        } catch (error) {
          from.notify('error', error instanceof Error ? error.message : String(error))
          throw error
        }
        sessions.open(nextId)
      },
    }),
  }, ConversationRoot)

  const registerConversationSession = () => slots.register({
    name: 'conversation.session',
    children: {
      'conversation.view': { kind: 'list', scope: 'session' },
    },
    store: conversationStore,
    inject: (sessionId: SessionId, actions: BoundActions<typeof conversationStore>): ConversationSessionInjected => ({
      hooks: { conversationViews },
      bindDraftMirror: (write, seed) => inputHub.shell(sessionId).bindMirror(write, seed),
      openView: (view, focus) => {
        activateView(sessionId, view)
        actions.openView(view, focus)
      },
    }),
  }, ConversationSession)

  const registerConversationHeader = () => slots.register({
    name: 'conversation.session.header',
    locale: NS,
    children: {
      'conversation.session.header.lineage': { kind: 'single', scope: 'session' },
      'conversation.session.header.actions': { kind: 'list', scope: 'session' },
      'conversation.session.header.utilities': { kind: 'list', scope: 'session' },
    },
    store: conversationStore,
    inject: (sessionId: SessionId, actions: BoundActions<typeof conversationStore>): ConversationSessionHeaderInjected => ({
      hooks: { conversationViews },
      open: (id) => { sessions.open(id) },
      selectView: (view) => {
        activateView(sessionId, view)
        actions.setView(view)
      },
    }),
  }, ConversationSessionHeader)

  const externalPermissions: ObservableSnapshot<boolean> = {
    getSnapshot: () => slots.entries('conversation.composer.bar.accessory.permissions').length > 0,
    subscribe: listener => slots.subscribe('conversation.composer.bar.accessory.permissions', listener),
  }
  const composerControls = (sessionId: SessionId | undefined): ComposerControlInjected => {
    const shell = sessionId === undefined ? drafts.input : inputHub.shell(sessionId)
    return {
      keyboard: shell,
      unassignedActions: sessionId === undefined ? shell.actions : undefined,
      command: sessionId === undefined ? undefined : async (line) => {
        const session = sessions.binding(sessionId)?.session
        if (session === undefined) return false
        const result = await session.command(line)
        return result.ok && result.value.matched
      },
      hooks: { composerInput: shell.state },
    }
  }
  slots.inject('conversation.composer.bar.accessory.permissions', () => slots.register({
    name: 'conversation.composer.bar.accessory.permissions', locale: NS, inject: composerControls,
  }, PermissionControl))

  const registerComposerBar = () => slots.register({
    name: 'conversation.composer.bar',
    locale: NS,
    children: {
      'conversation.composer.bar.accessory': { kind: 'single', scope: 'session-maybe' },
      'conversation.input.attachments': { kind: 'single', scope: 'session-maybe' },
      'conversation.input.overlay': { kind: 'list', scope: 'session' },
      'conversation.input.left': { kind: 'list', scope: 'session' },
      'conversation.input.plan': { kind: 'single', scope: 'session' },
      'conversation.input.right': { kind: 'list', scope: 'session' },
      'conversation.input.model': { kind: 'single', scope: 'session' },
      'conversation.composer.dock': { kind: 'list', scope: 'session' },
    },
    inject: (sessionId: SessionId | undefined): ComposerBarInjected => {
      const conversation = concreteConversation(ctx)
      const shell = sessionId === undefined ? drafts.input : inputHub.shell(sessionId)
      const inputTriggers = sessionId === undefined ? undefined : inputHub.inputTriggers(sessionId)
      const controls = composerControls(sessionId)
      return {
        ...controls,
        addImages: (files) => {
          try {
            const images = conversation.createDraftImages(files)
            if (!shell.addImages(images.map(image => image.id))) {
              conversation.releaseDraftImages(images)
            }
            return null
          } catch (error: unknown) {
            if (error instanceof UnsupportedImageMediaTypeError) return t('image.unsupportedType')
            return error instanceof Error ? error.message : String(error)
          }
        },
        removeImage: (id) => {
          conversation.releaseDraftImage(id)
          shell.removeImage(id)
        },
        draftImages: ids => conversation.draftImages(ids),
        resolveSubmitMode: (running, gesture, steeringAvailable) =>
          submissionPolicy.resolve(running, gesture, steeringAvailable),
        toggleCommandMenu: inputTriggers === undefined
          ? undefined
          : (selection) => {
            shell.dismissPopup()
            const snapshot = shell.snapshot
            inputTriggers.toggleSource('command', {
              trigger: '/',
              query: '',
              quoted: false,
              position: snapshot.draft.slice(0, selection.start).trim() === '' ? 'leading' : 'inline',
              span: { ...selection, draftRev: snapshot.draftRev },
            })
          },
        stop: sessionId === undefined ? undefined : () => {
          scopedConversation(sessions, sessionId).cancel().catch(() => {
            // Stop failure is published through Session promptError.
          })
        },
        hooks: {
          ...controls.hooks,
          externalPermissions,
          notices: shell.notices,
          lexicon: shell.lexicon,
          menuLauncher: inputTriggers?.launcher ?? ABSENT_MENU_LAUNCHER,
        },
      }
    },
  }, InputBar)

  slots.inject('conversation', function* () {
    yield registerConversationRoot()
    yield registerConversationSession()
    yield registerConversationHeader()
    yield registerComposerBar()
  })

  ctx.plugin(ConversationController, { input: inputHub, blocks: composerBlocks,
    ...(inputHub.persistence === undefined ? {} : { persistence: inputHub.persistence }),
  })
  ctx.plugin(todoDockEntry)
  ctx.plugin(queueDockEntry)
}
