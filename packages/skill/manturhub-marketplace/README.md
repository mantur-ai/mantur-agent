---
description: "Host-owned ManturHub Skill and Recipe catalog projection with safe local Skill installation."
kind: "package-reference"
---

# `@deepseek-ai/dsh-manturhub-marketplace`

English | [中文](README.zh.md)

Installed-skill switches are stored in `manturhub-marketplace/skill-preferences.json` under the active Harness home. A disabled name is blocked in registry loading and exact bundled-reference loading, across versions. The installed list reads local discovery and packaged manifests without network access; toggling does not delete resources or change historical messages.

## Summary

This Host plugin exposes browser-safe ManturHub Skill and Recipe catalog and detail Remotes plus Skill installation. Public metadata is validated before projection. Recipe media and non-empty source paths resolve against the configured Hub response origin; empty source fields are omitted from the browser result. Installation downloads public bundles and approved redirects without credentials, verifies archive limits and root metadata, and atomically commits the Skill directory with installer state.

Recipe detail preserves the published input schema and ordered operator steps, including null step notes.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand installation safety](#understand-installation-safety)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Compose this package through [`dsh-mantur-app`](../../bundle/mantur-app/README.md). It requires `manturAccount`, so public Skill and Recipe catalog reads, details, and public downloads always use the account service's active production or test origin. It installs Skills into `<DSH_HOME>/skills/<slug>`. Recipe list reads are fixed at the Hub-supported 15 entries per page and accept page, category, tag, and text filters. Configuration bounds metadata bytes, compressed bytes, archive entries, uncompressed bytes, and both request stages. The defaults match the official ManturHub CLI policy.

Public discovery uses `/api/public/agent/v1/skills` and `/api/public/agent/v1/recipes` with the gateway `code: 0` and `data` envelope. Skill pagination must be complete and contain unique codes; incomplete pages and unsuccessful gateway responses fail visibly. Recipe requests use `pageNum`, `pageSize`, `category`, `tag`, and `keyword`. Gateway timestamps may omit a timezone and are retained without inventing one. Missing prices, author and copy counts remain null; absent production instructions disable recipe launch in the client.

The `bundledSkillDir` manifest retains packaged identities for exact references. Optional `bundledUpdateNames` selects which packaged names receive online checks; omission checks all entries, and a configured name missing from the manifest rejects before network access. The Mantur profile retains `short-drama` resources for old drafts but excludes that name from updates and recommends `overseas-comic-script-studio`. `updateBundled` checks the active deployment and downloads releases into `<DSH_HOME>/manturhub-marketplace/bundled-updates/<name>@<version>`, outside user Skill directories. Archive SHA-256, extraction limits, file inventory and instructions must pass verification before atomic publication. `updateBundled` returns available `skills` separately from per-item `updates`. Each update is `verified` or `failed`; failures retain the Skill name, metadata/download/verification stage and error. A 404, network failure or invalid update does not stop checks for other entries. A failed update can return its packaged Skill only after full local verification; an invalid packaged copy is excluded and reported through `localError`. These available packaged versions are not reported as current online releases. Cancellation and invalid application manifests still reject the request. Cached releases remain available for exact references and are not automatically removed.

Name, version and content digest identify a selected bundle. Draft serialization and instruction injection verify that exact identity offline against application resources or the update store; neither operation replaces a captured reference with a newer release.

-----

<a id="understand-installation-safety"></a>
## Understand installation safety

The first download request uses the public Skill `/bundle` endpoint through `manturAccount` without authentication and with manual redirects. A redirect must include `Location`; its second request allows HTTPS, plus loopback HTTP for integration tests, and never receives the authorization header. The installer streams into a private temporary file and rejects compressed-size overflow before extraction.

The ZIP reader validates every central-directory entry before it writes that entry. It rejects unsafe or imprecise sizes, absolute and traversal paths, control characters, Windows-reserved names and characters, trailing dots or spaces, case-insensitive duplicate paths, links, special nodes, excessive entries, and excessive declared expansion. Regular files are decompressed directly into private staging files while the installer enforces the actual cumulative byte limit. A second filesystem walk rechecks links, special nodes, and actual expansion. Root `SKILL.md` must declare the requested slug and catalog version.

Installer state stores content and bundle SHA-256 values outside the discoverable Skill root. An update proceeds only when the destination is tracked and its current content hash still matches. Untracked or locally modified destinations fail visibly. Directory and state replacement use same-filesystem renames. Before replacement, the previous directory moves into a unique recovery directory beside `skillsRoot`, never inside the discoverable Skill tree. A state-write failure restores that directory. If rollback itself fails, the error reports the exact preserved recovery path for manual restoration.

-----

<a id="further-exploration"></a>
## Further Exploration

- [authorization-manturhub](../../credentials/authorization-manturhub/README.md) — owns API origin, credentials, and device login.
- [ui-mantur-navigation](../../client/ui-mantur-navigation/README.md) — presents the projected catalog and installation states.
- [skill-filesystem](../skill-filesystem/README.md) — watches the live local Skill directory.

-----

<a id="model-experience"></a>
## Model Experience

### Explicit App Skill invocation

#### What the model sees

A direct user `/mantur-builtin:<name>@<version>#<digest>` reference injects verified instructions using the existing [`skill_content` rendering](../skill/README.md). The durable `skill-invocation` source includes `bundled.version` and `bundled.digest`; injected instructions cannot themselves trigger another user gesture. Ordinary `/name` and model-selected Skills keep registry resolution.

#### Token effect

Each selected App Skill adds its complete instruction body once per claimed user message batch. Homepage discovery and reference selection alone add no model context.

#### KV Cache effect

The verified body is appended as durable instructions. Earlier history remains intact; selecting another App version adds different instructions only through a new explicit reference. A missing version is rejected rather than replaced during a running request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- There is no forced overwrite, uninstall, or local-conflict merge operation.
- Environment switching isolates remote catalog data, downloads, and grants. The live local Skill directory and installer state remain shared, so an installed Skill stays available after a switch and normal version/conflict checks still apply.
- Skill bundles must use ZIP. Extraction is implemented in-process and does not depend on platform archive commands.
- Recipe handoff, operator execution, quote confirmation, and payment are outside this Host package; it returns published `usage` as the reproduction instructions and leaves missing instructions empty.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Host tests use real loopback HTTP servers and temporary `DSH_HOME` directories. Metadata buffering uses the bounded JSON reader owned by [`authorization-manturhub`](../../credentials/authorization-manturhub/README.md). The tests prove deployed response envelopes, credential isolation, archive policy, local-conflict refusal, rollback, and live filesystem watcher invalidation.

</details>

**Runtime invariant:** No companion is published. API validation, archive inspection, post-extraction inspection, metadata validation, content hashing, and atomic rollback reject each independently observable invalid installation state.

The asset recommendation uses `mantur-preroll-remix-studio` with the homepage label 短剧素材智能剪辑. Its predecessor `mantur-smartclip` retains packaged resources and old references but receives no default update checks. Both replacement Skills require the embedded CLI 1.2.10, pinned to its official npm archive with verified digest and locked dependencies; local broker tests verify the desktop identity transport.
