# Agent Note: Budget the macOS native staging fixture

Status: implemented

English | [中文](2026-10-24-macos-native-fixture-budget.zh.md)

## Problem

The [native staging spec](../../../../scripts/mantur-cut-resources.spec.ts) awaits compilation, Mach-O inspection and relocation, ad-hoc signing and verification, and three signed executable exits. A measured run contains 33 successful commands with no signal or spawn error; their total duration is 6.99 seconds, including 6.19 seconds for the three executable launches alone. The default 5-second test deadline also fails at 8.32 seconds in the baseline and 7.12 seconds in an independent review run. A reported 3.8-second default-budget pass shows variation, not a consistently sufficient deadline. The specific macOS startup-delay cause remains unproven.

## Decision

Only the macOS native case has a 30-second test-budget floor, matching its existing per-command allowance. This is a bounded policy choice supported by measured completed work, not a measured worst-case bound. The file's shared temporary-directory cleanup has the same floor on macOS so teardown can await removal under host contention; other platforms retain their configured hook budget. Both floors preserve higher budgets supplied through `DSH_COVERAGE_TEST_TIMEOUT_MS`, using the existing coverage-budget parser. A standalone CLI timeout does not override these explicit local values. The Windows coverage lane's 90-second setting is not a pre-existing macOS allowance; this native case is skipped on Windows.

## Alternatives considered

**Keep five seconds.** Successful measured child execution alone exceeds that limit; a faster rerun does not invalidate that evidence.

**Mock, retry, skip, or widen global budgets.** These either remove real native loading evidence or change unrelated tests. Assertions, platform skips, command deadlines, and global configuration remain intact.

## Consequences

This adjusts test scheduling tolerance and does not repair product relocation, signing, or macOS startup latency. It preserves the [staging decision](../bug-fix/2026-09-09-mantur-native-resource-staging.md). Synchronous child waits retain their existing limitations: the outer Vitest deadline is not a hard interrupt of a blocked command, and 30 seconds does not guarantee all commands can consume their individual maxima. Cleanup has no separately measured 30-second requirement; its matching floor follows the repository's paired test/hook budgeting rule. Slower failures can take longer to report.

Focused validation passes with default runner settings and with a 90-second coverage-environment test/hook budget. The native spec retains real compilation, signing, executable-output and recursive relocation assertions; this evidence does not cover application packaging or release acceptance.
