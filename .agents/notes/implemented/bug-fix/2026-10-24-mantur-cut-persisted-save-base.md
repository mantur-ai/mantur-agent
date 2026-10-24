# Agent Note: Reconnect editor saves from the acknowledged revision

Status: implemented

English | [中文](2026-10-24-mantur-cut-persisted-save-base.zh.md)

## Problem

A dirty editor document has a different revision from its saved document. Registering that dirty revision after a bridge disconnect makes the server reject the registration as stale, even when no other editor has changed the project. Clearing the local document or adopting the latest server revision would risk losing or overwriting work. This conditional defect does not establish the cause of every observed save or import failure.

## Decision

The maintained [editor shutdown patch](../../../../packages/client/ui-mantur-editing/adapters/mantur-cut-shutdown.patch) separates the acknowledged persistence revision from the current editing document. Accepting a loaded project establishes the persistence revision; accepted save acknowledgements advance it. Clearing connection ownership preserves that revision and the dirty document. Editor-context identity and registration capabilities prevent obsolete loads, registrations, acknowledgements and cleanup from changing a replacement context. Registration uses the acknowledged revision, while editing-tool validation retains the current document revision.

The server compares the expected revision with the stored document while holding the project-store lock. Ownership identity and epoch checks remain required. A different browser cannot take an active browser lease; release or expiry permits a new claim only against the caller's known persistence revision. A stale response never authorizes adopting the server's revision and overwriting its document. Failed saves continue to prevent leaving the editor.

The [desktop source configuration](../../../../apps/desktop/mantur-cut/source.json) pins the patch and resulting tree. No harness core package changes are required. The [shutdown decision](2026-09-08-mantur-editing-owned-shutdown.md) and [tool-result revision decision](2026-09-09-mantur-editor-result-revision.md) retain their independent drain and completion guarantees.

## Alternatives considered

**Register the current in-memory revision.** Unsaved edits are not evidence of the server's persisted document, so this rejects a recoverable disconnect.

**Fetch the latest server revision and retry the dirty save.** That treats another editor's write as permission to overwrite it.

**Remove revision or ownership checks.** Serialized disk writes alone do not establish that a caller edited the document it is replacing. Allowing active browser takeover also permits competing editors to repeatedly invalidate each other.

## Consequences

Reconnect can retain unsaved work when the persisted base still matches. Conflicts preserve the local draft and require deliberate recovery; they are not automatic merges. Missing acknowledgements remain uncertain outcomes, and a full page reload does not reconstruct an in-memory draft.

Verification requires real loopback HTTP routes and isolated filesystem storage for dirty reconnect/save/reopen, acknowledged base advancement, stale saves and competing owners. Source verification does not establish packaged desktop acceptance or diagnose a historical failure without its request and response evidence. Fresh candidate packaging and installed-client save/reopen checks remain separate release requirements.

The repository-required recorded-session scenario remains pending; the owner-local HTTP assertions do not replace it.
