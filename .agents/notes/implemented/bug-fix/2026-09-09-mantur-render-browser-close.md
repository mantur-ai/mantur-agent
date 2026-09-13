# Agent Note: Confirm render browser process and pipe closure

Status: implemented

English | [中文](2026-09-09-mantur-render-browser-close.zh.md)

## Problem

The embedded editor refuses installation preparation after any rendering browser has been acquired. The pinned renderer's public close operation waits for process exit, but does not expose the child's close event after its output pipes close. Successful video export therefore does not establish complete shutdown.

## Decision

The editor's install-time patch checks the reviewed original and patched SHA-256 values of both CommonJS BrowserRunner and the ESM renderer bundle. It attaches a close-event listener immediately after spawn, before asynchronous browser setup, and exposes the promise on that runner. Unknown dependency bytes reject installation. Both module faces are checked before modification, and existing license notices remain.

The editor retains one cleanup promise per browser and waits for both the public close operation and the recorded process-and-pipe closure. Only that completion releases the pending browser count. Missing evidence, incomplete closure and cleanup failures still block installation. Rendering and cleanup errors remain independently observable. No process-global spawn interception, PID polling, timeout-as-success or signing-policy change is introduced.

Media subprocess failures retain their existing rejection behavior and include an operation label, executable basename and PID. Arguments, credential values and full paths are not added to these diagnostics. An unexplained SIGKILL in an earlier isolated export remains a failure even if a subsequent export and shutdown pass.

## Verification

Patch checks cover both module faces, known-source idempotence and unknown-source rejection. A controlled close barrier proves that resolving the browser close operation before its process-and-pipe promise does not complete shutdown. Tests preserve missing-evidence rejection and simultaneous render/cleanup failures. A real browser probe and isolated native editor export exercise the dependency patch; final signed-candidate acceptance remains a separate check.

## Alternatives considered

Trusting the public browser close operation leaves the process-and-pipe completion unobserved. Removing the pending-browser check would report unsupported shutdown success. A process-global spawn wrapper affects unrelated producers. The version-pinned dependency patch exposes the missing observation at its actual owner without changing these policies.

## Consequences

The dependency remains pinned to the reviewed renderer version. A version or source change requires reviewing and updating both byte identities. Source records include the install-time patch, its verification and the editor shutdown implementation. One passing diagnostic export is not evidence that an earlier unexplained process termination has been eliminated.
