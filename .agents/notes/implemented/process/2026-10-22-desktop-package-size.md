# Agent Note: Desktop release symbols and DMG compression

Status: implemented

English | [中文](2026-10-22-desktop-package-size.zh.md)

## Problem

Desktop compiler maps occupy installer bytes but serve source-level debugging. DMG compression can reduce download size without removing offline resources.

## Decision

The desktop [builder configuration](../../../../apps/desktop/package.json) excludes only its own `lib/**/*.js.map` and `lib/**/*.d.ts.map` during copying. Its `beforePack` hook first archives maps, generated files and on-disk source bytes with version, target, paths and SHA-256 hashes outside the application payload. Backup failure aborts packaging. Builders must rebuild from the same checkout without concurrent edits: a source snapshot alone cannot prove that stale compiled files came from that source. The hook never edits or deletes application inputs or signed bundles.

The [DMG creator](../../../../scripts/create-macos-dmg.ts) uses UDZO zlib level 9 before generating the blockmap from the compressed bytes. An isolated conversion of the same local 0.1.11 volume measured 795,638,073 bytes at the default level and 720,043,786 bytes at level 9; conversion time increased from 5.245 to 32.118 seconds. Both images passed image verification and decompressed to identical data-fork hashes. This measures that older volume, not current installers.

## Alternatives considered

**Delete every map or documentation directory.** Dependency maps may have different consumers; documentation-named directories may contain offline resources. The filter stays within the desktop compiler output.

**Trim Cut after packaging.** Cut build information hashes its staged web, Remotion and compositor content. Its staging and static-file enumeration need separate verification before any deletion; the desktop filter leaves Cut untouched.

## Consequences

Symbol directories require separate retention with release artifacts. Both packaging workflows upload separate 90-day symbol artifacts governed by repository access; release assembly does not download them. Release owners archive symbols before expiration. Focused tests cover backup failures, source escape rejection and actual builder matching. Full editing/export verification and current native macOS/Windows packaging remain required before release. No new installer, signature, public release or production deployment is established by these changes.
