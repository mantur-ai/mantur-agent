# Agent Note: Validate the OpenChatCut editing workbench

Status: proposed

English | [中文](2026-09-06-openchatcut-editing-workbench.zh.md)

## Problem

Mantur users need an editable timeline beside the existing conversation, with manual control, preview, undo, saved projects, and playable exports. A separate editor window or successful tool reply alone cannot demonstrate this workflow.

## Proposal

Evaluate OpenChatCut 0.2.14 at commit `19cba6e1a70a3e589545ce02de975f6494c918f6` before adding product code. Keep Mantur responsible for reasoning and use existing plugin, profile, tool, and UI extension points. The external entry documented by the upstream Skill is MCP; the browser bridge is internal, and no supported editing CLI or published SDK was found. An experimental MCP connection requires explicit user approval and remains unimplemented.

The source uses `useEditor`, `buildCommands`, `makeDraft`, and project/history reducers, rather than a separately published EditorCore package. A source-level check imports three synthetic MP4 asset references, trims each to 60 frames at 30 fps, and uses `edit_track/reorder_items` to place C, A, B at frames 0, 60, 120. Atomic undo/redo, direct command mutation followed by tool readback, and a JSON roundtrip pass. This does not prove browser import, human gestures, application persistence, rendering, export, or Mantur integration.

The isolated Node 24 service returns HTTP 200 on loopback with an explicit empty data directory and no model credentials. Nine focused upstream checks pass. Codex's embedded browser reports `ERR_BLOCKED_BY_CLIENT`; that is a verification-environment obstacle, not an attributed OpenChatCut defect. Individual `move_item` calls can report success while collision constraints alter the final frame, so integrations must verify state after mutations.

## Alternatives considered

Copying the editor core would create a second maintained implementation. Calling the trusted browser bridge as an external client would depend on an unsupported private interface. Launching an external browser does not satisfy the embedded-workbench requirement. None of these alternatives is implemented.

## Acceptance criteria

A user opens the workbench inside Mantur while the conversation remains usable. Three clearly marked local test clips are imported, reordered and trimmed by Mantur, previewed, changed manually and read back by the agent, undone, saved and reopened, and exported to a playable MP4. Draft review and per-operation export confirmation remain effective. Evidence distinguishes command tests from end-to-end results; macOS Intel and Windows require native validation.

## Risks

AGPL-3.0-or-later, Remotion's separate license, bundled font terms, and binary dependencies require distribution review. Open source is not a commercial embedding clearance. The source exposes live-project export with one-shot approval bound to session, run, tool, and arguments; README wording that excludes external export is stale. Packaging, media permissions, browser isolation, project ownership, cancellation, and editor lifecycle remain unverified integration costs.
