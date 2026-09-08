# Agent Note: Confirm editing saves before closing the owned runtime

Status: implemented

English | [中文](2026-09-08-mantur-editing-owned-shutdown.zh.md)

## Problem

An editor can return a tool result or HTTP response while attachments, generation cleanup, debounced project saves or ownership releases are still writing. Closing its page, connection or process at that point can lose accepted work. A successful termination signal does not prove that the work finished.

## Decision

The [editing plugin](../../../../packages/client/ui-mantur-editing/README.md) exposes a cached `stopForShutdown()` result. It retains startup and runtime owners, closes new opens and MCP admission, and uses the existing [MCP execution drain](2026-09-07-mcp-owned-shutdown.md) before the editor drain. Agent context, signals, attachment services, HTTP and browser pages stay alive during this prerequisite.

The editor uses its existing authenticated browser poll/result channel for private freeze and flush controls. Browser input stops before accepted operations finish, so those operations can still submit backend jobs. The subsequent backend cutoff rejects new work and waits for original request/job promises, including post-response cleanup. Final saves cover mounted autosave debounce, drafts, run ledger and leases, generation acknowledgements and the authoritative project store. Browser unregistration must finish its durable ownership release before the editor confirms its drain.

Native MCP closure follows the editor acknowledgement. A real MCP GET SSE handler resolves only after stream closure, so it cannot be part of the save drain that precedes client closure. Exact MCP GET and DELETE handlers retain their original completions in a separate transport owner. Development and packaged adapters await that owner after client closure and before HTTP closure, preserving late handler failures. The runtime adapter then closes its server; the Host waits for the exact child process `close`, including pipes. A timeout, cancelled operation, retained write failure or unknown producer rejects the cached result without forced termination. Normal fiber disposal is not evidence of success.

The third editor patch owns this behavior above the frozen base and packaged patches. No dependencies, audio finalizer or public MCP protocol change. The integration records exact media children at owned spawn sites; it does not scan machine processes. The owned Remotion wrapper preserves browser-close failures and records actual browser acquisition. Remotion 4.0.509 supplies no supported process-and-pipe close evidence, so acquisition prevents successful shutdown even if its close promise resolves.

Desktop source configuration and resource manifests use format version 2 for the three-patch program. The builder checks each patch digest and intermediate Git tree, records the shutdown-patched final tree and all three source patches, and changes the distribution identifier with the complete source configuration. The packaged runtime rejects the older two-layer manifest version before opening a Session; older resource evidence does not validate this program.

## Alternatives considered

**Kill after a grace period.** This establishes termination but cannot establish that accepted writes, renderer descendants or paid jobs completed.

**Freeze every producer at once.** Accepted browser operations can submit jobs after their initial tool call. A simultaneous cutoff would reject that already accepted work.

**Expose another agent tool or replay failed mutations.** The existing authenticated editor channel carries lifecycle control; another editing channel or replay risks divergent state and duplicate work.

## Consequences

This is a strict, testable shutdown increment, not complete installation approval. Used unowned providers, renderer closure without supported evidence and retained callback errors remain blockers. The initial real-browser check saved a 150-frame solid clip and released browser ownership, then refused the drain because an earlier semantic-index request failed. The follow-up now asks the project store for actual vector availability before index operations; invalid or failed replies remain errors, and accepted mutations remain drain-owned. Exact extension and model catalog GET requests retain their original completion promises; installation and download requests remain unowned.

Focused evidence includes Host owner/process tests, a keyless recorded Web workflow, actual native broker cutoff and delayed ownership release, HTTP callbacks that outlive their responses, generation cleanup and persistence failures, and preserved render-close failures. The HTTP tests use controlled browser acknowledgements; a fresh real-browser follow-up saved one 150-frame solid clip, released its lease, completed the drain and confirmed actual child close without forced termination. This does not prove AgentLoop attachment handling, rendering or a full installed-client shutdown. Packaging and independent Host composition remain separate acceptance checks.

The real AgentLoop/browser composition of editor `08950ed` timed out after saving two solid clips and releasing the lease: the save drain awaited GET SSE while client closure awaited the drain. A real SDK regression reproduces that failure, then checks late save, GET and DELETE failures under the corrected order. The adapter regressions cover retained transport failure and completion before HTTP close. The complete browser composition still requires independent verification of the new increment.
