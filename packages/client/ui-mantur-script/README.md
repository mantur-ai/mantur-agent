---
description: "Read and edit project scripts beside the existing Mantur conversation."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-mantur-script

English | [中文](README.zh.md)

## Summary

This Mantur plugin owns the shared workbench shell and edits existing `.md`, `.txt`, and `.fountain` files in the selected Session's project. Markdown opens in reading mode through the shared Markdown renderer; explicit source editing exposes exact text selections. Selecting a passage alone sends nothing.

## Table of Contents

- [Use this package](#use-this-package)
- [Composition](#composition)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The Mantur bundle mounts the plugin with explicit `maxBytes` and `maxEntries` bounds. Open the workbench with the conversation-edge chevron, navigate project folders, and open an episode file. One file is one editable document; the plugin does not infer episodes from headings. Reading and switching modes never write files. Save commits the current draft only against its last observed file generation.

Save a draft before selecting a passage and entering a rewrite instruction. Send selection submits a JSON user message through the captured Session's existing `conversation.send`, preserving the conversation composer and its attachments. The message includes the path, file generation, UTF-16 start/end offsets, selected text, and instruction. Admission means queued input, not successful rewriting. The Agent uses `replace_script_selection` to check the generation and exact passage before a guarded write. No second Agent, provider, credentials, or login flow is introduced.

Check file reads the current disk generation. An observed Session running-to-idle transition also requests a read; it does not attribute completion to a particular message. New disk text replaces a clean view, while a dirty draft remains intact beside an explicit conflict comparison. A changed generation invalidates the old selection. Restore previous version performs another guarded write and is disabled while a draft is dirty or conflicted.

<a id="composition"></a>
## Composition

The plugin is the sole registrant of `main.workbench` and `main.workbench.toggle`. Its editing child slots accept the optional [editing plugin](../ui-mantur-editing/README.md). The optional `main.workbench.assets.tab` and `main.workbench.assets.content` slots accept an asset contribution; the tab receives `selected` and `selectAssets`, and content receives `closeWorkbench`. The editing tab exists only while that plugin is mounted. Selecting content does not alter panel visibility. After first activation, activated content panels remain mounted across same-Session tab switches and collapse. The layout releases the panel instance on a Session switch; the registration store retains document drafts by Session and file for later remounts. Removing an optional provider leaves the script shell intact; its selected panel reports unavailability without selecting another panel.

Reads resolve through `ctx.fs` against the owning Agent's recorded working directory. Files outside that project, including escaping symlinks, are rejected. UTF-8 reads are bounded and use matching before/after versions; text is normalized to LF for textarea offsets. Every save, restore, and selected rewrite uses `replaceIfVersion` and the mounted filesystem's Session sandbox policy. No invariant companion is published because file generation checks are enforced directly by the filesystem mutation and have no independently maintained registry to compare.

<a id="model-experience"></a>
## Model Experience

### Script selection rewriting

#### What the model sees

The `replace_script_selection` tool schema and, only after explicit Send selection, a normal user message containing the path, version, UTF-16 offsets, selected text, and rewrite instruction. Calls and results use the existing durable Session pipeline. No system-prompt section is added.

#### Token effect

The tool schema contributes to request headers. Each sent selection adds its passage and request fields to conversation history; browsing, rendering, draft edits, and manual saves add no message tokens.

#### KV Cache effect

Mounting or removing the tool changes the tool-schema request prefix. Explicit selections append to the current conversation without replacing earlier history.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- Drafts and previous-version comparisons live for the browser plugin lifetime; reload recovery and a durable multi-version history are not provided. The last observed version is the available restore point. Arbitrary external processes do not participate in the filesystem provider's per-target mutex. The workbench does not create files, split a document into episodes, convert screenplay formats, or select text directly from rendered Markdown. The existing Agent can create project files through its ordinary tools. Directory listing is direct rather than recursive, and exceeding a configured bound reports an error.

<a id="dev-note"></a>
## Dev Note

The asset child slots declare composition locations only. Shipped profiles do not install an asset provider.
