# Agent Note: Mantur marketplace navigation

Status: implemented

English | [中文](2026-09-03-mantur-marketplace-navigation.zh.md)

## Problem

Mantur Agent needs product-only Skill Marketplace and Recipe Marketplace entry points above its project browser. The official Web client must keep its Workspace terminology and conversation-first start, while the marketplace MVP needs an independent center surface without pretending a click-through overlay is a page.

## Decision

`ui-layout` owns a transient branded `MainPageId | undefined` in its root-entry store and declares the single root-scoped `main.page` slot. An active page hides but does not unmount the conversation surface, renders details at zero width without changing its stored preference, and receives a close action that restores the current conversation. The store has no persistence, so reload always starts on the conversation.

`ui-sidebar` declares `sidebar.navigation` before `sidebar.workspaces` and passes the active page plus open and close actions to its occupant. Starting a new session closes the page first. The workspace browser receives the same return action and uses it before opening, starting, or forking a Session. An active Mantur root-page occupant also invokes the close action when plugin disposal or replacement unmounts it, so the transient layout store cannot retain an identifier whose renderer has disappeared.

`ui-workspace` declares the nested `sidebar.workspaces.heading` slot with its existing localized Workspace label as fallback. The Mantur-only `ui-mantur-navigation` package fills all three extension points: a semantically named Features navigation group, the localized Projects heading, and the independent Skill and Recipe pages. The visual navigation follows the approved layout without a visible Features heading; its accessible navigation name retains the group identity. The official profile does not compose this package.

The Skill page mounts a generated Remote and keeps catalog, detail, installation, and device-login state in one root-scoped browser controller. A new Host `manturhub-marketplace` package validates the deployed ManturHub response envelopes and projects only browser-safe metadata. The Host owns every authenticated request and filesystem operation. Installation authenticates only the first download hop, requires an explicit safe redirect for the second hop, and never forwards credentials to the bundle origin. It bounds the download, streams ZIP entries into private staging files, and rejects unsafe cross-platform paths, links, special nodes, imprecise sizes, excessive entry counts, and declared or actual expansion before each write. It rechecks the extracted filesystem, verifies root `SKILL.md` name and version, and then commits by same-filesystem rename. Tracked content hashes prevent overwriting local modifications; untracked destinations also fail. Before an update, the old Skill moves to a unique recovery directory outside the discoverable Skill root. A state-commit failure restores it, while a rollback failure preserves and reports the exact recovery path. The live Skill filesystem watcher discovers the committed rename without restarting the desktop app.

An installed Skill exposes a Use action in both its catalog card and detail. The action resolves the current Workspace through the existing controllers, creates a default-named Session, writes `/<skill-slug>` into that Session's unsent composer draft through its scoped input facade, opens the Session, and closes the marketplace page. It does not submit the command, so the user can add task text before invoking the Skill. A missing current Workspace or failed Session setup stays on the marketplace and reports an explicit recovery message.

The Recipe page reads ManturHub's public paginated catalog and detail endpoints through the existing Host marketplace Remote. The Host validates all fields, accepts published timestamps with either UTC `Z` or an explicit numeric timezone offset while rejecting timezone-less values, resolves relative media and non-empty source paths against the configured Hub response origin, omits empty source metadata from its browser result, and returns the published `agent_payload` unchanged. The browser owns search, category selection, list and detail state, and page presentation. A Recipe remains a proven creative example rather than an installable package or general workflow template.

The root-scoped controller retains the settled Skill catalog and the current Recipe query snapshot for its plugin lifetime. Page entry reuses matching state, including Recipe filters and page, and coalesces an identical pending Recipe request. Filter or page changes request fresh data. Retry calls the forced load operation, so a known failure is never hidden behind older data. The cache is memory-only; a client reload or restart remains cold.

“Recreate with Agent” creates a new Session in the current Workspace, submits one ordinary user message through the scoped Conversation service, and opens the Session after that message succeeds. The locale boundary prepares trace lines in the active UI language with the Recipe title, slug, and ManturHub marker; it adds a source URL only when ManturHub publishes one. The store appends the authoritative `agent_payload` unchanged. The model therefore sees the same instructions the publisher supplied, while the transcript retains enough provenance to audit the handoff without inventing missing metadata. Recipe discovery stays public. The UI does not request login because these endpoints do not require it, and it does not report operator execution as started merely because the Session accepted the message.

## Alternatives considered

**Hardcode Mantur terminology and links in `ui-sidebar`.** This would leak deployment copy into the official shell and make every product-specific destination part of a shared package, so the product package owns the occupants instead.

**Render marketplace pages in `shell.overlay`.** That slot is a click-through floating layer and leaves the conversation reachable behind it. Treating it as primary navigation would give the wrong accessibility and layout behavior.

**Persist the selected marketplace route.** The requested default is the current conversation after every reload. Keeping selection in the existing transient layout store meets that behavior without a second route store.

**Persist marketplace catalogs to disk.** The requested delay occurs when switching pages within one client run. Disk persistence would add expiration, schema migration, and stale-data behavior without solving a demonstrated offline requirement, so the controller keeps only session memory.

**Cache every Recipe query.** Arbitrary text searches would grow controller memory without a demonstrated need. Retaining only the current query removes the re-entry request while keeping memory bounded.

**Download and extract in the browser.** This would expose authorization and filesystem mutation to presentation code. Generated Remotes instead keep both on the Host and return only explicit success or typed failure.

**Overwrite an existing directory or add a force option.** The browser cannot establish whether local content is disposable. Installer-owned hashes permit updates only for unchanged tracked content and surface every other case as a conflict.

**Install Recipes as local packages.** ManturHub publishes Recipes as live cases whose reproduction instructions may change. Keeping the payload in the durable user message preserves the exact handoff while the payload itself directs Agent to fetch current structured parameters when needed.

**Store Recipe context outside the transcript.** A browser-only route parameter or hidden in-memory field would disappear on reload and violate the model-visible/logged rule. An ordinary user message uses the established Session admission path and remains visible to both user and model.

## Consequences

The shared client gains two generic extension points and one transient page selector, while Mantur copy and page structure remain isolated in product packages. Only one root-page occupant can be composed at a time. Skill catalog reads, safe installation, and unsent draft handoff are available in the Mantur profile. Re-entering either marketplace avoids a matching catalog request during the same controller lifetime, and the Recipe page restores its current filters and page. Only the current Recipe query is retained, and reload remains cold. Recipe discovery and durable Agent handoff are also available, but operator execution, quote confirmation, and payment remain owned by Agent and ManturHub after the handoff. Forced overwrite, uninstall, and route persistence remain absent.
