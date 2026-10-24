# Agent Note: Exercise Mantur failure and callback lifecycles

Status: implemented

English | [中文](2026-10-24-mantur-coverage-gaps.zh.md)

## Problem

Navigation, workbench and marketplace tests omit callback lifecycles and failure paths that the per-file coverage requirement includes. The Python runtime's process-identity reader also leaves its Linux filesystem path untested on macOS. Passing behavior tests alone does not establish the required per-file coverage.

## Decision

Navigation tests settle replaced catalog requests, retry failed reads, exercise installed-skill navigation and published schema variants, and observe Remote refresh and draft failure handling. Workbench tests control native-view promises and delayed session notifications, then assert that stale work cannot open a view or replace current state. Registration tests observe subscription removal. These tests retain the shipping implementations and existing assertions.

Marketplace tests create real archives and private release stores. They verify cached identities, inventory ordering, metadata limits, fallback verification, caller cancellation and publication collisions. Narrow filesystem fault injection supplies errors that ordinary portable filesystem fixtures cannot reliably produce. A competing release contains real copied bytes that the normal verifier checks. The inventory test checks the actual sort comparator for reflexivity and antisymmetry before delegating to the native sort, then verifies the published path order and bytes. A negative control that removes its equality result fails this test. The cached-catalog guard checks for an absent first item before checking the item count; empty and multiple-item stores remain rejected with the same diagnostic.

Python process-identity tests supply a Linux stat record with spaces and parentheses in its command name and a missing process entry. They intercept only the fixture's exact proc path and restore the host platform descriptor after each case. Existing real-process tests continue to own host integration evidence. No runtime behavior, coverage threshold, exclusion or timeout changes are required.

## Alternatives considered

**Count aggregate test success as coverage success.** The gate requires 100 percent for each measured file; a passing test count cannot replace its result.

**Add skips, coverage ignores or weaker assertions.** These would conceal the untested paths instead of checking their observable effects.

**Use delays to place callback races.** Explicit promise settlement and notification delivery reproduce the relevant ordering without relying on scheduler speed.

**Require Linux to exercise process-identity parsing.** Portable proc fixtures verify parsing and read failure on supported test hosts while retaining the separate real Linux integration test.

## Consequences

The added tests cover existing behavior without changing model-visible output or requiring new recorded-session data. Temporary resources and global overrides have explicit cleanup. Focused coverage locates remaining omissions; the unchanged full-repository gate is still required for completion. A successful coverage run does not resolve separately tracked HMR or release acceptance failures.
