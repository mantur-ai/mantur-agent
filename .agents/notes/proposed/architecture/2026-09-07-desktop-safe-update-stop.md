# Agent Note: Explicit desktop update shutdown

Status: proposed

English | [中文](2026-09-07-desktop-safe-update-stop.zh.md)

## Problem

An installer needs proof that local execution has stopped and its final records are durable. Cordis disposal contains cleanup failures, ordinary agent cancellation clears pending input, and a persistence writer can leave its active registry after a failed close. None of those completion signals alone authorizes installation. Input claimed before asynchronous prompt assembly also needs an explicit execution-stage record to distinguish recoverable input from work that may already have executed.

## Proposal

The desktop update owner first obtains the existing durable draft revision. A Host coordinator then synchronously freezes work admission, including factory startup and existing agents, stops local execution while preserving unexecuted input identities, and waits for tool results, maintenance, background processes, and PTYs. It must retain failures from every participating writer and reject unsupported producers rather than infer quiescence. Remote paid jobs are not canceled.

After every event producer has stopped, the coordinator obtains the final session records and durable flush results, prevents subsequent appends, and returns evidence bound to the exact update request. Installation requires this receipt and the draft revision. Neither child exit nor a generic disposer replaces the receipt; no event-producing cleanup follows the final checkpoint.

The local subprocess provider supplies an explicit stop operation that closes spawn admission, awaits owned trees and terminals, retains failed targets, and preserves the failure for repeated callers. This operation alone proves neither session durability nor complete Host shutdown. Remaining admission and persistence changes belong at the existing owners only where plugin hooks cannot enforce them; each affected upstream file requires a focused upgrade regression.

The [draft checkpoint decision](../../implemented/architecture/2026-09-06-desktop-draft-checkpoints.md) remains authoritative for draft storage. The [host-exit cleanup decision](../../implemented/bug-fix/2026-08-11-synchronous-subprocess-exit-cleanup.md) continues to own ordinary process exit. Neither decision is fully superseded.

## Alternatives considered

Stopping only registered agents misses unpublished setup and detached jobs. Calling disposal before flush can hide failed writers and clear queues. Retrying uncertain inputs can duplicate execution or charges. A generic replacement task runtime is unnecessary for this desktop operation.

## Acceptance criteria

- Deterministic barriers cover startup, inbox claim, maintenance, tool finalization, whole-tree exit, failed writer close, and late append; each unsafe outcome refuses installation.
- Repeated and stale update requests cannot install twice or release another request's lock.
- A new isolated process reloads the exact promised event range, pending message IDs, draft revision, and original image digests.
- Windows x64, Mac arm64, and Mac x64 each provide native durability and installation evidence for the final revision; mocked transports and cross-compilation do not satisfy this requirement.

## Risks

If draft saving fails, no task is stopped. If a later checkpoint fails after tasks stop, the Host remains visibly paused and installation is refused; interrupted work is not restarted automatically. Unknown producers, unavailable native durability, or missing release credentials remain explicit blockers. The supported local process-tree observer cannot certify arbitrary daemonized descendants outside its ownership.
