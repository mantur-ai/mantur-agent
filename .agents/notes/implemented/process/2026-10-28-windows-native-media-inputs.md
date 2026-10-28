# Agent Note: Windows native media inputs

Status: implemented

English | [中文](2026-10-28-windows-native-media-inputs.zh.md)

## Problem

The desktop editor needs Windows executables and DLLs with a complete source record. A macOS media archive cannot establish PE architecture, Windows loader behavior or the build configuration of an npm-supplied FFmpeg DLL.

## Decision

The [Windows media candidate workflow](../../../../.github/workflows/desktop-windows-media.yml) runs the [pinned recipe](../../../../scripts/mantur-media-build-windows.py) under native Windows with the MSYS2 UCRT64 toolchain. External FFmpeg and FFprobe use the GPL CLI build; the Remotion process loads independently compiled LGPL FFmpeg DLLs with its required ABI. Tool versions, source hashes, configurations, import dependencies and execution probes accompany the candidate and corresponding-source archives.

This workflow has read-only repository permission and no publication credentials. It retains failure evidence and does not change installers, tags or update channels. A separate native job reads the exact published Windows baseline's update configuration without installing or launching it. The [source-delivery policy](2026-10-26-desktop-release-sources.md) continues to govern product source archives; [paired desktop signing](2026-09-15-paired-desktop-signing.md) continues to govern that separate workflow.

Windows packaging selects its own source manifest and verifies the media archive, corresponding sources and PE imports on native Windows x64. Default npm lookup paths contain verified copies of the selected files, avoiding a dependency on user symlink privileges. macOS keeps its relative aliases and Mach-O verification. The packaged Windows media probe exercises the packaged adapter's short H.264/AAC export and the Remotion executable's metadata operation; these observations do not establish interactive editing or an automatic desktop upgrade.

## Alternatives considered

**Reuse the Mac archive.** Mach-O binaries cannot supply Windows runtime evidence or executable inputs.

**Reuse all npm compositor files.** The inspected Windows package contains GPL FFmpeg DLLs and build inputs that differ from the selected LGPL library configuration. Retaining only the separately licensed Remotion executable and wrappers makes the library build inputs explicit.

**Publish directly from the media build.** A successful media build does not prove the installed desktop or its updater. Candidate generation has no publication authority.

## Consequences

Windows compilation takes additional CI time and needs its own binary inventory. Source and import checks remain separate from actual native execution; package, installation and upgrade claims require their owning evidence. Failure logs are retained for the exact attempt, and a candidate is not a signed or published desktop release.
