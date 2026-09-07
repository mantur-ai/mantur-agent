---
description: "Create a Mantur project on first send, retain its directory across retries, and select the root for future projects."
kind: "package-reference"
---

# @deepseek-ai/dsh-mantur-projects

English | [中文](README.zh.md)

## Summary

Users can begin a draft before choosing a project. The first send prepares one project directory, and retries reuse its recorded creation identity. Changing the root affects future projects only. Reading settings creates neither directories nor Workspaces.

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

The [Mantur bundle](../../bundle/mantur-app/README.md) mounts this plugin beside the Workspace registry and durable storage. Its desktop carrier supplies the operating system's Documents directory with a `漫途项目` child; a deployment without that default requires an explicit root selection. The creation caller supplies the initial localized project title.

| Field | Default | Meaning |
|---|---|---|
| `defaultRoot` | absent | Absolute project root until the user selects another location |

The [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-mantur-projects) lists accepted configuration fields. The client exposes the selected location before sending; choosing a location saves the setting without creating a project.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The `mantur_projects` storage domain records the selected root and each creation's reserved path before directory creation. Exclusive creation refuses existing paths. After recording ownership, each retry verifies that the directory still exists and is not a symlink, then adopts it through the Workspace registry. The returned Session id derives from the creation UUID; the client uses the ordinary Session controller to create, transfer the complete draft, and send.

Concurrent calls sharing a UUID join one operation. Host disposal drains those operations before closing storage. The [creation controller](src/index.ts) owns filesystem operations, while [domain schemas](src/spec.ts) validate durable records. Creation intents are not a live filesystem projection; no runtime invariant companion is published. Each preparation validates the current directory, and the Workspace registry owns its independent membership checks.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Workspace registry](../workspace/README.md) — directory identity and Session membership.
- [Conversation](../../client/ui-conversation/README.md) — complete draft transfer and ordinary submission.
- [Automatic-project decision](../../../.agents/notes/implemented/feature/2026-09-06-mantur-automatic-project.md) — persistence, cancellation, and recovery choices.

-----

<a id="model-experience"></a>
## Model Experience

None, as this Host plugin creates project directories and returns identities without creating a Session, appending a message, or registering model-facing content.

#### KV Cache effect

None; the ordinary Session composition owns requests for the resulting working directory.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- A crash between directory creation and its ownership receipt can leave a reserved directory whose ownership is uncertain. Retry refuses it; the user can explicitly select that directory. The plugin never adopts or deletes it automatically.
- Moving, deleting, or replacing an owned directory causes an explicit error. Root changes do not relocate an existing reservation, and the plugin never creates a replacement project silently.
- This plugin does not persist browser drafts or accept prompts. Automatic first-send requires the desktop draft checkpoint and the Mantur client policy; unavailable native persistence blocks creation before any Host entity is written.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
