# Agent Note: Paired desktop signing

Status: implemented

English | [中文](2026-09-15-paired-desktop-signing.zh.md)

## Problem

A release that advertises both desktop platforms needs signed installers and update metadata from the same source. Publishing one platform after the other fails can expose an incomplete release to automatic updates.

## Decision

The [desktop release workflow](../../../../.github/workflows/desktop-release.yml) accepts an explicit Windows selection alongside the macOS architecture selection. Windows signing uses the protected `windows-release` environment and verifies Authenticode on both the installer and unpacked application. Assembly depends on every selected platform succeeding; an unselected Windows job may be skipped. The single publication step receives the installers, blockmaps, platform update metadata and hashes together.

## Alternatives considered

Separate platform publications allow users to discover a release before both update channels exist. An unsigned Windows replacement would contradict the requested signed delivery. Keeping Windows optional permits an explicitly macOS-only candidate when Windows credentials are unavailable.

## Consequences

The [desktop publishing instructions](../../../../apps/desktop/README.md) own credential setup and exact-source distribution review. Missing Windows credentials block a selected paired release without weakening that review. Workflow tests execute artifact selection for every platform combination and pin signature verification before upload. Real certificate validity and packaged launch remain native CI checks; local workflow tests cannot establish either.
