# Agent Note: Automatic recommended Skill updates

Status: implemented

English | [中文](2026-10-14-mantur-recommended-skill-updates.zh.md)

## Problem

Homepage recommendations selected packaged Skill versions even after newer production releases were published.

## Decision

The homepage failure policy is superseded by [isolated update outcomes](../bug-fix/2026-10-22-bundled-skill-update-isolation.md); the immutable release and exact-reference rules below remain in force.

The Mantur marketplace plugin checks the active deployment for the packaged allowlist at client startup and homepage Session changes. It downloads bounded archives, verifies the published SHA-256 and complete file inventory, validates instructions, and atomically publishes immutable releases outside user Skill discovery directories. No upstream core changes are required.

New selections capture a verified name, version and content digest. Serialization and instruction injection resolve the captured release offline; an update never rewrites an existing draft reference. Updated releases remain in the application-owned store for prior references. Packaged references still require their application resources. A network or verification failure is recorded separately from verified packaged availability, with retry exposed by the client. Publishing different bytes under an existing cached version is rejected.

## Alternatives considered

**Replace the selected Skill in place.** This changes instructions after selection and breaks exact-reference verification.

**Update user Skill directories.** This can overwrite user edits and expose multiple discoverable versions. The application-owned store avoids both effects.

## Consequences

Recommended Skills can advance independently of client releases. User-installed Skills remain under explicit installation control. Each recommendation has its own update result; failed checks do not certify local versions as current online releases. Old cached versions consume disk space and are not automatically collected. Windows execution still requires platform acceptance; these checks do not establish a complete paid production run.

## Verification

Focused tests cover upgrades, cache reuse, offline exact-version loading, cancellation, archive and instruction rejection, modified resources and same-version republishing. Real Loader and Remote browser cases exercise downloads and homepage selection. The opt-in production test compares successfully checked recommendations against current detail versions and installs public bundles without credentials or paid operations.
