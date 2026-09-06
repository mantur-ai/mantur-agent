# Agent Note: Open a local editing workbench from Mantur

Status: implemented

English | [中文](2026-09-06-mantur-local-editing-workbench.zh.md)

## Problem

Selecting Editing on the Mantur home screen needs to open a complete timeline editor beside the conversation. The details column is session-scoped and constrained to a narrow tool view; `main.page` hides the conversation. Neither existing seat expresses this layout.

## Decision

Add the generic root `main.workbench` seat and transient open/close actions to `ui-layout`. Keep the conversation at a stable tree position. The optional `ui-mantur-editing` plugin supplies the embedded local editor, localized controls, and validated address from Host settings. The Mantur bundle contains a disabled row so deployments must supply a running editor address explicitly. No agent-loop change or second editor implementation is required.

Navigation emits the typed `mantur/creation-mode-selected` event only after settings accept an explicit choice. Repeated choices emit again; hydration and failed writes do not. Editing opens the workbench, another mode closes it, and plugin disposal releases its listener and embedded page. Mode buttons adapt to the conversation column width. The upstream editor retains responsibility for media, project saving, proposal review, and export.

The isolated experiment mounts the existing `dsh-mcp-client` through a profile overlay against OpenChatCut 0.2.14, commit `19cba6e1a70a3e589545ce02de975f6494c918f6`. Its bearer credential remains on the Host. This transport is a single-project experiment; production session-to-project binding and process packaging are not implemented by the presentation plugin.

The workbench subscribes to the resolved theme service. A fixed initial URL carries the first color scheme; subsequent changes use origin- and window-checked messages without navigating the frame. A deployment-loaded OpenChatCut adapter owns the light/dark UI tokens and leaves project state, exported pixels, and standalone skin storage untouched. The adapter is maintained in the presentation package; the upstream editor core is unchanged. The package payload allowlist in `scripts/check-workspace-constraints.ts` includes its standalone module and declaration because the external editor does not use the Mantur client loader; the payload test verifies both files remain published.

## Alternatives considered

The existing details seat is too narrow and unavailable on the home screen; a main page hides the conversation. Copying editor state would duplicate its persistence and undo logic. The generic workbench seat keeps those responsibilities with their existing owners.

## Verification

Focused component and composition tests cover opening before a Session exists, preserving the conversation node, close/reopen, repeated choices, rejected writes, invalid editor addresses, localization snapshots, and disposal. A real `dsh --profile mantur` composition opens the saved editor project from its home Editing tab.

Three synthetic local MP4 clips were imported in the real editor. Public MCP staged three trims and a reorder; manual UI approval applied four operations. The timeline changed from nine seconds to six, and one undo/redo reversed/restored the batch. Reopening the project inside Mantur restored the six-second timeline. Browser export produced 180 H.264 frames at 1920×1080; full decode and samples at seconds 1, 3, and 5 confirmed C, A, B. No model request was made.

## Upgrade check

After upstream changes, rerun layout, navigation, and editing package tests, the Client build, and the browser home-mode open/close flow. Verify the real editor still accepts its project URL inside an iframe, restores saved media, reviews public MCP drafts, and exports a decodable file. Recheck project ownership and transport revision errors before supporting multiple sessions.

## Consequences

The editor must already be running on loopback HTTP. AGPL, Remotion, font licensing, native binary installation, and Windows/macOS Intel packaging remain distribution work. The experiment does not establish a supported multi-project model workflow or commercial embedding clearance.
