---
kind: package-reference
description: "Project-local pipeline reports, guarded prompt proposals, and validated media previews."
---

# Mantur asset provider

English | [中文](README.zh.md)

## Summary

This plugin reads an explicitly selected Mantur pipeline report and keeps prompt drafts, Agent proposals, actual request fields, and media observations separate. Report writes are guarded by the source filesystem version and SHA-256 fingerprint. A pending journal is written before replacement so a caller can recover after interruption without guessing an asset-to-media binding.

## Table of Contents

- [Report and media operations](#report-and-media-operations)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Report and media operations

<a id="report-and-media-operations"></a>

The browser opens a full-width asset grid without report-path controls. It discovers standard operator reports under `资产/资产提取结果` in the Session workspace and its direct project folders; multiple matches require a project-name selection. Asset and storyboard/Clip tabs load their corresponding reports automatically. Search, category and episode filters narrow the cards; selecting a card opens its media and details, and closing details restores the full grid. Report-bound HTTP(S) media uses browser playback; local paths use the validated media route. The same report directory may contain explicit `local-images.manifest.json` and `clips.manifest.json` bindings, loaded for the corresponding tab. An explicit media manifest takes precedence over the report URL. Each row provides exactly one `asset_id` or `clip_id`, a `file` path, and its `sha256`. Asset bindings require a valid image signature and matching hash before loading; previews retain hash verification and show their local-file source. Manifest file paths resolve relative to the manifest directory and remain inside the project. Failed media remains an error; files are never guessed from an asset name. The panel reads reports, scans an explicitly selected project-local candidate folder, previews validated image and video files, selects prompt rows, saves drafts, submits proposal requests, and displays persisted unfinished requests and writes. Invalid and oversized candidate files remain visible with a reason and cannot be previewed. Candidate previews are review-only observations; they do not populate an empty report binding. Recovery is a Host operation; the panel has no recovery button. Recovery retries the recorded replacement only while the source version and hash still match, or completes history when the replacement bytes are already present. Conflicting source content remains untouched. Recovery validates the pending proposal before reserving the journal or replacing source bytes; a missing or inconsistent proposal leaves both files untouched.

`AssetRow.details` retains all source columns as display text; `localMedia` identifies only an explicit manifest binding. Switching reports clears selections and preview URLs, and saved drafts restore only for matching row fingerprints. Without an image manifest, the project storyboard supplies image URLs through exact `asset_id` references. Conflicting URLs reject the association, and source fingerprints are checked before using the linked observation; loading never writes those URLs into the asset report. The generated `load` call supplies all four argument positions, including absent optional paths.

`AssetProject` lists discovered project names and operator output locations; `AssetEntry` and `AssetCandidate` describe project-local discovery results. `SourcePin` retains the path, filesystem `AssetVersion`, and SHA-256 fingerprint; `AssetSnapshot` combines this observation with the journal generation, report rows, and pending state. `PromptEdit` selects a row fingerprint and editable prompt fields. `AssetCommand` pins the source and journal for a batch; `AssetProposal` retains its initiating Session and request status. `AssetMedia` identifies a validated preview URL and media kind. The declarations live in [types.ts](src/types.ts).

No runtime invariant companion is published because report, journal, and media freshness is checked at each filesystem operation; the service owns no independently cached source state to compare.

<a id="model-experience"></a>

## Model Experience

### Prompt proposal

#### What the model sees

The model sees only the `propose_asset_prompts` tool. The tool records a text proposal for a request and never generates media or changes a pipeline report. Applying a proposal remains an explicit Host operation.

#### Token effect

The tool schema adds request-header tokens. Explicit proposal requests and tool results add conversation tokens; browsing reports and previewing media do not send model messages.

#### KV Cache effect

Mounting the tool changes the request prefix. Proposal messages append to the existing conversation history.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Journal updates retain the filesystem version observed before reading and use conditional writes. Candidate discovery is direct-child only, stays inside the selected project root, and previews verify the file signature before issuing a loopback URL. Concurrent calls through one LocalFileSystem instance are covered; cross-process writers and power-loss durability are not verified. Tests create synthetic reports and media headers inside private temporary roots and require no external user files.

<a id="dev-note"></a>
### Dev Note

[Guarded asset writes and recovery](../../../.agents/notes/implemented/feature/2026-09-09-mantur-asset-provider.md) records the source version and journal requirements.
