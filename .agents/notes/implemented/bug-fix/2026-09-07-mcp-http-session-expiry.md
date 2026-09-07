# Agent Note: Recover an expired MCP HTTP session without replaying calls

Status: implemented

English | [中文](2026-09-07-mcp-http-session-expiry.zh.md)

## Problem

The MCP SDK reports a missing Streamable HTTP session through `onerror` with a structured HTTP 404, retaining the old session id without firing `onclose`. The existing supervisor therefore leaves a connected-looking client whose later calls repeat the same failure. This occurred after an applied editing draft was read through its terminal edit-session id; saved edits remained intact.

## Decision

The MCP client recognizes only a current generation that completed connection and discovery, has an assigned HTTP session id, and receives the SDK's `StreamableHTTPError` with code 404. It marks that generation unavailable immediately, withdraws its tool registrations through the existing sync queue, closes its local Client, and waits for both close completion and the transport close signal. The existing five-second close bound stops recovery when closure cannot be established. A quiescent generation enters the existing bounded reconnect policy with the same endpoint and credentials and a fresh SDK Client and transport.

Generation checks prevent stale tool-list responses from replacing current registrations, held executors from sending requests, and late call responses from being reported as successful after their generation retires. Concurrent expiry signals retire a generation once. Disposal cancels backoff and awaits any owned retirement. Startup endpoint errors, HTTP 401/403, ordinary JSON-RPC errors and tool errors do not enter the expiry path. Stdio keeps its existing reconnect and registered-tool behavior.

This is a narrow exception to the HTTP and tool-retention decisions in the [auto-reconnect note](../feature/2026-08-06-mcp-client-auto-reconnect.md); the original attempt budget, stability window and stdio alternatives remain applicable. No agent-loop or editor protocol change is required. HTTP expiry removes tools even when automatic reconnect is disabled. A successful reconnect discovers tools but does not restore server-side project bindings or editing-draft ownership. No failed tool call is replayed, and local close cannot establish whether a remote mutation committed.

## Alternatives considered

**Retry the failed tool call after initialization.** A mutation may have committed before the response failed. Replaying imports, timeline edits or review could duplicate work. Explicit continuation must first inspect saved state.

**Treat every transport error as expiry.** Authentication failures, ordinary tool errors and network interruptions do not establish a missing MCP session. They retain their existing failure paths; no string-message matching or provider switching is introduced.

**Recover through an editing-specific reconnect API or weakened owner checks.** The defect belongs to the shared HTTP supervisor. A new API would leave other MCP clients broken, while accepting an old draft owner after fresh initialization would bypass the editor's ownership and revision rules.

## Verification

Real HTTP tests cover initialization without an old session id, one failed wire call without replay, concurrent failures, close completion and timeout, disposal, disabled recovery, exhausted budgets, ordinary errors, independent Agent scopes and server namespaces. Controlled late responses verify tool-list and executor generation checks. Existing stdio and native MCP tests cover normal connections and crash recovery.

The keyless Web recorded session drives the real Loader and MCP client through a failed call, tool removal and an explicit call after fresh initialization. A server-owned initialization barrier keeps the unavailable interval deterministic; the complete persisted session, tool errors and three request headers are compared. The model and remote MCP endpoint are explicit fixtures. This proves integration and logging, not natural-language editing quality or recovery of a live editing project.

## Consequences

HTTP expiry changes the model-visible tool list during recovery. This costs prompt-prefix reuse but prevents a missing session from remaining advertised as usable. An already-sent remote mutation can still have an unknown outcome. The editing Agent must bind to the browser project and inspect its saved assets and timeline before a new draft; reconnect alone never means an edit or export completed.
