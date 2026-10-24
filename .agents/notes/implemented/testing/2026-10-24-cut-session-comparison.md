# Agent Note: Bound Cut session comparison

Status: implemented

English | [中文](2026-10-24-cut-session-comparison.zh.md)

## Problem

A recorded Cut workbench opens on an allocated loopback port and records its workspace directory in the system prompt. Exact replay comparisons need to account for those run-local values without hiding changed tool results, instructions, or lifecycle events.

## Decision

The [session snapshot library](../../../../packages/test-support/session-snapshot/README.md) owns an explicit Cut comparison adapter. It validates the workbench call and successful result relationship before mapping the two editor URL fields. The session header supplies cwd for the header, verified workbench directories, and declared system-prompt location. Identity mapping names observed event fields instead of treating arbitrary business identifiers as volatile. Verbatim payload normalization prevents generic path, spill, and usage substitutions; original prompt lengths preserve trailing newlines and sequence boundaries. The adapter compares the complete normalized session and complete prompt and tool-schema sequences; it does not remove events or rewrite source recordings.

## Alternatives considered

**Ignore workbench results or compare selected events.** This would accept missing lifecycle events and changed business content, so it cannot establish recorded-session equivalence.

**Use an unmaintained acceptance helper.** A task-local helper has no permanent negative controls or discoverable test owner. The shared test-support library provides those checks without changing the product Cut implementation or the default normalization policy.

## Consequences

Comparison establishes equivalence of its input artifacts, not execution of a GUI scenario. A complete Cut regression still requires a shipped-profile replay driver, a versioned live recording with source hashes, and an independently declared complete workspace oracle. A recording from an earlier product revision cannot establish GUI behavior of a later revision. Private recordings and credentials are not public fixture data.

The [adapter controls](../../../../packages/test-support/session-snapshot/tests/cut-comparison.spec.ts) reject invalid call/result binding and changed business content, lifecycle events, request headers, and fixture hashes. Synthetic controls verify the comparator; they are not live product recordings. The complete workspace capture remains owned by the existing [workspace helper](../../../../packages/test-support/session-snapshot/src/workspace.ts).
