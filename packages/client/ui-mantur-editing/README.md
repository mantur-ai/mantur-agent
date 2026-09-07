---
description: "Open a local editing workbench beside the Mantur conversation."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-mantur-editing

English | [中文](README.zh.md)

## Summary

Open the local editor beside the Mantur conversation by selecting Editing on the home screen. The editor owns its media pool, preview, timeline, and project saving. This optional plugin starts a separate editor for each Session in that Session's working directory.

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

The Mantur bundle contains a disabled row. Enable `ui-mantur-editing` in a profile patch and provide the runtime fields below. Selecting Editing opens the current Session through the authenticated Remote gateway. The conversation header also offers Editing to reopen a saved Session after closing the view or refreshing the page. Without a selected Session and working directory, the workbench shows a diagnostic. Closing the workbench releases its page while background editor work continues until the Agent or Host is disposed.

Each Session uses `<cwd>/剪辑/<session-id>/`: `工程/` contains project persistence and runtime state, `素材/` contains imported media, and `导出/` is the default export destination. The Host reads `cwd` from the resolved Agent's Session header; the browser cannot select another path. Session directory components reject traversal and symbolic links. Reopening preserves files. Different Sessions use separate runtimes and tool scopes even within one project.

The Project media tab browses the current Agent directory and its subdirectories. Imports reference compatible originals in place; required compatibility conversions write separate files and never modify originals. The same endpoint backs `import_asset` and `import_folder`. Hidden directories, `node_modules`, and the project's `剪辑` tree are excluded. A refresh reads new files; missing sources stay offline until the user selects a replacement. Removing pool entries or reference records never deletes originals.

Agent local-file imports retain one-shot confirmation in manual mode and add assets to the editing draft. Repeated imports deduplicate against that draft; review applies imported assets together with timeline edits. A concurrent live project change still rejects the draft as stale.

The embedded editor follows Mantur's resolved light/dark theme, including system preference changes, without reloading its page. The OpenChatCut deployment must load [the theme adapter](adapters/openchatcut-theme.mjs) before its application renders and call `installManturTheme(window, parentOrigin)` with the exact trusted Mantur loopback origin. Import this module into the editor entry or inject an equivalent module script from its server; include the adapter in the editor's deployed assets. Standalone editor windows keep their own skin preference. The adapter changes UI tokens only, preserves media colors and project state, and never writes the standalone skin preference.

Apply [the Mantur Cut patch](adapters/mantur-cut.patch) with `git apply` to the pinned OpenChatCut 0.2.14 source before building. It removes internal chat, external connection setup, duplicate model/appearance settings, generation shortcuts, skills/extensions, design controls, and upstream promotion. Media, captions, timelines, history, exports, and the floating edit approval card remain. Language follows Mantur through the same checked message channel as theme. UI branding is 漫途Cut; attribution, licenses, protocol identifiers, and project formats retain their upstream names.

The compact host header and bounded conversation width leave more room for the editor. The presentation patch starts with a narrower media panel, a lower timeline, and a collapsed Inspector; existing saved editor panel preferences still apply. Panel dividers and the Inspector toggle remain available.

| Field | Default | Meaning |
|---|---|---|
| `editorRoot` | required | Absolute patched editor checkout path with dependencies installed |
| `nodeExecutable` | required | Absolute compatible Node executable |
| `startupTimeoutMs` | required | Maximum editor startup wait |
| `stopTimeoutMs` | required | Shutdown grace before forced termination |
| `toolCallTimeoutMs` | required | Maximum duration of one editing tool call |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Host Remote resolves the Agent, coalesces concurrent opens, and launches `adapters/mantur-runtime.mjs`. It mounts the existing MCP client inside that Agent's scope. The MCP bearer remains in Host memory and the child environment. Disposal drains both connection and subprocess. The Client ignores startup responses from a Session that is no longer selected. No invariant companion is published: subprocess exit state belongs to the child handle; connection and tool-generation invariants belong to the MCP client.

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

Indirectly, through the Agent-scoped MCP client that owns editing tool discovery, execution, and logged results.

#### KV Cache effect

Opening editing changes the Agent's available tool definitions; subsequent requests may rebuild the corresponding prompt-cache prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The checkout adapter is a local development integration. Shipping the editor, dependencies, native binaries, and platform installers remains distribution work.
- Closing or reloading recreates the editor page. The editor owns saved projects and any unsaved-change behavior. Workbench visibility resets on page reload.
- Runtime failures are shown explicitly. A user retry can restart after cleanup. Previous experiment projects remain in their original directory; this integration does not silently migrate or adopt them.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
