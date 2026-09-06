---
description: "The workspace group map: the persistent workspace entity family, durable directory records, and header-validated session membership, for users and maintainers navigating the group."
kind: "package-group"
---

# packages/workspace

English | [中文](README.zh.md)

## Summary

The workspace group provides the durable project list behind a host UI. `workspace` registers user directories and groups their sessions; `mantur-projects` prepares a directory on first send with a durable retry identity. A UI can remove a project registration without deleting its folder or session histories. These Host packages register no tools, prompts, or session events.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`workspace`](workspace/README.md) | Provides named, ordered projects with the sessions that ran in each directory | `ctx.workspaceRegistry` |
| [`mantur-projects`](mantur-projects/README.md) | Prepares first-send project directories and retains their identities across retries | `ctx.manturProjects` |

-----

<a id="related-documentation"></a>
## Related documentation

- [Workspace subsystem](../../docs/subsystems/workspace.md) — the authoritative feature contract for projects and their sessions.
- [domain KV storage Agent Note](../../.agents/notes/proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.md) — the storage design behind project records.
- [Workspace UI product-flow Agent Note](../../.agents/notes/implemented/feature/2026-07-25-workspace-ui-product-flow.md) — how the first start builds projects from session history and how the GUI orders them.
- [Workspace registration deletion decision](../../.agents/notes/implemented/feature/2026-07-27-workspace-registration-deletion.md) — why removing a project never deletes its folder or sessions.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
