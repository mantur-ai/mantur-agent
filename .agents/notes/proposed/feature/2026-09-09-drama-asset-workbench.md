# Agent Note: Keep the drama asset workbench isolated until source and receipt adapters exist

Status: proposed

English | [中文](2026-09-09-drama-asset-workbench.zh.md)

## Problem

A media workbench can misrepresent edited prompts as the requests that produced existing media. The current Skill also lacks a single transactional asset/Clip editing service, while a session prompt acknowledgement does not identify completed edits.

## Proposal

Validate a browser-only workbench in [the isolated prototype](../../../../prototypes/drama-asset-workbench/README.md). Keep compiler output, next-revision text and submitted generation records separate. Use stable IDs, source-version comparison, correlated per-item proposals and explicit approval before applying text. Source and local-draft conflicts retain the user's draft. Failed-item retries exclude applied targets.

Production integration uses the additive shell.overlay slot and the existing main session. It requires a project manifest adapter, atomic source updates, correlated result events and existing Base readback. A controlled Worker proves the isolated interaction protocol only; it is not a model or production pipeline. Preview and draft editing remain independent of login.

## Alternatives considered

**Replace the conversation or details single slot.** This would remove occupied client functionality. An additive overlay preserves existing panels.

**Treat prompt acceptance as completed editing.** Acceptance only admits inbox content. Per-item proposals and applied-version receipts distinguish delivery, execution and mutation.

**Rewrite actual requests after text edits.** This would falsify media history and price approval. Text revisions invalidate future approval without changing submitted requests or deleting media.

## Acceptance criteria

The isolated fixture demonstrates image/video inspection, exact selection scope, draft preservation, partial failure, retry exclusion, optimistic conflicts and readback. Production admission additionally requires verified response schemas, approved project samples, a safe media adapter, main-session result correlation and keyless session snapshots.

## Risks

Browser fixture storage is not a production fact source. The controlled Worker ends when its page unloads; accepted records must not be reported as successful after that interruption. Source and Base synchronization and real model execution remain unverified. No existing Agent Note is superseded by this separate feature proposal.
