# Agent Note: Save embedded Cut exports through the owning window

Status: implemented

English | [中文](2026-10-26-mantur-cut-embedded-export.zh.md)

## Problem

The packaged Cut server bypasses Vite’s HTML transforms, so its page lacks the Session export destination. The editor runs in a different-origin iframe whose browser file picker is prohibited. Falling back to a download does not fulfill an explicit file selection. English preview-quality controls also exceed the available width beside the conversation.

The pinned browser H.264 exporter introduces an additional AAC delay. A reproduced five-second timeline has a 44 ms shift between the PCM submitted to AudioEncoder and decoded output; imported media bytes are unchanged. Independent video clips also lose approximately 9 ms at their audio start when decoded through the browser media component, before final AAC encoding. The [existing AAC finalizer](2026-09-07-mantur-cut-aac-timing.md) owns the server path, not browser encoding.

## Decision

The controlled [Cut patch](../../../../packages/client/ui-mantur-editing/adapters/mantur-cut-shutdown.patch) injects the existing export-directory grant when the embedded server serves HTML. Default exports retain the Session directory and existing checked server write path. The [workbench](../../../../packages/client/ui-mantur-editing/src/client/Workbench.tsx) relays file requests only from its current iframe Window and exact editor origin.

The isolated desktop preload checks transient user activation before asking Main to open the save dialog. The [native bridge](../../../../apps/desktop/src/cut-export-bridge.ts) accepts only the authenticated main frame of the owning window. Main retains the native-selected path; the editor receives an opaque grant. Sequential bounded chunks write to an exclusive temporary file beside the destination, and successful completion promotes that file. Cancellation, replacement, navigation and failures revoke or clean unfinished operations. Selecting a file grants no directory-wide or arbitrary-path write API. Failed cleanup retains its file owner and blocks successful shutdown; retry can release it. After interrupted shutdown preparation, the current frame can reattach and choose a new file. Reattaching the same live owner preserves its selection when a picker is canceled.

Browser deployments relay selection to a supported top-level file picker. Unsupported browsers retain the default destination or downloads. Cancellation preserves the prior destination. The preview-quality controls wrap within the available editor width.

H.264 requests select the existing local renderer and PCM-to-AAC finalizer before browser capability or speed selection, including direct browser-export callers. VP8/Opus retains its existing route. During server rendering, ordinary video clips use the existing separate server audio component while their video component is muted; preview rendering remains unchanged. No clip offset or fixed delay is added. The [source manifest](../../../../apps/desktop/mantur-cut/source.json) pins the regenerated patch digest and resulting tree; upstream and earlier patch layers remain fixed.

## Alternatives considered

**Keep the iframe picker and improve its error text.** Cross-origin restrictions still prevent selection, and the default destination remains missing.

**Pass selected paths to a general file-writing endpoint.** This gives the browser more authority than the selected output requires. A window-owned file grant limits writes and can be revoked with the editor document.

**Subtract a fixed audio offset or keep the browser path after a successful capability probe.** Codec support does not establish correct priming metadata. A fixed shift depends on encoder and sample rate; the existing server finalizer retains the encoder’s timing information.

## Verification

Bridge regressions cover rejected origins and windows, missing activation, cancellation, stale selection, ordered writes and cleanup. Embedded-server checks exercise the served HTML and destination grant. Export-route checks require H.264 to reach the local renderer while preserving VP8. The patched editor’s `npm run verify:audio-finalization` includes a real AAC-video regression with software and VideoToolbox rendering, split clips, silent media, mute and zero volume. The five-second regression project has 150 verified red/blue frames, a 2.000-second color change and non-silent audio at the start, split and color-change boundaries. A frozen composition fails the same PCM boundary assertion. Stream duration alone is not a synchronization assertion. Native dialogs and narrow-window layout still require the release candidate’s GUI acceptance on each target platform.

## Consequences

H.264 rendering uses local media tools, a browser subprocess and temporary PCM/video storage even on systems that support browser encoding. This favors verified audio timing over the browser speed heuristic. Native file authorization lasts only for the current editor document; the [recovery persistence decision](2026-10-27-mantur-native-export-recovery.md) defines how that limit survives export-job storage. The [workbench decision](../feature/2026-09-06-mantur-local-editing-workbench.md) retains Session and subprocess ownership; this decision adds the export relay without changing the Harness core or public MCP tools.
