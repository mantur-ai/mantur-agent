# Agent Note: Persistent desktop update checks

Status: implemented

English | [中文](2026-09-11-desktop-update-check.zh.md)

## Problem

A permanent update card occupies the conversation sidebar when no update is available. Manual checks need a discoverable place inside product settings.

## Decision

General settings owns installed-version status, manual checks, and retries. The sidebar renders only available, downloading, and ready states in either width. Idle, checking, no-update, and error states stay out of the sidebar. Both registrations share one native subscription and controller. Only a successful native version check reports no available update; the [release-version decision](../bug-fix/2026-09-12-github-update-version-check.md) defines older-release handling. Explicit download and installation confirmation remain unchanged.

The packaging workflow retains generated update metadata and blockmaps alongside installers. CI attachment availability is separate from publishing a signed release to the configured feed.

## Alternatives considered

Keeping checks only in the native menu saves sidebar space but leaves the ordinary product navigation without a discovery action. Treating an unavailable feed as up to date hides a release failure.

## Consequences

Background checks reserve no sidebar space until an update is found. Browser builds still expose no installer. Existing installed clients receive this UI only through an actual installation; source changes and CI artifacts alone cannot repair an empty release feed.

## Verification

Component regressions cover manual checks in settings and hidden idle, checking, current, and failed states in both sidebar widths. The real Mantur browser composition records these states and verifies check, download, and install actions through an isolated native bridge. Native release discovery and installation require separate validation against published artifacts.
