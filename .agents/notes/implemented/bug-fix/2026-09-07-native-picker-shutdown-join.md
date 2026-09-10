# Agent Note: Native picker shutdown joins child closure

Status: implemented

English | [中文](2026-09-07-native-picker-shutdown-join.zh.md)

## Problem

A caller's cancelled request is not evidence that its OS chooser has exited. Node's `execFile` can invoke the abort callback before child `close`; a Windows worker can report its result before its process and streams close. Connection cancellation alone also misses requests accepted before a browser connects. Releasing the Host at either point can leave a chooser running.

## Decision

The [native backend](../../../../packages/host/directory-picker-native/README.md) owns accepted requests through process closure and completed output reads. Its stable native capability exposes `stopForShutdown()`, which synchronously freezes admission, aborts the instance's requests, and joins them. Captured capabilities cannot admit work after the freeze. Plugin disposal uses the same stop; repeated calls retain its completion or cleanup failure.

The [command runner](../../../../packages/util/native-command/README.md) retains its child and settles only after `close`, preserving the original error fields. The Windows driver retains a reported outcome until child closure and joins outstanding `WM_CLOSE` calls. The existing retry and kill policy stays unchanged; refused or failed termination is retained as `NativeCommandCleanupError`. Ordinary chooser errors and user cancellation do not invalidate a completed cleanup. A child that never closes leaves stop pending; request rejection cannot stand in for proof of exit.

This adds native lifecycle ownership to the [capability seam](../architecture/2026-07-28-directory-picker-capability-seam.md), without changing its interaction split, the [adaptive composition](../feature/2026-07-29-directory-picker-adaptive-default.md), or the [Windows mechanism](../feature/2026-08-02-win32-in-process-folder-dialog.md). Those decisions retain their independent rationale. Shutdown is Host-only, not a Remote verb or a browse capability.

## Alternatives considered

**Rely only on connection abort.** It misses startup requests and cannot freeze previously captured capabilities or join a caller-cancelled child.

**Treat an abort callback or worker result as completion.** Both can precede process and stream closure. Unreferencing or forgetting the child hides unfinished cleanup.

**Change only the POSIX runner.** The Windows driver has the same result-before-close ordering; the public native stop promise must mean the same thing for both drivers.

## Consequences

Stopping one provider does not stop another Host's chooser. Callers retain normal selection, cancellation, and launch-error results, but those results wait for the owned process to close. Shared path-opening consumers also wait for their launcher process, not for the external application that launcher opens. A shutdown coordinator must cancel native picking before waiting for picker RPC drain; this package does not implement the coordinator or prove that unrelated OS children have exited.

Service and real Loader tests pin admission freezing, disposal joining, caller cancellation, instance isolation, and retained cleanup failures. A real POSIX child that ignores SIGTERM pins the gap between abort callback and `close`; restoring early settlement makes that test fail. Controlled Windows driver tests pin result/exit/close ordering, pending close-window calls, and termination failures. Native Windows dialog acceptance remains a separate platform check; controlled driver coverage does not replace it.
