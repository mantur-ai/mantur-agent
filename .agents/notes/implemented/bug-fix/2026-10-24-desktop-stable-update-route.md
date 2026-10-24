# Agent Note: Keep desktop update checks on stable metadata

Status: implemented

English | [中文](2026-10-24-desktop-stable-update-route.zh.md)

## Problem

Electron Builder detects `rc` from a prerelease version and writes it into the packaged generic configuration alongside the stable feed URL. Without a runtime override, electron-updater requests `stable/rc-mac.yml` or `stable/rc.yml`, which the isolated publisher does not produce. Disabling prerelease preference alone does not change that address.

## Decision

The [desktop controller](../../../../apps/desktop/src/updater.ts) selects `latest` before scheduled or manual checks and sets `allowDowngrade=false` after the channel setter, whose side effect enables downgrades. All desktop versions keep the stable feed and disable prerelease preference. The generic provider does not filter metadata by that preference: the stable directory must contain only stable releases. Older and equal versions produce no update; a newer final release, including an RC's same-core final version, remains eligible.

Publisher configuration retains builder channel detection and separate RC metadata and directories. The [distribution decision](../process/2026-10-16-tos-desktop-distribution.md) owns publication isolation. Missing metadata and network errors remain failures without cross-channel fallback. Download consent, installation confirmation, signatures, notarization, and publication approval remain required.

## Alternatives considered

Changing global `publish.channel` to `latest` also changes generated RC metadata names. Copying RC metadata into the stable directory defeats release isolation. Following the RC directory would change the client’s stable update policy. Neither alternative repairs this address combination while retaining both policies.

## Consequences

The desktop bundle exposes an updater entry sharing its implementation with Main. Packaged smoke invokes that entry with the packaged generic provider and an intercepted HTTP executor, verifies the complete effective URL and pre-request policy, and performs no update network access or installation. Source fixes do not repair existing signed applications; frozen candidates remain unchanged.

## Verification

Owner-local tests use real builder configuration and metadata generation for stable and RC versions, then real GenericProvider routing for Darwin arm64/x64 and a win32 x64 model. Real AppUpdater version selection covers older, equal, newer RC, and same-core final versions, including the generic prerelease-filter limitation. Negative controls reject the old route, a preference-only change, and the channel setter’s downgrade side effect. Controller state expectations cover automatic and manual error, no-update, and available results. Release assembly and publisher matrices retain stable/RC isolation and invalid-input rejection. Offline models do not establish native Windows, new packaged application, signing, GUI, download, or installation acceptance.
