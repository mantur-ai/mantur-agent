# Agent Note: Observe CI fixture completion

Status: implemented

English | [中文](2026-09-07-observe-ci-fixture-completion.zh.md)

## Problem

The projection-cache threshold test polled a JSON file for five seconds after scheduling a write. This coupled a count-policy assertion to filesystem latency. Team mailbox coverage also depended on asynchronous recovery reaching a persisted receipt after its target left the live registry. The npm resolution benchmark used immediate recursive removal after its child exited, although Windows can retain temporary-directory handles briefly.

## Decision

The [cache threshold test](../../../../packages/session/session-projection-cache/tests/cache.spec.ts) observes the real `write` promises, checks that two events schedule no extra write, and checks that the third schedules exactly one. It reads the stored value only after that write completes; it does not invoke a manual flush to satisfy the assertion.

The [Team mailbox fixture](../../../../packages/experimental/agent-team/tests/team.spec.ts) persists a target receipt, awaits its live acknowledgement work, stops the target, and then queues the Lead message. Dispatch must acknowledge the stored receipt without resuming the target, delivering another prompt, or making a model request. The Lead's stored log must contain exactly one delivered event.

The [npm benchmark](../../../../scripts/benchmark-npm-resolution.ts) removes its consumer directory with the existing [junction-safe cleanup helper](../../../../scripts/test-fixture-cleanup.ts) after the child and registry server close. The helper's bounded retry handles delayed Windows file release and still propagates exhausted cleanup failures. The [npm test deadlines](2026-09-04-windows-npm-resolution-test-budget.md) remain unchanged.

The [snapshot child-turn waiter](../../../../packages/test-support/session-snapshot/src/harness.ts) owns its polling deadline and awaits each filesystem harvest. Vitest can time out an asynchronous callback before it has produced a child-specific diagnostic; an owned loop reports the child and required turn after the current read settles. Expiration never permits an already-started read to overlap scenario cleanup, and a completed read after the deadline cannot turn expiration into success.

## Alternatives considered

Longer per-fixture polling deadlines still measure storage latency instead of completed writes. Repeating a mailbox scenario does not ensure it takes the cold-receipt path. Ignoring cleanup errors leaves temporary data behind. None of these establishes the required result.

## Consequences

Fixture assertions observe completed operations and exact durable results. The tests retain their coverage thresholds, and a rejected write or exhausted cleanup still fails. Local passing evidence does not establish Windows execution; the Windows lane remains required.
