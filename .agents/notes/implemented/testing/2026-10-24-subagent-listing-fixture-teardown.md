# Agent Note: Drain listing fixture caches before teardown

Status: implemented

English | [中文](2026-10-24-subagent-listing-fixture-teardown.zh.md)

## Problem

The [subagent listing fixture](../../../../packages/subagent/subagent/tests/list-children.spec.ts) owns a Context and private JSONL and projection-cache directories. Session creation schedules a checkpoint independently of listing completion. Removing directories while that write is admitted permits asynchronous filesystem work to race recursive removal; aggregate coverage exposed ENOTEMPTY in fixture cleanup.

## Decision

The fixture registers each Context immediately after construction. Its shared asynchronous cleanup awaits projection-cache shutdown before disposing the Context, then removes the directories. Cache shutdown must precede Context disposal because concurrent fiber disposers can close the storage domain before an admitted checkpoint reaches its write queue. This ordering applies the projection-cache ownership described in the [agent shutdown writers decision](../architecture/2026-09-07-agent-shutdown-writers.md), using existing service operations without changing runtime implementation.

## Alternatives considered

**Only await Context disposal.** A checkpoint held before the domain write queue rejects with a closed-domain error when disposal closes storage concurrently. Explicit cache drainage preserves the admitted write before storage teardown.

**Retry deletion or delay cleanup.** Neither establishes that writers have stopped. The fixture retains its existing JSONL removal policy and adds no cache-directory retry or scheduling delay.

## Consequences

Cleanup now pays for admitted cache writes and Context teardown, including partially initialized fixtures. A barrier regression holds a real cache write before its domain put, verifies that cleanup preserves the directory, then verifies the durable record before allowing directory removal. The same barrier fails with direct deletion both with and without V8 coverage. This fixture fix does not establish a general ordering guarantee for concurrent Cordis disposers; runtime shutdown ordering remains owned by the runtime components.
