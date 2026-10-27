# Agent Note: Keep native export grants in the selecting document

Status: implemented

English | [中文](2026-10-27-mantur-native-export-recovery.zh.md)

## Problem

Mantur's native save selection supplies a JavaScript file adapter whose methods relay writes to the parent window. IndexedDB cannot clone those functions, so persisting a server export job with that adapter rejects before rendering begins.

## Decision

The Mantur adapter records its own temporary handles in a WeakSet. The export recovery store persists their file descriptor with a null handle and retains the active destination in the selecting document, keyed by render ID. The in-memory destination changes only after the database transaction commits. Successful removal clears it. A new document restores the descriptor without authority and uses the existing explicit destination selection flow. Genuine browser FileSystemHandle objects retain their existing IndexedDB storage behavior.

The [embedded export decision](2026-10-26-mantur-cut-embedded-export.md) retains ownership of native selection, relay and cleanup. This behavior lives in the editor shutdown patch; no Harness core interface changes. The source manifest binds the patch digest and resulting editor tree. The editing package [README](../../../../packages/client/ui-mantur-editing/README.md) owns the consumer behavior.

## Alternatives considered

**Swallow the clone error.** This would let rendering proceed without the required durable recovery record and would hide other storage failures.

**Persist the native grant.** A stored grant must not authorize writes after the selecting editor document has closed. Reconstructing an adapter from persistent grant data would bypass explicit reselection.

**Add another destination transport.** The existing file writer and recovery descriptor already express the required same-document and reauthorization behavior. A second write transport would duplicate those paths.

## Consequences

The native destination remains usable for current-document stage updates and retries. Reloaded recovery requires a fresh user selection. Genuine browser handles remain recoverable. Failed writes and deletions preserve the previously committed in-memory destination.

The editor command `verify:mantur-export-recovery` exercises real Chromium IndexedDB with an installed browser supplied by `CC_EXPORT_RECOVERY_BROWSER`; it never downloads a browser. It covers the unsanitized clone failure, production recovery-store transitions, rebinds, failed transactions, deletion, new-document reselection and a genuine FileSystemFileHandle. The native picker and relay responses are test fixtures, so this check does not replace signed-application GUI acceptance.
