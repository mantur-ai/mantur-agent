# Agent Note: Versioned script selection workbench

Status: proposed

English | [中文](2026-09-09-script-workbench.zh.md)

## Problem

Writers need to review and manually edit generated episodes while requesting targeted changes from the existing Agent. A selected string alone cannot distinguish repeated dialogue or protect a draft that changes while a request is queued. The occupied single workbench slot also cannot accept a second independent panel without an owner deciding which content it renders.

## Proposal

Keep one text file per episode. A private plugin owns episode discovery, draft revisions, exact UTF-16 selections and full-file versions. Submit ordinary user messages to the current scoped conversation. File writes validate the request and baseline at their commit point, retain recovery data, and publish completion only after file readback. The [isolated prototype](../../../../prototypes/script-workbench/README.md) exercises this interaction with synthetic files and a controlled adapter; it is not mounted in a DSH profile.

Coordinate a minimal script/editing content choice with the existing workbench owner. Reuse its visibility and live-opening suppression, preserving the independent [details lifecycle](../../implemented/bug-fix/2026-07-29-web-details-session-lifecycle.md). The new feature does not supersede that decision. No active script-workbench decision was found in the scoped supersession audit.

## Alternatives considered

**Copy a complete screenplay application.** Rejected because native application integration and unresolved component licensing exceed this text-editing need.

**Send only selected text through the composer.** Rejected because duplicate text and concurrent file changes cannot be resolved safely from that payload.

**Treat prompt admission as completion.** Rejected because queued messages have no per-message completion guarantee and may fail or be cancelled before any file change.

## Acceptance criteria

Boot the eventual plugin through the Loader in an isolated profile, replay its logged user input, and verify that a controlled main Agent modifies only the selected occurrence. Exercise competing manual/file edits, persistent restoration, cancellation, failure and panel collapse. A production writer must enforce these checks across every competing write path. Real model execution requires separately authorized credentials and spending.

## Risks

The browser prototype detects stale baselines but cannot atomically exclude arbitrary external filesystem writers. Its drafts and history survive panel collapse only within the page lifetime. Its session sender is an unmounted integration candidate; it does not prove real main-Agent execution. The newer editing baseline has single workbench slots already occupied, so mounting a competing registrant is prohibited until the owner supplies content selection.
