# Agent Note: Telemetry is outside update save receipts

Status: implemented

English | [中文](2026-09-07-update-telemetry-scope.zh.md)

## Problem

The module-name gate rejects the default telemetry backend before authoritative saving begins, although telemetry delivery is not a user-data durability guarantee.

## Decision

The Mantur update policy accepts the shipped OpenTelemetry backend without making collector delivery a save prerequisite. JSONL session records remain authoritative. Telemetry copies those records to an external collector and does not rewrite the source log; its queue and delivery outcome do not establish whether user work was saved.

The Host save coordinator closes and verifies authoritative writers before issuing its receipt. Normal application-tree disposal still runs the existing telemetry coordinator and backend shutdown. The backend bounds its SDK wait with its configured deadline; the coordinator logs a warning if shutdown rejects. No new telemetry receipt, retry, cancellation path, configuration override, or provider substitution is introduced. Main still requires its owned Host to exit and the diagnostic log to close; this change does not authorize treating an arbitrary stuck process as a successful save.

## Evidence

The update integration mounts the actual telemetry backend through Loader, queues session events, and verifies the durable writer offset before any upload. A private collector rejects uploads with HTTP 503; ordinary disposal still contacts it, and fresh writer verification remains valid. Existing telemetry tests cover a blocked SDK shutdown deadline and retained shutdown warnings. The recorded CLI shutdown scenario includes the telemetry module in its disabled mode and preserves its original session log; this verifies module acceptance without contacting an external collector.

## Alternatives considered

**Require collector delivery.** A network outage would block installation even after local work was saved. **Skip telemetry disposal.** This would abandon its existing bounded shutdown and warnings.

## Consequences

This exception covers the shipped telemetry backend only. Dynamic Host code, unmanaged OS descendants, and editing/MCP operations that write user projects still require their own resource completion evidence. Authoritative settings, project records, user feedback, and session-write errors remain installation failures.
