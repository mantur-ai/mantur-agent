# Agent Note: Guarded asset provider

Status: implemented

English | [中文](2026-09-09-mantur-asset-provider.zh.md)

## Problem

A pipeline report can change after a prompt proposal is prepared. Report replacement and history completion are separate writes, so interruption can leave their results inconsistent.

## Decision

The Mantur asset provider reads the selected pipeline report and stores its prompt drafts, proposals, actual request fields, and media bindings as separate observations. Source updates use the filesystem generation and source fingerprint captured by the request. A journal is committed before a replacement and history retains the selected prompt fields for guarded recovery. The provider does not schedule generation or infer missing image bindings.

Recovery uses the existing pending journal because report replacement and history completion are separate writes. A failed replacement or completion leaves the proposal unfinished. Conditional journal writes reserve the observed generation before replacement and retain that generation for completion, so a competing update cannot be silently overwritten. Tests inject failures at both writes, reject recovery after an external source edit, and synchronize two first journal writers at a barrier. These tests cover one LocalFileSystem instance and a reopened Session object, not a process restart or cross-process exclusion.

## Alternatives considered

Inferring media bindings from filenames would treat candidate observations as confirmed generation results. Candidate discovery remains review-only, and report replacement requires the captured source version and fingerprint.

The proposal tool validates JSON edit fields before checking their request ownership and source fingerprints; unexpected media fields and malformed prompt values fail before journal writes.

## Consequences

The panel previews signature-validated project-local images and videos. Recovery remains a Host operation; cross-process exclusion and power-loss durability are unverified.

## Verification

Failure injection covers replacement, history completion, external source edits, and concurrent initial journal writes. The local acceptance fixture contains twelve images and ten filename matches; remote clip URLs are not preview evidence.
