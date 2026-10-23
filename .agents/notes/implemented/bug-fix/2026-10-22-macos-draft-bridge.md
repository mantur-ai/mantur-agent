# Agent Note: Restore macOS desktop draft storage

Status: implemented

English | [中文](2026-10-22-macos-draft-bridge.zh.md)

## Problem

A desktop restart changes its loopback origin. Unassigned text, exact Skill references and selected image bytes cannot survive that restart through per-Session browser storage alone. Skill-update desktop acceptance exposed the missing macOS recovery path.

## Decision

The macOS carrier mounts the existing draft storage and authenticated main-frame IPC bridge and exposes its fixed preload operations. The existing Conversation adapter restores complete documents and image bytes before enabling input. No profile is scanned or migrated, and no draft content is sent to a model.

Normal quit waits for a durable revision receipt before stopping the Host. Duplicate quit requests share that pending operation. Save failure releases the input lock and keeps the application open with a localized retry message. Update installation uses the same draft preparation before its separate Host checkpoint and verified exit. A normal quit cannot overlap update preparation; the user can retry after the update attempt settles.

Windows retains browser draft storage because the existing native storage explicitly rejects its durability path. Both Main and preload restrict the native adapter to macOS. This supersedes only the macOS draft-removal decision in [native file import](../feature/2026-09-11-desktop-file-import.md); file import and its stored references remain intact. The [draft checkpoint design](../architecture/2026-09-06-desktop-draft-checkpoints.md) owns document and image validation. No upstream core file changes are required.

## Alternatives considered

Retaining browser-only storage fails recovery when the port changes. Saving clipboard text alone loses Skill metadata and image bytes. Exposing the native adapter on Windows would activate a known rejected storage path and block editing; this change does not claim Windows durability.

## Consequences

macOS restoration retains exact identities and attachments without sending a task. Unsupported or corrupt checkpoints fail visibly rather than being replaced with empty content. Draft saves consume private disk space; forced process termination cannot wait for a final receipt. Windows origin-independent recovery remains unavailable.

## Verification

Main-entry tests cover delayed receipts, repeated quit requests, failed-save retry and update overlap. Preload tests cover fixed channels and Windows exclusion; bridge and real temporary-file tests cover frame authorization, revision matching and corrupt attachments. Existing Conversation snapshots pin restored references and image bytes; a localized refusal snapshot pins the new error text. Desktop acceptance uses the isolated profile and native window, with no model task or publication.
