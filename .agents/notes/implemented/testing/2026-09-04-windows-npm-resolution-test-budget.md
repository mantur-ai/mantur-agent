# Agent Note: Windows npm resolution test budget

Status: implemented

English | [中文](2026-09-04-windows-npm-resolution-test-budget.zh.md)

## Problem

`scripts/benchmark-npm-resolution.spec.ts` starts a real npm process against a local metadata-only registry. Three behavior tests gave that child process 10 seconds. The manual benchmark is not a release-time performance promise because npm resolution time varies with machine load, but the test-only child deadline treated a slower Windows coverage runner as a product failure. The fork's two-partition Windows coverage lane reproduced the same timeout twice while more than 15,000 other tests passed. One run also reached temporary-directory cleanup while npm still held files open, producing `EPERM` after the timeout.

## Decision

Use one explicit test deadline for the three successful npm-resolution cases: 60 seconds on Windows and the existing 10 seconds elsewhere. The tests continue to require a successful package lock, registry metadata requests, no archive request, the expected alias placement, and isolation from inherited npm configuration. Production benchmark defaults and command timeout behavior do not change.

The Windows allowance stays 30 seconds below the coverage lane's 90-second per-test budget so teardown can finish within the same test budget. It gives the real npm child time to finish and release its temporary files without turning this behavior suite into a resolver speed check.

## Verification

- `pnpm exec vitest run scripts/benchmark-npm-resolution.spec.ts`
- `pnpm run doc-sync`
- The blocking `windows node 24 / coverage` pull-request job exercises the Windows-specific 60-second path.

## Alternatives considered

**Increase the production benchmark default.** Rejected because the failing value belongs only to behavior tests. The manual command already defaults to 300 seconds, and its optional duration threshold remains caller-owned.

**Skip the npm process tests on Windows.** Rejected because Windows package-lock generation and temporary-file release are useful cross-platform evidence. A larger safety deadline preserves that evidence without asserting runner performance.

## Consequences

Windows runner contention may lengthen these three tests without failing unrelated pull requests. A genuinely stuck npm process still fails after 60 seconds, while non-Windows feedback keeps the existing 10-second limit.
