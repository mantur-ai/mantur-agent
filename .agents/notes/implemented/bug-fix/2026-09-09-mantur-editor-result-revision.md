# Agent Note: Synchronize editor revisions before completing tool calls

Status: implemented

English | [中文](2026-09-09-mantur-editor-result-revision.zh.md)

## Problem

The editor result route resolved the MCP call before awaiting project revision synchronization. A continuation could enqueue the next edit against the old revision and receive a stale-session error after the first edit was saved. The route also discarded synchronization failures.

## Decision

The third [editor source patch](../../../../packages/client/ui-mantur-editing/adapters/mantur-cut-shutdown.patch) completes browser results through the broker. The broker validates the registration capability and delivered call, admits one completion, synchronizes the authoritative project revision, and only then settles the MCP result. Unowned registrations exempt only the completing call from revision-change cancellation; other outdated calls still fail.

The broker rechecks pending ownership, registration and deadline after asynchronous synchronization. The registry does not update or unregister a replacement connection. Cancellation, expiry and duplicate results cannot revive a completed call. Synchronization errors fail the pending call and HTTP result instead of reporting success; retained failures still prevent shutdown confirmation. No reconnect, mutation retry or stale-check exemption is introduced.

The [desktop source configuration](../../../../apps/desktop/mantur-cut/source.json) pins the revised third patch and resulting tree. The upstream revision and first two patches remain unchanged. New resources are built from these pins; existing frozen resources and running applications are not edited.

## Alternatives considered

**Wait after receiving success or reconnect on stale.** Neither makes the returned result truthful, and replaying an edit could duplicate mutations.

**Swap the route statements only.** This lacks exclusive completion ownership and can cancel the completing call when an unowned registration changes revision.

## Consequences

The editor's `verify:mcp` command runs a deterministic route/broker regression before its existing MCP checks. The regression blocks the real project-store queue to prove that neither MCP nor HTTP reports success before synchronization. It covers continuation binding, invalid capabilities, duplicates, cancellation, expiry, replacement registrations and a real storage failure. Source checks do not establish packaged App acceptance or real-model editing quality; isolated browser editing and the final installed-client checks remain separate requirements.
