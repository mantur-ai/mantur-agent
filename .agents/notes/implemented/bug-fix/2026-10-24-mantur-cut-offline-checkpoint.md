# Agent Note: Preserve original documents in offline edit checkpoints

Status: implemented

English | [中文](2026-10-24-mantur-cut-offline-checkpoint.zh.md)

## Problem

An offline edit checkpoint contains both the original project and an editable draft. Reconstructing its persisted fields without the original document loses independent evidence of the draft's base, even when revision-matched project storage permits ordinary recovery.

## Decision

The maintained [Cut shutdown patch](../../../../packages/client/ui-mantur-editing/adapters/mantur-cut-shutdown.patch) validates a supplied `baseDoc` through the existing project migrations, requires its normalized revision to equal the checkpoint base revision, and retains it on save and load. Null, malformed and revision-mismatched originals invalidate the checkpoint. An omitted original remains valid for older v1 checkpoints; restoration uses the revision-matched stored project in that case. Invalid persisted checkpoints cannot be overwritten by a new checkpoint.

The [desktop source configuration](../../../../apps/desktop/mantur-cut/source.json) pins the patch digest and resulting tree. This adapter change requires no Harness core modification. The [persisted save-base decision](2026-10-24-mantur-cut-persisted-save-base.md) independently governs browser reconnect ownership and acknowledged revisions; this decision does not supersede it.

## Alternatives considered

**Remove the producer's original document.** That hides serialization loss and removes recovery evidence from every newly created checkpoint.

**Accept an unchecked original or replace its revision.** That permits a checkpoint to claim an original different from its declared editing base.

**Require originals for all v1 checkpoints.** The optional field already permits older checkpoints without it. Rejecting those files is unnecessary when the stored project still matches their base revision.

## Consequences

Checkpoints retain the normalized original document in addition to the draft. Project migration remains the validator and normalizer, so revision comparison uses the migrated document. Corrupt evidence remains on disk for deliberate recovery rather than being silently discarded.

The production-contract verification command includes real-file roundtrip and fresh-process recovery checks, migration normalization, omitted originals, and invalid-original rejection on save and load. The existing offline store ownership assertions remain required. Recorded-session and packaged GUI acceptance remain separate release requirements; source tests do not establish them.
