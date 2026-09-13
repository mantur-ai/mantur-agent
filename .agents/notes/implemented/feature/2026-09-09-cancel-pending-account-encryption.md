# Agent Note: Cancel pending account encryption

Status: implemented

English | [中文](2026-09-09-cancel-pending-account-encryption.zh.md)

## Problem

Initial browser login awaits operating-system encryption before creating an authorization attempt. Skip aborts that login but waits for its foreground operation, so an unresolved cipher call keeps both login and Skip busy.

## Decision

The desktop controller makes its wait for the initial sealed write cancellable. The store retains the underlying operation for shutdown and checks cancellation before encryption and before the SQLite commit. Cancellation releases the callback listener and foreground state without accepting a late encrypted result. No server request precedes a successful encrypted commit.

## Alternatives considered

Opening the website before durable storage weakens response-loss recovery. A timeout that merely clears busy state leaves the original login able to continue. Cancelling the caller's wait while retaining the store's ownership preserves both explicit cancellation and durable request ordering.

## Consequences

Skip can finish during first-write encryption. Existing account cleanup and shutdown still wait for their owned operations; this change does not dismiss system dialogs or establish the cause of a reported packaged-client failure. Controlled tests cover late encryption success and rejection, rejection of initialization and decryption, and retry after failure. The assembled UI replay covers returning to an unsent draft during pending login preparation. Real operating-system and website acceptance remains separate.
