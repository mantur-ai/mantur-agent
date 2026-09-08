# Agent Note: Editing drains before Host shutdown

Status: implemented

English | [中文](2026-09-08-editing-before-host-shutdown.zh.md)

## Problem

AgentLoop quiesce aborts admitted tool signals. Gateway and HTTP shutdown reject callbacks, and other producer stops can terminate workers or processes. Starting those operations while editing still awaits MCP results, attachment writes or browser saves can interrupt authoritative work.

## Decision

The Mantur coordinator first awaits each retained `manturEditing.stopForShutdown()` in an otherwise approved composition. The editing owner owns its phased cutoff: reject new Host open/execute requests; finish admitted MCP execution and attachment writes; close editor job admission and include UI work accepted before that actual cutoff; drain jobs and exports; finish browser and server saves; close its transport/server and observe its child close. The coordinator does not claim simultaneous Host and editor cutoff.

Until this phase succeeds, the coordinator preserves Agent/inbox admission, live signals, HTTP/Gateway callbacks, writers and other producers. It then starts its existing quiesce, network shutdown and producer drain before sealing authoritative writers. Editing failure is cached and prevents those later operations. Owners created during the editing drain are collected and drained too; owners appearing during later producer or settings cleanup prevent writer sealing. Subsequent receipt verification also rejects an undrained editing owner.

The module allowlist and codeRuntime/Host runner exclusions are unchanged. The real editing module remains excluded while browser and producer completion acceptance is incomplete. This change supplies Host ordering without granting installation admission or adding UI freeze notifications.

## Evidence

A controlled editing owner holds shutdown while real loopback HTTP and a real Typert Gateway remain usable. Its callback appends Session events before owner completion; the resulting checkpoint matches a freshly reopened physical JSONL log. Spies on actual shutdown methods show that AgentLoop quiesce and terminal/workflow/subprocess stops do not start during the hold. Error controls retain writers and callbacks after write failure, cancellation or unknown completion. Retired and newly observed owner controls exercise the phase transition. Moving quiesce or network shutdown ahead of the editing drain makes the callback test fail; restoring the order passes.

The combined owner regression uses a real AgentLoop, MCP HTTP transport, attachment store and native editing runtime with a scripted local model and fixture editor. An admitted tool signal stays live through its returned image write and editor drain; the saved image is readable and the physical session log survives runtime closure. Premature quiesce makes the signal assertion fail. The fixture editor does not establish browser job acceptance, project persistence, lease release or GUI installation; those require the real editor and browser composition.

## Alternatives considered

**Quiesce first.** It aborts accepted execution signals. **Close Host networking based on different origins.** Origin separation does not prove callbacks or Host dependencies have completed. **Treat producer stop as admission freeze.** Terminal, workflow and subprocess stop operations can cancel work. **Allow the editor module before integration.** A controlled owner cannot prove the real editor's completion guarantee.

## Consequences

A stalled editing owner keeps preparation pending and leaves its dependencies available. Main's expired wait does not authorize installation. A failed editing owner remains failed for the Host. Unknown producers and Shell completion scope still block release acceptance; this change neither introduces a permanent Shell policy nor proves all detached descendants ended.
