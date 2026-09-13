# Agent Note: Native update entry and explicit downloads

Status: implemented

English | [中文](2026-09-06-desktop-update-entry.zh.md)

## Problem

Background update discovery opened a download dialog and required the native application menu to revisit an available update. The renderer had no progress entry, and an installation-preparation failure discarded the ready status even though the verified download remained available.

## Decision

The desktop updater publishes silent availability and starts a download only after an explicit action. A narrow main-frame preload exposes versioned snapshots and three fixed controller actions. The Mantur navigation plugin owns the subscription and renders an entry above Settings in both sidebar widths. Older snapshot replies cannot replace newer events, and disposal prevents late renderer updates.

The native controller owns the single installation confirmation used by menu and sidebar actions. Later retains the ready action without repeated prompts. Preparation failure retains the verified download and displays the failure; it does not claim that installation occurred. The existing final Host checkpoint blocker still prevents actual installation and stops no tasks.

## Alternatives considered

A separate renderer updater would duplicate download and confirmation ownership. Automatic download would remove explicit consent. Idle-card suppression is partially superseded by the [persistent check decision](2026-09-11-desktop-update-check.md), which keeps manual discovery available before a version is found. Guessing percentage from time would misrepresent progress.

## Consequences

Ordinary browser pages have no update capability or simulated installer. Native downloads expose actual transferred bytes and use indeterminate progress when total size or percentage is unknown. The existing feed, release-channel selection, signatures, and architecture-specific artifacts remain required. This UI change does not supply Windows durable publication or a reliable Host shutdown checkpoint.

## Verification

Controller tests cover explicit downloads, duplicate actions, unknown totals, verification failure, Later, and failed preparation. IPC tests reject other windows and frames; renderer tests cover stale snapshots, disposal, collapsed actions, and localized progress. An isolated browser fixture drives the real Mantur sidebar without contacting a release feed or invoking an installer. Native package installation remains untested.
