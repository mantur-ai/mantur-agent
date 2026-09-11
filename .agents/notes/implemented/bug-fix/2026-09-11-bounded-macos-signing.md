# Agent Note: Bound macOS signing discovery

Status: implemented

English | [中文](2026-09-11-bounded-macos-signing.zh.md)

## Problem

The desktop release failed with `EMFILE` while the signer inspected bundled dependencies. The packager's `@electron/osx-sign` 1.3.3 recursively starts every child inspection through `Promise.all`, so simultaneous file opens grow with the application tree.

## Decision

A pnpm patch makes child discovery sequential in both distributed module formats. Binary detection, temporary-file removal, nested application and framework ordering, entitlements, signing, and verification remain unchanged. The lockfile pins the patch used by electron-builder.

## Alternatives considered

Increasing the runner's descriptor limit leaves discovery unbounded as the bundle grows. Ignoring directories can omit nested code from signing. An override to osx-sign 2.x cannot preserve the packager's API: the [upstream major release](https://github.com/electron/osx-sign/releases/tag/v2.0.0) removes `signAsync`.

## Consequences

Discovery trades parallel throughput for bounded open files. The patch requires review when the packager adopts a compatible upstream fix. Developer ID signing, notarization, and packaged launch checks still determine whether a release candidate is deliverable; scanner success alone proves none of those results.

## Verification

The release workflow runs the actual installed scanner in a child with both soft and hard descriptor limits set to 64. A tree containing hundreds of text files and nested binary code must yield the complete signing targets in order, exit normally, and leave no running child. The unpatched scanner also reproduced `EMFILE` on the local desktop bundle under that limit.
