# Agent Note: Desktop update save receipts

Status: implemented

English | [中文](2026-09-07-desktop-update-save-receipt.zh.md)

## Problem

A closed window, cancelled request, or exited child cannot establish that accepted operations and durable writes finished. Individual resource owners also cannot authorize installation without a consumer that orders their results.

## Decision

The Mantur bundle owns the Host update consumer; the CLI installs its inherited-IPC listener only for a desktop-owned launch. Main starts preparation after installation confirmation, saves drafts, accepts only a matching Host receipt, closes the account channel, and requests normal Host disposal through IPC. Main requires actual child exit and diagnostic-log closure before allowing the updater to install. Failure, cancellation, and deadlines deny installation.

The Host freezes agent admission, stops profile and preset changes, and joins drivers, native operations, Gateway/HTTP calls, and resource producers before closing settings, session writers, projection caches, and storage. It inventories every scoped service by owner identity and retains replaced instances. Fresh verification detects writes attempted after an earlier receipt and runs again after application-tree disposal before normal exit. Unknown modules, unmanaged OS descendants, module HMR, and compositions whose owners lack verified stop results remain unsupported. The policy never disables those modules or treats their exit as a save receipt.

The upstream lifecycle change is confined to [AgentLoop](../../../../packages/core/agent-loop/src/index.ts): `quiesceForShutdown()` separates driver and startup completion from published writer closure. Existing external hooks cannot stop the private driver while retaining its writer for an admitted RPC. The upgrade checks hold an actual Gateway invocation through shutdown, append its final Session events, and compare physical JSONL records with the returned offset. Core lifecycle regressions cover pending input, startup rollback, and retained writer failure. Startup cancellation accepts the owned abort reason or Node’s `AbortError` with `ABORT_ERR` and that exact reason as its cause; unrelated aborts and writer-close errors remain failures.

The independent CLI launch check exercises the production IPC listener, startup rollback, normal exit, and reopening the original stored log. Main tests hold save and exit separately and reject stale receipts, failed saves, cancelled waits, abnormal exits, log errors, and expired deadlines. The package payload gate in `scripts/check-workspace-constraints.ts` requires both Mantur update entries; its regression rejects a missing entry or an unexpected artifact. These checks do not install an update or prove unmanaged child-process containment.

## Alternatives considered

**Dispose the application tree as the save operation.** Cordis contains disposer failures, and driver disposal can close a writer before an admitted request finishes. Explicit owner results and ordered writer closure provide the required evidence.

**Terminate the child after saving drafts.** Main cannot infer Host log durability from draft storage or an exit code. A separate request-bound Host receipt must precede normal exit and final log closure.

## Consequences

Failed installation preparation can leave the Host frozen while cleanup continues. The application does not replay completed work or automatically restart queued work. Runtime retention keeps old owner objects until Host exit so replacement cannot erase cleanup evidence. Windows draft durability and unowned OS descendants remain independent blockers; passing coordination tests does not remove them.
