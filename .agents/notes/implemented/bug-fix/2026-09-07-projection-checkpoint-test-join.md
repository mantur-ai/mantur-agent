# Agent Note: Join overlapping checkpoint writes

Status: implemented

English | [中文](2026-09-07-projection-checkpoint-test-join.zh.md)

## Problem

The projection-cache ordering test released the first write's durability barrier and then polled the stored row with a separate one-second deadline. Windows CI observed the creation checkpoint while the assertion expected the later turn checkpoint. That observation alone does not distinguish a delayed write from an ordering defect.

## Decision

The test observes both real `SessionProjectionCache.write()` calls. It holds the first durability barrier, verifies that the second barrier has not started, releases the first, and joins both returned promises before reading the actual stored row. Cleanup releases the controlled barrier, joins admitted writes, and restores both spies. Product persistence and timeout settings remain unchanged.

## Verification

A temporary 1.2-second delay in the second durability barrier makes the original test fail and the revised test pass. Removing the per-session write chain makes the revised test fail. The normal projection-cache tests verify the final fixture without either injection. These controls demonstrate the assertion's deadline race and retained ordering check; they do not establish the cause of the original CI delay.

## Alternatives considered

A longer poll adds another arbitrary storage deadline. Calling `write()` from the assertion creates another checkpoint and could conceal a missing mandatory write. Neither tests completion of the two operations triggered by creation and turn end.

## Consequences

The runner's existing test budget still bounds a stalled write. Missing writes, rejected writes, concurrent durability barriers, and an incorrect final stored row fail the test.
