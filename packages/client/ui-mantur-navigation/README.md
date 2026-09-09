---
description: "Mantur-only sidebar navigation, Skill Marketplace, and Recipe Marketplace presentation for the desktop client."
kind: "package-reference"
---

# `@deepseek-ai/dsh-client-ui-mantur-navigation`

English | [中文](README.zh.md)

## Summary

This plugin adds the Mantur sidebar's Skill Marketplace and Recipe Marketplace entries and their independent root pages. The Skill page reads a Host-projected ManturHub catalog, opens details, gates installation on device login, and displays installation and local-conflict states. A Recipe means a proven creative example that can be reproduced with replaced user content; it is not a general workflow template. The package also provides creation-mode recommendations and the 馒头仔 assistant guide, and replaces the grouped workspace heading with Projects. The official Web composition does not load this package and keeps Workspaces unchanged.

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

Compose this package only through [`dsh-mantur-app`](../../bundle/mantur-app/README.md). The package fills `sidebar.navigation`, `sidebar.workspaces.heading`, and `main.page` after their owners declare them, then mounts the browser-safe marketplace Remote. Opening the Skill page loads the public catalog and local installation flags. Selecting a card loads its detail; an authenticated install writes through the Host service and updates the visible card only after Host confirmation. An installed Skill exposes “Use skill”; the action creates a default-named Session in the current Project, opens it, and seeds the unsent composer draft with `/<skill-slug>` so the user can add the task before submitting. Page selection belongs to the layout's transient store, so every reload starts on the current conversation and keeps no marketplace route on disk.

Signed-out Skill details in the marketplace and creation guide select login through the Host's explicit identity mode. Desktop-managed mode requests the shared [native account dialog](../ui-mantur-account/README.md); standalone mode uses ManturHub device login. Identity lookup failure or an unavailable dialog reports an error without switching credential sources. While login starts, the source detail is hidden but retained. Return, Escape, Skip and success restore it without changing the source page, project, Session or complete draft. Success updates the sign-in display only; installation, Skill insertion and sending require another explicit action.

When login ends, the requesting detail restores keyboard focus to its current enabled primary action. A changed detail or Session, a hidden or removed source, and another active modal prevent restoration. Focusing never activates the button.

The Recipe page loads the public ManturHub catalog with server-side text and category filters, renders result samples and pagination, and opens an inline detail with replaceable inputs, prompt template, models, operators, and the authoritative reproduction guide. The Recipe itself is free; operator execution uses a real-time quote confirmed before work starts. “Recreate with Agent” creates a new Session in the current Project and submits the Hub-provided `agent_payload` with the Recipe slug and ManturHub marker as its first user message. The message includes the source URL only when ManturHub publishes one. Both marketplaces use the deployment selected by the Host's machine-local configuration.

The conversation home offers Script writing, Drama production, and Asset production. Validation explicitly resolves the retired `editing` preference to `production` without changing workbench visibility; unknown values are rejected. The Host-backed `ui-mantur-guide` settings remember the last mode and an explicit guide dismissal; the first mode is `script`. Modes change recommendations and fixed guidance only: workspace, draft, attachments, selected Skills, model, permissions, and Agent identity remain unchanged. The required `recommendations` configuration supplies ordered real Skill slugs for each mode; only entries returned by the current Host catalog appear. Missing entries are omitted, and failed catalog reads expose Retry. An installed shortcut appends a titled `/skill` reference and focuses the current composer without sending or duplicating an existing reference. Uninstalled shortcuts show a brief installation confirmation, without the description or introduction, and insert only after “Install and use” succeeds. Closing that confirmation, switching Sessions, or leaving for a marketplace page invalidates its pending insertion before navigation; returning does not restore it. More skills uses the same current-composer actions; the marketplace's separate Use action still creates a Session.

Recommendation buttons and their inserted references use the same curated locale-owned label of at most four Chinese characters. Tooltips retain the full catalog title; reference IDs and slash commands retain the original slug. Every configured recommendation needs a maintained label mapping; a missing mapping exposes a configuration warning. More skills keeps full list titles and uses the original catalog title for an inserted Skill that has no curated mapping, without truncating or inventing a name.

The home workspace picker remains in a left-aligned footer below the input card. The permission selector sits above the editor inside that card, through the composer's accessory child slot. Conversation owns permission state and commands. DOM order matches keyboard order; the resident editor, workspace control, draft transfer, and official composition retain their existing behavior.

Skill shortcuts use 40px-high buttons with a 1px border. The single-line rail supports native trackpad and keyboard scrolling without a visible scrollbar. Edge arrows and fades appear only when the contents exceed the available width; arrows scroll one visible rail width and disable at the corresponding end.

Without a selected project, the desktop restores a native unassigned draft and accepts text, images, and titled Skills. Settings → General shows the default project location and opens the native directory picker; changes affect only unreserved creations and never move existing projects. The home footer keeps the existing project picker and shows only preparation progress or an actionable error. First send prepares a project through [mantur-projects](../../workspace/mantur-projects/README.md), transfers the complete draft, and submits through the ordinary Session input. Failed creation retains the same durable identity for retry; missing native persistence blocks creation explicitly.

馒头仔 uses fixed localized copy and approved transparent artwork shipped in the Web assets. Each creation mode selects its matching 184×120 peeking illustration, with the artwork's y=104 contact line aligned to the input card. Its fixed-position bubble sits above/right of the mascot without adding a layout row; opening, closing, or changing mode keeps the shortcut row and input card stationary. When the gap below the mode tabs clips the body, the bubble moves beside the tabs if at least 180px of width remains. Otherwise it scrolls within that gap. Both placements keep the original text size, visible close button, and 8px separation above the mascot. The close button and Escape persist dismissal; a mode change does not reopen a closed guide. The mascot and its guide render only on the conversation home; active conversations contain neither. An installation completed after switching Sessions does not insert into either conversation.

-----

Below 820px viewport width, the hero recommendation row reserves 40px of additional vertical space for a readable scroll area below the tabs. The same space remains while the guide is closed, so toggling it does not move the input card or workspace footer.

An accepted explicit mode selection emits `mantur/creation-mode-selected`, including a repeated selection of the active mode. A failed save or settings hydration emits nothing. The editing workbench opens and closes only through its boundary control; mode selection does not change its visibility.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The browser plugin installs navigation, Projects-heading, root-page, creation-mode, composer-layout, composer-guide, and General-settings occupants with one root-scoped marketplace controller. The controller owns separate Skill and Recipe catalog and detail snapshots while generated Remotes keep credentials and filesystem access on the Host. Its settled Skill catalog and current Recipe query, page, and result remain in memory for the controller lifetime, so reopening a page reuses matching state and an identical pending Recipe request is coalesced. Changing the Recipe query or page reads fresh data, and Retry always forces a new request instead of hiding a known failure behind cached data. Reloading or restarting the client creates a cold controller with no persisted catalog. Marketplace Skill launch resolves the current Workspace through the existing controllers, creates a Session, writes the slash command through that Session's input facade, and opens it without submitting. Recipe launch follows the same Workspace and Session controllers but sends the reproduction request through the scoped Conversation service. The navigation writes the selected branded page identifier to the layout store; the root-page occupant renders the matching page and closes it through the owner action. When an active root-page occupant unmounts during plugin disposal or replacement, it also clears its page identifier so the conversation becomes visible. Disposing the plugin invalidates pending state changes, clears login polling, and removes its occupants and locale dictionaries.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages own the shared extension points and the Mantur composition.

- [ui-layout](../ui-layout/README.md) — transient root-page state and the `main.page` seat.
- [ui-sidebar](../ui-sidebar/README.md) — navigation and workspace seats.
- [mantur-app](../../bundle/mantur-app/README.md) — the product composition that mounts this package.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package contributes no hidden model context. A selected Skill remains an unsent slash-command draft until the user submits it. A selected Recipe instead becomes an ordinary durable first user message. Its trace lines use the active UI language and contain the title, slug, ManturHub marker, and any source URL published by ManturHub; the following `agent_payload` remains exactly as published.

#### KV Cache effect

The Skill draft contributes no provider tokens until the user submits it. The Recipe message contributes ordinary user-prompt tokens once. Navigation, catalog cards, detail metadata, and other UI copy do not enter provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Native desktop updates appear above Settings only when active or actionable, including the collapsed rail. Browser builds expose no installer. Downloads require an explicit click; restart confirmation and save failures remain owned by the native controller. Installation is blocked pending a verified final Host checkpoint.
- Recipe discovery and handoff are available. Operator execution, quote confirmation, and payment continue inside the Agent and ManturHub capabilities rather than this presentation package.
- The Skill page supports installation but intentionally provides no forced overwrite or uninstall action. A tracked directory modified after installation and any pre-existing untracked directory require manual resolution.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. Component and store tests cover catalog loading, empty and failed responses, detail selection, signed-in installation, device login, conflicts, and disposal-owned polling; Host integration tests own filesystem and credential safety.
