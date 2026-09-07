# Agent Note: Validate the OpenChatCut editing workbench

Status: proposed

English | [中文](2026-09-06-openchatcut-editing-workbench.zh.md)

## Problem

Mantur users need an editable timeline beside the existing conversation, with manual control, preview, undo, saved projects, and playable exports. A separate editor window or successful tool reply alone cannot demonstrate this workflow.

## Proposal

Evaluate OpenChatCut 0.2.14 at commit `19cba6e1a70a3e589545ce02de975f6494c918f6` before adding product code. Keep Mantur responsible for reasoning and use existing plugin, profile, tool, and UI extension points. The external entry documented by the upstream Skill is MCP; the browser bridge is internal, and no supported editing CLI or published SDK was found. The user authorized the experimental MCP connection. The [local workbench implementation](../../implemented/feature/2026-09-06-mantur-local-editing-workbench.md) records browser, persistence, and export evidence; production packaging and multi-project binding remain proposed.

The source uses `useEditor`, `buildCommands`, `makeDraft`, and project/history reducers, rather than a separately published EditorCore package. A source-level check imports three synthetic MP4 asset references, trims each to 60 frames at 30 fps, and uses `edit_track/reorder_items` to place C, A, B at frames 0, 60, 120. Atomic undo/redo, direct command mutation followed by tool readback, and a JSON roundtrip pass. This does not prove browser import, human gestures, application persistence, rendering, export, or Mantur integration.

The isolated Node 24 service returns HTTP 200 on loopback with an explicit empty data directory and no model credentials. Nine focused upstream checks pass. The embedded browser is usable in the integration verification; an earlier `ERR_BLOCKED_BY_CLIENT` is not an attributed OpenChatCut defect. Individual `move_item` calls can report success while collision constraints alter the final frame, so integrations must verify state after mutations.

The distributable desktop proposal builds only on the matching native runner and pins the OpenChatCut commit, upstream tree, two patch digests and result trees, npm package integrities, Chrome archive, FFmpeg binary, and whisper.cpp v1.9.2 commit. The generated read-only `resources/mantur-cut` tree contains the embedded server, editor assets, Remotion bundle and compositor, Chrome Headless Shell, FFmpeg, ffprobe, Whisper CLI and server, production dependencies, source identity, patches, retained licenses, dependency inventory, build hashes, and production audit. Electron supplies the Node 24 runtime through `ELECTRON_RUN_AS_NODE=1`; the package does not carry another Node installation. Runtime code must resolve every declared relative path inside this resource root and must not download or use a development fallback. Application data remains under the installed application's user-data and project directories.

The internal package workflow builds unsigned candidates for macOS arm64, macOS x64, and Windows x64. The public workflow signs and notarizes macOS candidates but cannot publish unless the protected `MANTUR_CUT_DISTRIBUTION_APPROVAL` variable equals `approved:<source-config-sha256>` for the complete pinned distribution configuration. This approval records an external release decision; the build does not infer license acceptance from successful compilation.

## Alternatives considered

Copying the editor core would create a second maintained implementation. Calling the trusted browser bridge as an external client would depend on an unsupported private interface. Launching an external browser does not satisfy the embedded-workbench requirement. None of these alternatives is implemented.

## Acceptance criteria

A user opens the workbench inside Mantur while the conversation remains usable. Three clearly marked local test clips are imported, reordered and trimmed by Mantur, previewed, changed manually and read back by the agent, undone, saved and reopened, and exported to a playable MP4. Draft review and per-operation export confirmation remain effective. Each native package verifies all manifest paths, starts the packaged Whisper CLI and server, exercises an export, and records its exact source, build, audit, signature, and notarization evidence. Evidence distinguishes command tests from end-to-end results; macOS Intel and Windows require native validation.

## Risks

OpenChatCut's AGPL-3.0-or-later terms require a concrete corresponding-source delivery method for modified distributions. Remotion 4.0.509 has separate terms whose free grant depends on entity eligibility and allowed use; the distributor must confirm eligibility or obtain the required company license. ffmpeg-static declares GPL-3.0-or-later, target ffprobe packages declare GPL-3.0 or LGPL-2.1, whisper.cpp declares MIT, and Chrome Headless Shell carries its own notice file. The current pinned production audit reports four high-severity dependency findings in `@huggingface/transformers`, `onnxruntime-node`, `adm-zip`, and `sharp`; successful packaging does not resolve or approve them. The Mantur iframe does not yet install OpenChatCut's desktop inference preload, so packaging and starting the Whisper binaries does not make native ASR available. Bundled font terms and other binary dependencies also require review. Open source is not a commercial embedding clearance. The source exposes live-project export with one-shot approval bound to session, run, tool, and arguments; README wording that excludes external export is stale. Packaging, media permissions, browser isolation, project ownership, cancellation, and editor lifecycle remain unverified integration costs.
