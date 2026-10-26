# Agent Note: Preserve the selected draft when using a marketplace Skill

Status: implemented

English | [中文](2026-10-26-preserve-marketplace-skill-drafts.zh.md)

## Problem

Creating a new Session for a marketplace Skill leaves the selected Session’s unsent text, references and attachments behind. Immediate insertion can also fail while native restoration holds the draft lock, even though the Skill is installed.

## Decision

Skill use appends a structured reference to the selected Session’s resident editor, including Sessions with history, or to the unassigned draft when no Session is selected. It waits for native restoration and revalidates the selected editor before appending. It neither creates a Session nor sends a message. Restoration failure or changed editor ownership prevents insertion; a superseded operation cannot publish an error over a newer request.

This partially supersedes the new-Session branch of [Marketplace Skill drafts](2026-10-22-marketplace-skill-drafts.md). That note remains active for unassigned drafting, structured references and installation-state presentation. The [desktop checkpoint decision](../architecture/2026-09-06-desktop-draft-checkpoints.md) retains ownership of durable documents and restoration locks; it is not superseded.

The navigation plugin cannot safely infer readiness from synchronous insertion failure. The shared Conversation interfaces therefore expose the existing restoration promises through `SessionInputResolver.waitForDraft(id)` and `ConversationDrafts.waitForDraft()`. The shared files are [contract/input.ts](../../../../packages/client/ui-conversation/src/client/contract/input.ts), [contract/draft.ts](../../../../packages/client/ui-conversation/src/client/contract/draft.ts) and [input/draft.ts](../../../../packages/client/ui-conversation/src/client/input/draft.ts); the Session implementation already owns its promise. Agent-loop and session-log formats are unchanged.

## Alternatives considered

**Create a fresh Session and copy selected fields.** This changes conversation context and risks omitting editor metadata or attachments. Appending to the resident document preserves its complete contents and ownership.

**Retry insertion on a timer.** A false return can mean a lock or another refusal. Waiting for the owning restoration result preserves explicit failures without polling or indefinite retries.

## Consequences

Text, existing references and attachments remain in their original draft. Identical references remain idempotent. Failed native restoration leaves the stored checkpoint intact and does not fall back to an empty draft. Marketplace selection alone has no model-visible effect.

The [restore-lock regression](../../../../packages/client/ui-mantur-navigation/tests/skill-draft-restoration.client.spec.ts) uses the real editor and persistence owner to demonstrate the synchronous failure and first-click success with text, three old references and an attachment. Controller tests cover selection changes, replaced bindings, disposal and overlapping requests. The [automatic-project browser scenario](../../../../apps/web/tests/mantur-automatic-project.expected.e2e.ts) verifies unassigned and historical Session drafts through the real application composition without a real model. These are the upgrade checks for the shared API change; packaged desktop GUI retesting remains a release handoff.
