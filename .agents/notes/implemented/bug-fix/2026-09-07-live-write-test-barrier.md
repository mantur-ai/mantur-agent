# Agent Note: Await the scheduled persistence write

Status: implemented

English | [中文](2026-09-07-live-write-test-barrier.zh.md)

## Problem

The JSONL batching test advanced the batching clock and then polled storage with a separate one-second deadline. A scheduled write that had not finished by that deadline failed the test even though the batching timer had fired. CI reported an empty stored event list in this assertion.

## Decision

The shared live-write fixture observes the real storage method without replacing it. It asserts that the method has not started before the batching window and starts exactly once at the deadline, awaits that call's returned promise, and reads the stored events. The test restores its observer and closes its handle and context in cleanup. No product behavior or timeout changes.

## Verification

A temporary controlled delay before the real storage write makes the original polling assertion fail and the updated fixture pass. The normal JSONL owner suite verifies the final fixture. The delay demonstrates the assertion's independent deadline race; it does not establish the exact cause of the original CI storage delay.

## Alternatives considered

Increasing the polling timeout adds another arbitrary storage deadline. Calling flush can start the write itself and conceal a broken batching timer. Neither proves the scheduled operation that this test owns.

## Consequences

The runner's existing test budget bounds stalled storage. A missing timer, duplicate storage call, rejected write, or incorrect durable events still fails the test.
