---
description: "Open a local editing workbench beside the Mantur conversation."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-mantur-editing

English | [中文](README.zh.md)

## Summary

Open the local editor beside the Mantur conversation by selecting Editing on the home screen. The editor owns its media pool, preview, timeline, and project saving. This optional presentation plugin requires a running local editor and an explicit address.

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

The Mantur bundle contains a disabled row. Enable `ui-mantur-editing` in a profile patch and supply `config.editorUrl`. The address must use loopback HTTP without credentials or query parameters; a project hash is allowed. Selecting Editing opens the workbench after the mode preference is saved. Selecting another mode or closing the workbench releases the embedded page; selecting Editing again reopens it.

The embedded editor follows Mantur's resolved light/dark theme, including system preference changes, without reloading its page. The OpenChatCut deployment must load [the theme adapter](adapters/openchatcut-theme.mjs) before its application renders and call `installManturTheme(window, parentOrigin)` with the exact trusted Mantur loopback origin. Import this module into the editor entry or inject an equivalent module script from its server; include the adapter in the editor's deployed assets. Standalone editor windows keep their own skin preference. The adapter changes UI tokens only, preserves media colors and project state, and never writes the standalone skin preference.

| Field | Default | Meaning |
|---|---|---|
| `editorUrl` | required | Absolute local editor address, optionally including its project hash |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Host settings publish the address. The Client registers the `main.workbench` occupant and listens for explicit Mantur mode selections. The layout keeps the conversation mounted beside the editor; it does not copy editor state into the harness. Disposing the plugin removes its listener and closes the workbench. No invariant companion is published because this package owns presentation and configuration, with no independent runtime observations to compare.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Layout](../ui-layout/README.md) — conversation and workbench composition.
- [Mantur navigation](../ui-mantur-navigation/README.md) — creation mode selection.
- [MCP client](../../mcp/mcp-client/README.md) — separately configured editing tools.

-----

<a id="model-experience"></a>
## Model Experience

None, as opening the workbench adds no model context, tools, or requests. A separately configured MCP client owns tool discovery and execution.

#### KV Cache effect

Workbench viewing state contributes no provider tokens.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- This plugin does not start, package, or authenticate the editor server. The deployment must provide that process and configure MCP separately; transport credentials never belong in `editorUrl`.
- Closing or reloading recreates the editor page. The editor owns saved projects and any unsaved-change behavior. Workbench visibility resets on page reload.
- The embedded upstream editor retains its own proposal review controls. Multi-project agent binding and native Windows packaging require separate verification.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
