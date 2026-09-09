---
description: "Open a local editing workbench beside the Mantur conversation."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-mantur-editing

English | [中文](README.zh.md)

## Summary

Open the local editor with the chevron at the right edge of the Mantur conversation. Creation mode selection does not open or close the workbench. The editor owns its media pool, preview, timeline, and project saving. This optional plugin starts a separate editor for each Session in that Session's working directory.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The packaged desktop enables `ui-mantur-editing` with its installed resource directory and Electron executable. A development profile explicitly selects `runtimeMode: development` and supplies the runtime fields below. The resident edge chevron opens the current Session through the authenticated Remote gateway and collapses the workbench when expanded. Its localized accessible label and `aria-expanded` describe the current action and state. Without a selected Session and working directory, the workbench shows a diagnostic. Hiding the workbench retains the current Session’s editor page and native Agent binding. Reopening that view continues the same editing draft. The header's Refresh action recreates the editor page for the same Session; it does not delete saved project files. Agent or Host disposal requests the same checked runtime shutdown; an unconfirmed drain retains its owner.

The Agent can call `open_editing_workbench` before the native editing tools are mounted. The call takes no project or Session argument and uses its calling Agent’s existing workspace. Its successful result means the runtime and native MCP connection are ready; it does not mean an edit was applied. The Client observes opening calls once the resident edge button is mounted, and shows the workbench only after observing a live call move from pending to success. A user collapse suppresses later automatic openings for that Session, including later turns; the edge chevron remains available for manual expansion. Replayed history and switching back do not reopen the panel. Hidden views retain tools, the editor page and active work.

Each Session uses `<cwd>/剪辑/<session-id>/`: `工程/` contains project persistence and runtime state, `素材/` contains imported media, and `导出/` is the default export destination. The Host reads `cwd` from the resolved Agent's Session header; the browser cannot select another path. Session directory components reject traversal and symbolic links. Reopening preserves files. Different Sessions use separate runtimes and tool scopes even within one project.

The Project media tab browses the current Agent directory and its subdirectories. Imports reference compatible originals in place; required compatibility conversions write separate files and never modify originals. The same endpoint backs `import_asset` and `import_folder`. Hidden directories, `node_modules`, and the project's `剪辑` tree are excluded. A refresh reads new files; missing sources stay offline until the user selects a replacement. Removing pool entries or reference records never deletes originals.

Agent local-file imports retain one-shot confirmation in manual mode and add assets to the editing draft. Repeated imports deduplicate against that draft; review applies imported assets together with timeline edits. A concurrent live project change still rejects the draft as stale. Stale, cancelled and failed sessions retain their last saved checkpoint as read-only evidence, including the original revision, draft document and operations. Initial saves, later saves and terminal closure run in order. Reloading never resumes a terminal session or reconstructs missing historical content.

The workbench header, buttons, and conversation divider use Mantur's 0.5px neutral borders.

The embedded editor follows Mantur's resolved light/dark theme, including system preference changes, without reloading its page. The OpenChatCut deployment must load [the theme adapter](adapters/openchatcut-theme.mjs) before its application renders and call `installManturTheme(window, parentOrigin)` with the exact trusted Mantur loopback origin. Import this module into the editor entry or inject an equivalent module script from its server; include the adapter in the editor's deployed assets. Standalone editor windows keep their own skin preference. The adapter changes UI tokens only, preserves media colors and project state, and never writes the standalone skin preference.

Apply [the Mantur Cut patch](adapters/mantur-cut.patch) with `git apply` to the pinned OpenChatCut 0.2.14 source before building. It removes internal chat, external connection setup, duplicate model/appearance settings, generation shortcuts, skills/extensions, design controls, and upstream promotion. Media, captions, timelines, history, exports, and the floating edit approval card remain. Language follows Mantur through the same checked message channel as theme. UI branding is 漫途Cut; attribution, licenses, protocol identifiers, and project formats retain their upstream names.

The compact host header and bounded conversation width leave more room for the editor. The presentation patch starts with a narrower media panel, a lower timeline, and a collapsed Inspector; existing saved editor panel preferences still apply. Panel dividers and the Inspector toggle remain available.

| Field | Default | Meaning |
|---|---|---|
| `runtimeMode` | required | `development` for a Vite checkout; `packaged` for the built production server |
| `editorRoot` | required | Absolute prepared checkout or packaged resource directory |
| `nodeExecutable` | required | Absolute Node executable for development; installed Electron executable for packaged mode |
| `startupTimeoutMs` | required | Maximum editor startup wait |
| `stopTimeoutMs` | required | Maximum close acknowledgement and child/pipes close wait; expiry rejects without killing |
| `toolCallTimeoutMs` | required | Maximum duration of one editing tool call and each editor drain request |

Packaged mode validates the platform-specific `manifest.json` before opening a Session. Format version 2 identifies resources built with all three editor patches; version 1 is rejected rather than reused by the shutdown-aware runtime. The `./packaged-resources` export exposes the same resource check for installer smokes. Missing assets, unsupported targets and paths outside the installation fail; the runtime does not download replacements or start Vite. The production entry copies only the writable Remotion bundle and compositor into a private Session directory and places temporary files there. Normal shutdown removes that directory after HTTP closure; the Host then waits for child close. A failed drain or close retains private runtime files and rejects shutdown. Persistent project, media and export directories remain. Resource fields and unresolved distribution checks are recorded in the [packaged runtime proposal](../../../.agents/notes/proposed/architecture/2026-09-07-mantur-packaged-editing-runtime.md).

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The public `./types` entry ships as `lib/types.js`, separately from the Host and Client bundles. TypeScript declarations remain under `lib/types/`; private browser JavaScript and its unbundled stylesheet imports are not published.

`ctx.manturEditing.stopForShutdown()` freezes new opens and native MCP executions, retains opening and opened owners, and waits for accepted responses and attachment writes. The editor then freezes browser input, drains accepted browser work and its late jobs, saves project and run state through the existing authenticated poll/result channel, and confirms durable browser unregistration. Native transport closure follows that acknowledgement. MCP GET streams and DELETE handlers retain their original promises separately from save callbacks; the adapters await `finishTransportShutdown()` after the Host closes its drained MCP client and before closing HTTP. The Host then requires the actual editor child `close`, including its pipes. Repeated calls retain the original success or failure. Timeouts leave work running and reject; the coordinator must keep Agent services, HTTP and the editor page alive until this promise settles.

After applying [the packaged patch](adapters/mantur-cut-packaged.patch), apply [the shutdown patch](adapters/mantur-cut-shutdown.patch) on editor tree `2a5be55239826a9e74bde5a5a5484a0f033d4da0`. It adds no public MCP tool and does not change the pinned audio finalizer. The owned render path propagates `browser.close()` failures, but Remotion 4.0.509 exposes no supported child-and-pipe close completion; an instance that acquired its render browser therefore refuses shutdown confirmation. Used unowned producers and retained save/job errors also refuse confirmation. This increment is not complete installation approval; [the shutdown decision](../../../.agents/notes/implemented/bug-fix/2026-09-08-mantur-editing-owned-shutdown.md) records verification limits.

The editor pins patched image and archive dependencies without changing model or speech providers; see the [dependency security decision](../../../.agents/notes/implemented/bug-fix/2026-09-08-mantur-editor-security-dependencies.md) for scope and native verification limits.

Browser tool results synchronize the authoritative project revision before completing the MCP call. Synchronization failure remains an error, and cancellation or a replaced registration cannot revive success; see the [result revision decision](../../../.agents/notes/implemented/bug-fix/2026-09-09-mantur-editor-result-revision.md).

The editor checks actual semantic-vector availability through the project-store transport before index operations. Failed or malformed checks remain errors. Accepted mutations remain part of browser shutdown. Exact extension and model catalog GET requests retain their original completion promises; download and installation requests still require their own shutdown ownership.

Local `/api/extract-frames` requests retain FFmpeg, FFprobe, optional Python label work and temporary-file cleanup. Partial previews do not clear failed sampling or stamping; such errors still reject shutdown. The [frame extraction decision](../../../.agents/notes/implemented/bug-fix/2026-09-08-mantur-extract-frames-shutdown.md) records real-media checks and their limits.

Isolated-profile POST and PUT requests to `/upload` retain their request body, storage work and file-stream close result. Other upload routes and default profiles remain unconfirmed. The [local upload decision](../../../.agents/notes/implemented/bug-fix/2026-09-08-mantur-local-upload-shutdown.md) records supported paths and validation limits.

| Shutdown layer | Fixed value |
|---|---|
| Editor commit | `2ee4ba5962336268d5de95b24a4fe5b09d8ba5c1` |
| Result tree | `6f3b4ba1dbfbfbe02fcaefd80998b8f6d049c15b` |
| Patch SHA-256 | `ed820c9fd777c305986f713be304387109003d6cb7b4fb07f0956f5865bbb9c4` |

The Host Remote resolves the Agent, coalesces concurrent opens, and launches `adapters/mantur-runtime.mjs`. It mounts the existing MCP client inside that Agent's scope. All mounted MCP clients resolve the same peer instance, preserving Agent-scoped server-name reservations. The MCP bearer remains in Host memory and the child environment. Disposal drains both connection and subprocess. The Client ignores startup responses from a Session that is no longer selected. No invariant companion is published: subprocess exit state belongs to the child handle; connection and tool-generation invariants belong to the MCP client.

The opening tool is registered with the editing plugin independently of panel visibility. Its success carries credential-free `mantur-editing-workspace` presentation metadata containing the calling Session, loopback editor address and editing directory. The address is constructed from a validated local port; the bearer remains on the Host. Startup and cancellation failures remain ordinary tool errors. Client opening signals use existing conversation events; they do not inspect model prose. See the [Agent entry decision](../../../.agents/notes/implemented/feature/2026-09-09-mantur-agent-editing-entry.md).

Opening the workbench mounts the native MCP tools and a `systemPrompt.section` in that Agent's scope after startup succeeds. The section explains draft reads, review and terminal status, starting a fresh draft after application, inspecting saved work before repeating mutations, and project versus source frame rates. The next model request records this guidance in `request/header`. Unopened Agents receive no editing section; hiding the view retains it, while Agent or Host disposal removes it. This guidance does not repair a disconnected transport or prove that an edit succeeded.

The controlled [editor patch](adapters/mantur-cut.patch) has these fixed sources. Apply it to a clean upstream checkout with `git apply --index`; `git write-tree` must match the result tree before building. It includes draft import, terminal checkpoint persistence, and ordinary H.264 audio finalization. The latter separates the existing PCM mix and encodes AAC directly into MP4 after video rendering, preserving video packets and the pinned Remotion audio-track behavior. See the [audio timing decision](../../../.agents/notes/implemented/bug-fix/2026-09-07-mantur-cut-aac-timing.md) for failure handling, regression commands and upgrade limits.

| Source | Fixed value |
|---|---|
| OpenChatCut 0.2.14 upstream commit | `19cba6e1a70a3e589545ce02de975f6494c918f6` |
| Patched editor commit | `863354fba45960fafc9e7d0661b65f413d1baeee` |
| Patched editor tree | `65d96973380a14050c19c0928a22d1fd59714af7` |
| Patch SHA-256 | `6a292e61b74e4915723d389cc7c77f87fcbd91f71860f666223e2c6916479307` |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Layout](../ui-layout/README.md) — conversation and workbench composition.
- [Mantur navigation](../ui-mantur-navigation/README.md) — creation mode selection.
- [MCP client](../../mcp/mcp-client/README.md) — Agent-scoped editing tools.

-----

<a id="model-experience"></a>
## Model Experience

### Editing entry and native workflow

#### What the model sees

`open_editing_workbench` is available before first use and returns the calling Session, local editor URL and editing directory as JSON; failures remain tool errors. After startup, Agent-scoped native MCP tools and the workflow section join the logged model request. Opening, applying a draft, saving and export remain distinct outcomes.

#### Token effect

The opening schema adds a fixed request cost. A successful open adds native tool definitions and the workflow section; call results accumulate in Session history until compaction.

#### KV Cache effect

Opening editing changes that Agent's tool definitions and system prompt; subsequent requests may rebuild the corresponding prompt-cache prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The checkout adapter is a local development integration. Shipping the editor, dependencies, native binaries, and platform installers remains distribution work.
- Switching Sessions, explicitly reloading the editor, or refreshing the page recreates the editor page. Continuing an old draft across these actions is not supported. Other Sessions do not retain hidden editor pages; saved projects remain on disk. Workbench visibility resets on page reload.
- Runtime failures are shown explicitly. A user retry can restart after cleanup. Previous experiment projects remain in their original directory; this integration does not silently migrate or adopt them.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
