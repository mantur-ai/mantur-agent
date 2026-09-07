# Agent Note: Drain owned MCP executions before transport shutdown

Status: implemented

English | [中文](2026-09-07-mcp-owned-shutdown.zh.md)

## Problem

Closing the MCP client can abort an accepted tool call before the remote reply or its local image attachment is saved. Cordis logs disposer failures, so awaiting a fiber's disposal does not prove that its connection, remote application or durable writes finished. An update coordinator needs an explicit result whose failures remain observable.

## Decision

The [MCP client](../../../../packages/mcp/mcp-client/README.md#owned-shutdown) owns an admission cutoff and each accepted executor promise, including attachment materialization. Its handle separates admission closure from transport disposal and permits the application's remote drain prerequisite. Closing admission preserves the current generation and caller's cancellation signal. A real cancellation remains a failure; the host coordinator must freeze new turns before this drain and postpone aborting accepted turns until it finishes.

Repeated shutdown requests share their original promise and failure. Transport completion requires both the close operation and its close notification; errors retained by failed or expired generations also prevent a successful result. Namespace release follows successful connection cleanup. A drain timeout leaves outstanding remote work running and rejects shutdown; it does not authorize installation or replay mutations.

This belongs in the existing shared connection implementation because the editing plugin cannot observe the executor's post-response attachment writes or the supervisor's retired transports. The affected upstream files are MCP `index.ts`, `connection.ts` and `tools.ts`; no agent-loop, Cordis disposer semantics or MCP wire protocol changes are required. The editing application remains responsible for its own jobs, project saves and subprocess close.

## Alternatives considered

**Await the plugin fiber alone.** Parallel, log-only disposers can release a namespace or close a transport before dependent work finishes. Their aggregate completion is not an authoritative success result.

**Detach accepted calls from cancellation or retry them after reconnect.** This would conceal user cancellation and could duplicate remote mutations whose first result is unknown.

**Treat HTTP close as a remote flush.** Local transport closure proves neither project persistence nor completion of paid work. An application-specific prerequisite must establish those facts through its existing runtime.

## Consequences

Shutdown can reject and leave resources reserved when cleanup is unconfirmed. This deliberately prevents a new owner or installer from treating an unknown state as finished. Recovery keeps its existing connection policy; successful reconnection does not erase a prior cleanup failure from the owner's shutdown result.

Upgrade evidence covers accepted late responses and image writes, new-call refusal, cancellation and persistence errors, owner drain failure and timeout, repeated shutdown, generation retirement, namespace ownership, and a close notification preceding its promise. A keyless recorded Web session pins the model-visible refusal and verifies zero remote mutation requests. These checks establish MCP ownership; they do not establish a complete editor or Host shutdown.
