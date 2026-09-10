# Agent Note: Seal local macOS candidates before archiving

Status: implemented

English | [中文](2026-09-09-local-macos-bundle-signing.zh.md)

## Problem

With certificate discovery disabled, ordinary packaging skipped application signing. The Electron executable retained its linker-provided ad-hoc identity without a bound Info.plist or sealed bundle resources. The application could start in a controlled smoke while `codesign --verify --deep --strict` rejected it.

## Decision

Provide an explicit Apple Silicon local packaging command beside the existing release commands. It uses electron-builder's supported `identity=-` and strict verification, disables certificate discovery and notarization, and retains the standard signer and entitlement selection. The signer runs after resource assembly and before archive creation. A second strict verification must pass before the system DMG builder runs.

Local candidates use separate build checkouts so older applications and archives remain available. Signed contents must not be modified after packaging. Local acceptance checks the application signature and the application extracted from its DMG, and records artifact hashes before test handoff.

## Alternatives considered

**Skip signing and describe the result only as unnotarized.** This conceals a failed bundle-integrity check.

**Resign the frozen application or disable system checks.** Resigning changes the accepted artifact identity; bypassing system checks does not prove integrity.

## Consequences

The local command does not discover a Developer ID identity, submit notarization requests or publish artifacts. It does not change the signed release workflow. Ad-hoc integrity is not Apple trust, notarization, Gatekeeper acceptance or public-update approval. Packaged runtime smokes, real browser authorization and client behavior still require separate checks on the final candidate.
