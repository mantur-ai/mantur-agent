# Agent Note: Deliver verified desktop sources with release notes

Status: implemented

English | [中文](2026-10-26-desktop-release-sources.zh.md)

## Problem

Desktop releases contain modified Cut programs, but source pins and patches alone do not deliver their complete source files. Compiler symbols serve debugging and have limited private retention. Automatically generated commit notes do not explain installation scope or known limitations to users.

## Decision

The [desktop release workflow](../../../../.github/workflows/desktop-release.yml) assembles full Harness, upstream Cut, patched Cut and Whisper Git archives from the same checkout and source manifest used by native builds. The [archiver](../../../../scripts/desktop-release-sources.py) refuses tracked checkout edits, verifies pinned commits and trees, applies every digest-checked patch, and checks tar file bytes and modes against the resulting Git objects. Fixed tar and gzip timestamps give identical source archives for the same inputs. Only tracked source files enter these archives; untracked build outputs and profiles are excluded.

Source archives, a commit/distribution manifest and build instructions share the installer's checksum list and public release delivery. Assembly fails before publication if source validation fails. [Debugging symbols](2026-10-22-desktop-package-size.md) retain their separate access and expiration rules. The source artifacts do not grant third-party redistribution rights or replace exact distribution review; [TOS publication](2026-10-16-tos-desktop-distribution.md) retains its approval, immutable-object and channel checks.

Publication requires explicit user-facing notes through the `release_notes` input. Validation rejects blank notes before signing work starts, while nonpublishing builds remain usable without notes. The release creation step writes input text through an environment variable to a temporary file; shell syntax in notes remains data.

## Alternatives considered

**Publish source pins and patches only.** Recipients would still need to reconstruct omitted source files. The release instead delivers the complete selected Git trees and records their identities.

**Reuse local candidate source archives.** Those files may identify another commit or patch set. Assembly reconstructs sources for its own release checkout.

**Use automatically generated commit notes.** Commit subjects do not reliably explain supported platforms, upgrade steps or user-facing limitations. Publication therefore requires prepared user notes.

## Consequences

Assembly downloads pinned source commits and adds source delivery bytes to the release. Source validation rejects unsupported submodules, archive attribute omissions and escaping links instead of claiming complete delivery. Isolated Git fixtures prove archive content and repeatability, wrong-pin rejection, dirty-source rejection and output preservation; workflow tests prove notes admission and literal transfer. Native signing, notarization, final GUI behavior and substantive distribution eligibility remain separate release evidence.
