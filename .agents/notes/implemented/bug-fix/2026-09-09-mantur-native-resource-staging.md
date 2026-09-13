# Agent Note: Stage target-only editor resources before signing

Status: implemented

English | [中文](2026-09-09-mantur-native-resource-staging.zh.md)

## Problem

The embedded editor copies build caches, a second identical Chrome Headless Shell and ONNX binaries for other native targets. Its macOS compositor executables and dylibs use bare relative install names, which hardened runtime refuses even when the adjacent library exists. An intact application signature alone does not prove that video export can load its dependencies.

## Decision

The distribution copy excludes the exact webpack cache and duplicate browser cache directories. It retains the manifest-selected top-level browser and its license. Both ONNX installations keep their selected platform and architecture under `bin/napi-v6`; missing target bindings stop staging. Other dependencies, caches and notices remain untouched. Runtime browser calls use the existing explicit manifest path, whose absence remains an error rather than a download request.

Before signing, macOS staging rewrites the compositor's ffmpeg, ffprobe, remotion and every adjacent dylib to loader-relative sibling references. Only system library paths and present same-directory dylibs are accepted. Reinspection rejects any unresolved or unrelocated reference. The packager signs the resulting files through the existing signing command; frozen applications and source binaries are not edited.

## Alternatives considered

Broad cache or filename-based deletion can remove runtime data and licenses. Keeping a second browser as an implicit backup hides an invalid manifest. Disabling hardened runtime or expanding entitlements changes the security policy instead of repairing install names. Editing signed resources invalidates the candidate identity.

## Consequences

The existing electron-builder standard entitlements include `disable-library-validation`; this decision adds no entitlement or signing exception. A local ad-hoc test uses those same entitlements. A runtime-only ad-hoc probe without them fails the separate Team ID requirement; successful bundle verification is not evidence that library validation is enabled, nor Developer ID or notarization approval.

Structural tests preserve licenses and unrelated cache contents across all supported targets. A macOS native fixture loads a recursive dylib chain under the existing signing conditions. Final acceptance separately requires the packaged FFmpeg to generate audio, actual editor video export and ffprobe readback, browser selection without downloads, and complete application signature verification. Report installed logical bytes, allocated bytes and compressed archive sizes separately; staging exclusions do not predict download savings.
