# Agent Note: Ship source-locked desktop media with separate FFmpeg ABIs

Status: implemented

English | [中文](2026-10-27-mantur-source-locked-media.zh.md)

## Problem

The pinned macOS arm64 external FFmpeg reports nonfree and unredistributable. The editor also loads two different FFmpeg ABIs. Copying only its compositor directory omits sibling libraries, and Remotion's `DYLD_LIBRARY_PATH` can select incompatible libraries with identical names. npm wrapper metadata does not identify the actual media programs or provide their corresponding source.

## Decision

The [source manifest](../../../../apps/desktop/mantur-cut/source.json) binds the approved media archive, complete file inventory, corresponding-source archive, source lock and build recipes. The [recipe](../../../../scripts/mantur-media-build.README.md) builds FFmpeg 6.1.6 GPL command-line tools with x264 and native AAC, and separate FFmpeg 7.1.5 LGPL libraries for the fixed Remotion native program. The GPL libraries retain ABI major filenames; the LGPL libraries retain the unversioned names required by Remotion. Staging and Session copies preserve the complete `bin`, `lib` and `compositor` directory relationship. Managed tool paths and default npm resolution use those same resources.

Media inputs have a separate immutable, non-Latest release so CI can obtain them before the desktop release exists. The [desktop source publisher](../process/2026-10-26-desktop-release-sources.md) includes the actual corresponding-source archive with its final checksums. This archive contains fixed upstream source, recipes, configurations, build records and notices; a URL inventory alone is insufficient. Electron's retained FFmpeg has its own fixed provenance, source and notices and is not described as rebuilt by this recipe.

The [target-only staging decision](2026-09-09-mantur-native-resource-staging.md) still owns cache and platform pruning. Its same-directory compositor rule applies to that layout; the source-locked media layout admits only verified dependencies contained within the complete media directory. Neither layout permits arbitrary parent traversal, missing libraries or non-system absolute dependencies. Distribution signing changes binary bytes, so final signed inventories remain separate from the approved input inventory.

The examined Remotion source and executable have a fixed provenance chain. Its precise FDK fork retains FDK-AAC terms while the patch changes configure classification; those sources do not establish additional GPL-compatible permission. The replacement removes that unresolved combination without inferring illegality from an encoder name or making a legal determination about an older release.

## Alternatives considered

**Retain the main external binary or change its approval string.** Its executable reports a nonfree configuration; metadata does not repair that input.

**Retain every original Remotion library.** Source and byte provenance do not alone close the combination-license question for the fixed FDK fork.

**Share one GPL library set or flatten both sets.** The native Remotion program links the FFmpeg libraries directly and requires its 7.1 ABI. Separate LGPL libraries preserve that dependency, while distinct GPL library filenames prevent loader substitution.

**Rebuild the approved candidate during every local integration check.** Recompilation changes the object being accepted and consumes time without testing the packaging change. Local integration uses the approved archive; its fixed sources and recipe remain available for regeneration.

## Consequences

The verified candidate supports macOS arm64. Other targets require their own verified inputs rather than reuse of the old nonfree binaries. Deployment-target metadata does not prove runtime compatibility with every older macOS release. The supported Cut H.264 route uses PCM followed by native AAC; arbitrary Remotion calls that request `libfdk_aac` remain outside that route.

Archive and runtime checks reject altered hashes, escaped paths, incomplete libraries and unsupported configurations. Acceptance also requires actual Session loading and export, default and fallback resolution, signed-package inventory, Developer ID signature, notarization and GUI output checks. The media candidate's independent capability and source review does not substitute for those final application checks. This change extends packaging and the editing adapter without modifying Harness core.
