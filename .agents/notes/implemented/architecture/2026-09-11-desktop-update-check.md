# Agent Note: Persistent desktop update checks

Status: implemented

English | [中文](2026-09-11-desktop-update-check.zh.md)

## Problem

Hiding the sidebar entry before update discovery makes manual checks depend on the native application menu. A failed background check also removes the action users need to retry.

## Decision

Every enabled desktop snapshot renders the installed version and a check action above Settings in either sidebar width. Only a successful native version check displays no available update; the [release-version decision](../bug-fix/2026-09-12-github-update-version-check.md) defines older-release handling. Failures retain a retry action. This partially supersedes idle-card suppression in the [native update entry decision](2026-09-06-desktop-update-entry.md); controller ownership, explicit download, and installation confirmation remain unchanged.

The packaging workflow retains generated update metadata and blockmaps alongside installers. CI attachment availability is separate from publishing a signed release to the configured feed.

## Alternatives considered

Keeping checks only in the native menu saves sidebar space but leaves the ordinary product navigation without a discovery action. Treating an unavailable feed as up to date hides a release failure.

## Consequences

The sidebar uses space even when no new version is available. Browser builds still expose no installer. Existing installed clients receive this UI only through an actual installation; source changes and CI artifacts alone cannot repair an empty release feed.

## Verification

Component regressions cover manual checks in idle, current, and failed states in both sidebar widths. The real Mantur browser composition records these states and verifies check, download, and install actions through an isolated native bridge. Native release discovery and installation require separate validation against published artifacts.
