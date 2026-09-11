---
description: "Target-neutral conversation assembly and browser shell: event and view registries, per-session bindings, input state, slots, and temporary composer takeovers."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-conversation

English | [中文](README.zh.md)

## Summary

`ui-conversation` owns target-neutral Conversation assembly and the shared browser shell. It consumes Session Controller `SessionEventLikeEntry` feeds, exposes React-free registries and per-Session bindings through `ctx.uiConversation`, and contributes the `useConversation`, `useInput`, and `inputActions` standard props through `ctx.uiSession`. It also owns the per-session durable image URL cache: `ctx.uiConversation.imageUrl(sessionId, attachment)` resolves one session-authorized browser URL per attachment and revokes it with the Session binding, so every Conversation target shares one `session.attachment` read. Concrete targets such as Chat are separate packages that register their own Definitions, snapshot builders, Views, and renderers.

Saved paths are appended to the originating draft and travel through ordinary user-message logging. Import completion cannot append to another Session after navigation. Document interpretation uses the Agent’s file tools; import does not claim to extract Word text. Images retain their preview and image submission path. Browser-only deployments retain image intake. The [native import decision](../../../.agents/notes/implemented/feature/2026-09-11-desktop-file-import.md) records the storage and testing scope.

## Table of Contents

- [Conversation assembly](#conversation-assembly)
- [Shell and standard props](#shell-and-standard-props)
- [Temporary composer entries](#temporary-composer-entries)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="conversation-assembly"></a>
## Conversation assembly

`UiConversation.events` is the single registry for event Definitions, and `UiConversation.views` is the single registry for target snapshot builders. Both registries reject duplicate keys, preserve registration order, return idempotent disposers, and rebuild existing bindings when their contribution roster changes. `UiConversation.binding(bindingOrSessionId)` returns one identity-stable Conversation binding for the current Session Controller binding. It does not open another event source.

The adapter passes each `SessionEventLikeEntry` directly to the assembler. Its outer `type` distinguishes scalar and packed records, while its inner `event` always exposes `type`, `seq`, `time`, and `data`; Definitions receive that inner `SessionEventLike`. Historical replace and prepend accept both entry variants, while live append accepts only `SessionLiveEventEntry`. Every Definition uses the same `match` and `update` methods for both event forms, while `start` receives only a standard event and the assembler rejects a packed start. Definitions that do not consume Assistant deltas return `null` for the packed tags. Replacement windows and revision gaps rebuild from the complete loaded window; contiguous append and prepend revisions use incremental assembly without expanding packed members. The assembler owns Context matching, Turn/Step locations, target node materialization, target activity, and stable target sources. `ConversationSnapshot` contains only target-neutral views and active-target facts; Session lifecycle state remains in `SessionSnapshot`.

A target becomes active when shell selection resolves it or when its source receives a first subscriber. The assembler replaces that target from current Contexts once and keeps it active for later incremental flushes; creating a source does not activate it and unsubscription does not deactivate it.

Target packages declaration-merge their snapshot and Location data maps, then register with `ctx.uiConversation.events.register(...)` and `ctx.uiConversation.views.register(...)`. A target reads its Session-owned source with `ctx.uiConversation.binding(binding).target(targetId)`. Registrations are Cordis effects and their returned disposers remove the contribution from the same registry.

<a id="shell-and-standard-props"></a>
## Shell and standard props

The package registers the optional-Session `conversation` shell, strict Session header/body entries, View list, composer chain and bar, input regions, Hero regions, queue dock, draft persistence, and phase calculation. The blank-session hero exposes independent single slots for its brand mark, headline, optional badge, Workspace picker, and Agent Preset control; the shell keeps its existing fish, localized headline, and Preview badge as fallbacks when no deployment occupies those presentation seats. `ctx.uiSession.provide()` materializes the Conversation and input sources from the same Session binding and supplies `inputActions` as a stable standard prop.

View selection is deterministic: a registered persisted selection wins, otherwise registered `chat` wins, otherwise no View renders. It never chooses the first registered View. Shell phase combines Session lifecycle with the active-target set; no target-specific snapshot is read by the shell.

Product plugins can occupy `conversation.hero.modes` below the blank-conversation headline and `conversation.composer.guide` above the resident composer. Neither slot owns the editor. The Session input facade's `appendReference` appends at the document end, deduplicates by source and reference identity, and focuses the editor without submitting; adjudicating or submitting input refuses the operation.

`conversation.composer.layout` receives owner-created heading, workspace, and content nodes. Its default order places the workspace before the editor; a product occupant can reorder these nodes without replacing their controls or state. The content node must retain its React position across hero and active phases to preserve the resident editor.

A product can occupy `conversation.composer.bar.accessory` above the editor inside the input card and declare its `conversation.composer.bar.accessory.permissions` child with a boolean `disabled` owner prop. Conversation contributes the existing permission selector for that declaration's lifetime, using the same input state, permission projection, command callback, and interaction locks as the toolbar control. Slot occupancy keeps exactly one selector; removing or recreating the accessory preserves the Session permission value. The composer supplies the display lock, including its block; model-selection lock rules are unchanged.

The shell reads the persisted View preference before rendering when a Session first binds or a cached Session becomes current, activates the registered preferred View or Chat fallback, and activates later tab or focus selections before committing them to the store. A blank Session still omits the `conversation.view` slot; no unselected target is activated.

The resident composer survives no-Session and Session transitions. Without a registered unassigned-draft policy, the no-Session surface remains inert while the Workspace picker connects a blank Session. The surface is a shell-owned Lexical editor: reference chips are atomic decorator nodes carrying the owner's serialization identity (submission expands them through the owner codec), claimed slash commands stay styled leading text, folder text references carry the folder glyph as an icon prefix, and the draft's clipboard projection is mirrored into the per-Session Conversation store. Queue operations address exact queue occurrences through the scoped `ctx.conversation` service; queue previews render sent text through the shared inline reference projection from `ui-primitives` (wire session forms fold to their label) and show local image previews or durable image parts as thumbnails, while an edit exposes the literal sent text. Durable thumbnails resolve through the session image URL cache. Busy Enter behavior is stored in the Host-backed `ui-conversation` settings namespace.

A root-scoped preparation policy enables the unassigned editor after native restoration. First send locks that editor, obtains a real Session, waits for its draft restoration, and transfers the complete document and images before ordinary submission. Native transfer validates cancellation and selection immediately before publishing both owners in one checkpoint. Cancellation after publication keeps the target draft unsent and does not change the current selection. Manual project selection uses the same full-document transfer and rejects a non-empty destination.

Default sends commit optimistically: Enter clears the draft, occurrence table, and undo history in the same transaction, keeps the composer in `plain`, and runs the send as a detached attempt, so typing and further sends continue during the flight. `sendSession` registers a Session submission echo (`session.beginSubmission`) with the delivery mode before serializing; Session derives the placement from that mode and its current running state, so idle sends use the transcript, busy Queue sends use QueueDock, and busy Steer sends use the pending-steering surface. It then yields one paint and encodes images through the browser's native `FileReader` data-URL path. Concurrent failures are restored together in submission order until the user edits the restored content; command submissions keep the frozen `submitting` phase. Detached attempts retain their image ids through admission and Session scope disposal. When an echo retires as observed, the durable image cache exposes its preview immediately, fetches the admitted attachment, replaces the preview with the canonical URL, and revokes each URL after its use ends. Direct subagent continuations skip local echoes because their transport does not preserve the browser request id.

While a normal composer is running, its primary pointer action remains Stop when the draft is empty or input is unavailable. Actionable text or attachments switch the same seat to Queue Send; clearing or successfully submitting the draft restores Stop. The busy-Enter setting continues to select the Queue or Steer keyboard action. Continuable subagents keep separate Send and Stop actions ([decision](../../../.agents/notes/implemented/bug-fix/2026-08-20-running-draft-primary-send.md)).

<a id="temporary-composer-entries"></a>
## Temporary composer entries

`conversation.composer` is a generic chain. Its complete owner currency is:

```ts type-equiv
/** Owner values used to elect a composer takeover. */
interface ComposerChainProps {
  /** Current Session identity used by temporary business-owned entries. */
  sessionId: SessionId | undefined
  /** Current Session lifecycle state, absent without a selected Session. */
  session: SessionSnapshot | undefined
  /** Effective business-owned interaction awaiting the user in this Session. */
  pendingInteraction: SessionPendingInteraction | undefined
}
```

A business package may install one entry only while a Remote waterfall request is pending:

```tsx
import type { ComposerChainProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChainSelect, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

interface Request {
  readonly sessionId: SessionId
}

type RequestComposerProps =
  PropsRuntime<'conversation.composer'> & { matched: Request }

const select: ChainSelect<ComposerChainProps, Request> = owner =>
  owner.sessionId === request.sessionId ? request : null

const dispose = ctx.slots.register(
  { name: 'conversation.composer', select },
  RequestComposer,
)

try {
  return await request.result
} finally {
  dispose()
}
```

The selector must be a pure function of the owner currency. Its non-null return is delivered to the component as `matched`; `PropsRuntime<'conversation.composer'>` supplies the standard Session and global props. Chain order remains ascending `priority`, then registration order, and the first non-null selector wins. The shell keeps the default composer mounted beneath a takeover. Request state, listeners, response encoding, and any request-specific child slots belong to the business package; they are not carried by `SessionSnapshot` or declared by this core package.

<a id="model-experience"></a>
## Model Experience

None, as this package renders browser state and sends user-admitted inputs through Session Controller APIs without constructing model requests.

#### KV Cache effect

None; Conversation assembly and browser input state do not alter provider-side prompt caching.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Native draft checkpoints** — the desktop adapter retains full editor references and selected image bytes independently of browser storage. A cancelled preparation cannot return a restart receipt or unlock a newer preparation. Restoration conflicts and failed saves remain visible; the native update installer requires a separate verified final Host checkpoint, which is not yet available. Product policies own project creation; the shared editor provides no implicit filesystem or browser-storage substitute.
- **Only registered targets can render** — the shell deliberately has no implicit fallback target beyond the registered `chat` preference.


<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. Conversation Definitions, target builders, and Views are already validated by their owning registries and the Slot ledger.
