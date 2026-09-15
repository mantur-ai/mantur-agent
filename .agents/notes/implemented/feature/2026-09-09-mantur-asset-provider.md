# Agent Note: Guarded asset provider

Status: implemented

English | [中文](2026-09-09-mantur-asset-provider.zh.md)

## Problem

A pipeline report can change after a prompt proposal is prepared. Report replacement and history completion are separate writes, so interruption can leave their results inconsistent.

## Decision

The Mantur asset provider reads the selected pipeline report and stores its prompt drafts, proposals, actual request fields, and media bindings as separate observations. Source updates use the filesystem generation and source fingerprint captured by the request. A journal is committed before a replacement and history retains the selected prompt fields for guarded recovery. The provider does not schedule generation or infer missing image bindings.

Recovery uses the existing pending journal because report replacement and history completion are separate writes. A failed replacement or completion leaves the proposal unfinished. Conditional journal writes reserve the observed generation before replacement and retain that generation for completion, so a competing update cannot be silently overwritten. Tests inject failures at both writes, reject recovery after an external source edit, and synchronize two first journal writers at a barrier. These tests cover one LocalFileSystem instance and a reopened Session object, not a process restart or cross-process exclusion.

Asset extraction can leave image fields empty while the compiler records generated images in its request references. A selected companion storyboard joins those references by exact asset ID, exposes their provenance, rejects disagreement, and pins the companion file for freshness checks. No filename inference or source rewrite is involved. A user-selected local manifest can bind verified images to exact asset IDs when remote references are unavailable. The manifest preserves the report, and the panel labels local sources; invalid candidate files remain visible without being bound.

Report paths are implementation details, so the existing workbench slot discovers the standard operator output directories and presents asset and Clip tabs. Multiple project folders require a name selection rather than choosing an arbitrary report. Local manifests are explicit bindings, never inferred from media filenames. The default grid uses the available width; details open only on a card selection. It passes all four generated Remote argument positions; TypeScript optional parameters do not reduce the Gateway argument count. Source fields remain readable beside media and draft prompts, while submitted requests stay read-only. Session remounts and report loads reset selections and media tokens; saved drafts require matching row fingerprints.

## Alternatives considered

Inferring media bindings from filenames would treat candidate observations as confirmed generation results. Candidate discovery remains review-only, and report replacement requires the captured source version and fingerprint.

The proposal tool validates JSON edit fields before checking their request ownership and source fingerprints; unexpected media fields and malformed prompt values fail before journal writes.

## Consequences

The panel previews signature-validated project-local images and videos. Recovery remains a Host operation; cross-process exclusion and power-loss durability are unverified.

## Verification

Failure injection covers replacement, history completion, external source edits, and concurrent initial journal writes. Portable Host tests create a three-table synthetic report and signature-only media fixtures in private temporary roots. They verify serving and identity checks, not media decoding or remote clip availability.

Recovery rejects an absent or inconsistent pending proposal before either journal reservation or source replacement. A regression fixture preserves the original source bytes when the persisted proposal status is changed to requested.

The real-browser asset scenario loads both operator formats through generated RPC, decodes a PNG, plays an MP4, checks narrow layouts, and records an owner-local accessibility snapshot. Its public synthetic files are confined to an isolated project; saving a draft leaves the report bytes unchanged. With remote images returning HTTP 403, explicit local image bindings still decode without another remote request. Host checks reject duplicate IDs and image hash mismatches.
