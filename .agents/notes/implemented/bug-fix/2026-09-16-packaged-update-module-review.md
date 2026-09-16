# Agent Note: Packaged update module review

Status: implemented

English | [中文](2026-09-16-packaged-update-module-review.zh.md)

## Problem

The desktop restart-to-update path rejects the shipped Mantur composition before saving because its reviewed-module set omits the Host runner, script, assets, editing and native picker UI modules. Update discovery and signature verification do not exercise this path.

## Decision

The update policy includes those five shipped modules. Script and asset mutations remain owned by Gateway requests and AgentLoop tool execution. Editing retains its existing ordered shutdown owner. The native picker UI has no Host work; native dialogs retain their existing cancellation owner. Unused worker runtimes and Host runners close admission and drain managed calls, while root-wide execution history still rejects any previously started worker or activated dynamic program.

This amends the module-level exclusions in the [program history decision](../architecture/2026-09-07-update-program-history.md) and [editing shutdown decision](../architecture/2026-09-08-editing-before-host-shutdown.md); history checks, unmanaged execution refusal and failed-shutdown retention remain intact. The change belongs to the Mantur bundle and does not modify the upstream loop.

## Alternatives considered

Removing module verification would admit unreviewed plugins. Removing the runner from the profile would disable existing functionality. Both are rejected.

## Consequences

Packaged macOS and Windows composition checks detect unreviewed enabled modules. Loader shutdown regression verifies that an unused runner closes admission, while existing regressions retain refusal after execution and editing failures. Published clients containing the old policy need one manual signed-package installation because their own shutdown check runs before replacement; changing the downloaded package cannot repair that old check.
