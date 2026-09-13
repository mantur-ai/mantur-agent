# Agent Note: Compare release versions before loading update files

Status: implemented

English | [中文](2026-09-12-github-update-version-check.zh.md)

## Problem

Fetching metadata first makes installed 0.1.7 fail on the empty older 0.1.3 release.

## Decision

The pinned GitHub provider compares the selected semantic tag before fetching metadata. With downgrades disabled, equal or older tags produce `ERR_UPDATER_NO_NEWER_RELEASE`; the native controller consumes that result only during a check. No synthetic metadata or substitute download is supplied. Higher releases still require real metadata and verified installation files.

Updater failures retain raw diagnostics in the application log and expose concise localized feedback. A missing higher-release manifest means unavailable, not up to date. This refines wording in the [persistent update check decision](../architecture/2026-09-11-desktop-update-check.md), without changing download or installation consent.

The signed macOS workflow explicitly selects `arm64` or defaults to `both`. Every selected architecture must pass signing, notarization, and packaged smoke. Apple Silicon selection does not advertise Intel support. Exact-distribution approval and immutable-release requirements still govern publication.

Each architecture downloads by explicit artifact name into its own directory. Assembly paths do not depend on how many artifacts match a pattern.

## Alternatives considered

Treating all metadata 404s as current hides incomplete higher releases. The patch uses the provider's existing version selection instead of duplicating release discovery. Editing an installed signed application would invalidate its signature.

## Consequences

The provider patch and controller result handling must change together when electron-updater is upgraded. Client discovery fixes do not publish update assets; publication still requires complete artifacts and the configured approval.

## Verification

Installed-provider tests cover older, equal, higher, incomplete, prerelease, and explicit downgrade cases. Controller tests cover event and promise delivery, and separate raw logs from user feedback. Native menu and real browser snapshots record no-update wording. A production check verifies that 0.1.7 skips the empty 0.1.3 metadata request. Published download and restart acceptance remain separate checks.
