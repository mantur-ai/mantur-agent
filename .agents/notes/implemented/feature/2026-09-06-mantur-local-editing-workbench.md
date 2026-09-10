# Agent Note: Open a local editing workbench from Mantur

Status: implemented

English | [中文](2026-09-06-mantur-local-editing-workbench.zh.md)

## Problem

Selecting Editing on the Mantur home screen needs to open a complete timeline editor beside the conversation. The details column is session-scoped and constrained to a narrow tool view; `main.page` hides the conversation. Neither existing seat expresses this layout.

## Decision

Add the generic root `main.workbench` seat and transient open/close actions to `ui-layout`. Keep the conversation at a stable tree position. The optional `ui-mantur-editing` plugin owns the editor view, localized controls, authenticated Remote, and Session runtime. Development profiles supply an explicit editor checkout and Node configuration; the [packaged runtime proposal](../../proposed/architecture/2026-09-07-mantur-packaged-editing-runtime.md) owns distribution-specific configuration. No agent-loop change or second editor implementation is required.

Navigation emits the typed `mantur/creation-mode-selected` event only after settings accept an explicit choice. Repeated choices emit again; hydration and failed writes do not. Editing opens the workbench, another mode closes it, and plugin disposal releases its listener and embedded page. Mode buttons adapt to the conversation column width. The upstream editor retains responsibility for media, project saving, proposal review, and export.

The Host resolves the selected Agent through Typert before reading its Session working directory. Each Session uses `<cwd>/剪辑/<session-id>/` with separate project, media, and export directories. A Session-owned subprocess runs patched OpenChatCut 0.2.14, commit `19cba6e1a70a3e589545ce02de975f6494c918f6`. The existing `dsh-mcp-client` mounts only in that Agent's scope; its bearer remains on the Host. Concurrent opens share startup, different Sessions keep separate runtimes, and disposal waits for process exit. Existing experiment projects remain at their original paths.

The Host imports the MCP plugin's `apply`, `Config`, `inject` and `name` explicitly. `apply` requires a shared peer instance because its server-name reservations live in a module-owned WeakMap; configuration and name metadata are duplicate-safe values. Type-only Host references remain development dependencies, while the Typert runtime is a normal dependency.

The workbench subscribes to resolved theme and locale. Initial URL parameters carry the first appearance; later changes use origin- and window-checked messages without navigating the frame. The adapter changes UI tokens and locale while preserving exported pixels. The package payload gate includes the standalone theme adapter, runtime launcher, and pinned upstream patch. The patch maps imported media and the default export destination into the Session directories.

Visibility belongs to the selected Session, including blank sessions. Without a Session and project, opening shows a diagnostic. `ui-layout` mirrors the selected id before gestures and stores the open ids. The patch removes internal chat, connection setup, duplicate settings, skills/extensions, generation shortcuts, design controls, and upstream promotion. It retains the tool bridge and confirmation cards and presents the product as 漫途Cut.

Project media uses the canonical Agent working directory supplied by the Host. A checked local editor route browses folders and reuses the upstream reference import pipeline for both UI and Agent imports. Every requested path and symlink target stays within that project; editing outputs and hidden directories are excluded. Relocation updates the existing asset through the editor command API. Compatible sources are served through reference manifests, and deleting those manifests preserves the original files.

Approved local imports use the existing draft executor and checkpoint persistence. Writing their assets directly to the live project would invalidate the importing edit session's own base revision. Manual file-access confirmation remains separate from draft review; cancellation and concurrent live edits reject the candidate without publishing its assets. Other real-project tools retain their existing execution path. Terminal editing sessions retain their original revision, saved draft and operations as evidence. The initial checkpoint, later draft saves, review and terminal closure share one persistence queue. Terminal records close in-memory editing before ledger finalization, so a ledger failure cannot leave a durable terminal session writable. The reader never resumes terminal sessions, rebases stale changes or reconstructs missing history. Fixed adapter sources and the expected result tree are recorded in the [package README](../../../../packages/client/ui-mantur-editing/README.md#understand-the-implementation).

The editing child contributes workflow guidance through the existing Agent-scoped `systemPrompt.section` after MCP startup succeeds. Tool schemas describe individual calls but do not fully explain the transition from applied review to a fresh read draft. The section makes that sequence visible in the actual logged request without changing the shared MCP consumer or agent loop. Its lifetime matches the workbench runtime, including retained hidden views. The [package model experience](../../../../packages/client/ui-mantur-editing/README.md#understand-the-implementation) owns the scope and contents.

## Alternatives considered

The existing details seat is too narrow and unavailable on the home screen; a main page hides the conversation. Copying editor state would duplicate its persistence and undo logic. The generic workbench seat keeps those responsibilities with their existing owners.

**Relying only on upstream Skills or server instructions.** Skill discovery does not establish that an Agent loaded a workflow, and the current MCP client does not project server instructions into model requests. A local section supplies the necessary sequence through an existing logged extension point. Copying the editor's internal Agent instructions would describe a different tool channel; a generic MCP prompt framework would expand this integration's ownership unnecessarily.

## Verification

Applying the controlled patch to its clean upstream commit produces exactly the recorded editor tree. The terminal persistence regression uses production JSON storage in fresh writer and reader processes and covers checkpoint retention, write failure, ledger failure, initial and later saves racing with cancellation, and refusal to apply terminal sessions. The import regression preserves the local-file approval and revision checks. These checks do not establish live deployment, recovery of missing historical drafts, or a cause for a browser/MCP disconnection.

The adapter's `verify:mantur-import-session` check uses real project-media HTTP routes and synthetic local videos. It covers consecutive file and folder imports, draft deduplication, approval and denial before file access, checkpoints, review/apply, concurrent-edit rejection, cancellation, and unchanged originals. Existing edit-session and MCP binding checks remain in force. A natural-language client import-to-export run is separate acceptance evidence.

Focused component and composition tests cover opening before a Session exists, preserving the conversation node, close/reopen, repeated choices, rejected writes, invalid editor addresses, localization snapshots, and disposal. Client tests exercise pending and failed runtime startup, injected theme reads and listener disposal, and rejection of malformed frame-ready messages. The package-wide style assertion enforces 0.5px neutral borders on the workbench and its conversation divider. Source composition tests explicitly substitute the generated Remote; built composition acceptance uses the generated implementation. A real `dsh --profile mantur` composition opens the saved editor project from its home Editing tab.

Project-media checks exercise directory exclusion, origin checks, traversal and symlink rejection, reference-backed HTTP streaming, duplicate imports, moved-file relocation, and source-preserving removal. A real MCP import added a project image after the existing confirmation card approved it; UI import added another image and skipped the already-imported image. The development launcher retains its OS-assigned port in Vite's restart configuration so source hot updates keep media requests on the same origin.

Host tests cover separate Session directories, retained files, rejected traversal and links, startup failure and timeout, quiescent shutdown, coalesced opens, and Agent-scoped MCP mounting. Client tests reject stale startup results after switching Sessions and keep theme/locale changes on the mounted frame.

Three synthetic local MP4 clips were imported in the real editor. Public MCP staged three trims and a reorder; manual UI approval applied four operations. The timeline changed from nine seconds to six, and one undo/redo reversed/restored the batch. Reopening the project inside Mantur restored the six-second timeline. Browser export produced 180 H.264 frames at 1920×1080; full decode and samples at seconds 1, 3, and 5 confirmed C, A, B. No model request was made.

The compact host header and bounded conversation width leave more room for the editor. The presentation patch starts with a narrower media panel, a lower timeline, and a collapsed Inspector; existing saved editor panel preferences still apply. Panel dividers and the Inspector toggle remain available.

The keyless Mantur editing snapshot boots the shipped Web composition through Loader, launches an external editor fixture, discovers tools through the real MCP client, and compares the recorded session and full request-header prompt. Controller tests cover unopened and different Agent scopes, repeated opens, failed startup and removal after Agent or Host disposal. These checks establish prompt delivery and lifetime, not model compliance, real editing outcomes or connection recovery. The Web fixture replaces its exact temporary working directory in prompt pins, including paths followed by Chinese punctuation, while retaining the full session and prompt comparisons.

## Upgrade check

The desktop dev Agent called the scoped editing tools and read the active project. Importing a synthetic clip and exporting a six-second timeline saved a fully decodable 1080p MP4 in the Session export directory. Switching away hid the workbench and returning retained its projects. The session-header Editing action reopens the view after page reload.

After upstream changes, reapply the patch and rerun editing/layout tests, the Host and Client builds, and the desktop home-mode flow. Check two Sessions and two working directories, retained media, Agent tool scope, proposal approval, default export destination, and subprocess teardown. Verify that patching cannot restore the removed internal Agent configuration.

## Consequences

Development requires a prepared local editor checkout and compatible Node executable. Production resource closure and native package acceptance remain distribution work. Closing a view preserves background jobs; disposing its Agent or Host stops the runtime without deleting persistent project files.
