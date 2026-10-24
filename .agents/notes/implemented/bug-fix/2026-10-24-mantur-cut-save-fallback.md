# Agent Note: Keep failed server project saves retryable

Status: implemented

English | [中文](2026-10-24-mantur-cut-save-fallback.zh.md)

## Problem

A browser cache write cannot confirm that a server or desktop project was saved. Treating a temporarily unavailable shared store as local-only storage lets a retry report success without updating the authoritative project, allowing the editor to discard its dirty state and return to the project list. This failure under injected transport faults does not establish the cause of a historical user incident.

## Decision

The maintained [Cut shutdown patch](../../../../packages/client/ui-mantur-editing/adapters/mantur-cut-shutdown.patch) selects project persistence from the configured backend or available HTTP/desktop transport, independently of remote-cache initialization. Project writes through a remote transport require an accepted project-document response. A failed bootstrap or write does not authorize a local-only project save; subsequent attempts retry the same authoritative store. Save errors retain unsaved edits and block the save-before-leaving operation.

Standalone storage without a remote transport and explicitly configured local backends retain their existing behavior. Local recovery data and pending entries remain available; they are not server acknowledgements. Ownership, revision and epoch checks remain enforced. The [save-base decision](2026-10-24-mantur-cut-persisted-save-base.md) and [offline checkpoint decision](2026-10-24-mantur-cut-offline-checkpoint.md) continue to govern acknowledged revisions and draft recovery independently.

The [desktop source configuration](../../../../apps/desktop/mantur-cut/source.json) pins the maintained patch digest and resulting tree. This change stays in the editor adapter and requires no Harness core modification.

## Alternatives considered

**Keep local success after a transport failure.** This preserves the upstream offline-write expectation but misrepresents the save destination for a server-bound project and permits leaving with an unchanged authoritative document.

**Disable all local storage.** Standalone local projects do not depend on server acknowledgement, and recovery data remains useful after a failed remote operation.

## Consequences

Server-bound projects require the service to become available before saving can succeed. Retry preserves the acknowledged base rather than adopting another writer's revision. A successful browser-cache write cannot release the dirty state or navigation guard.

Verification uses isolated real HTTP and filesystem storage for repeated 503 and disconnection failures, service recovery and durable reopen, and owner rejection without local success. Local-only compatibility and the existing dirty-reconnect and offline regressions remain required. Recorded-session and packaged GUI acceptance must run against the repaired source separately; these source checks do not approve a release.
