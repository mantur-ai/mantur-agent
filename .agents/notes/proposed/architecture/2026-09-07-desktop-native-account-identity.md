# Agent Note: Desktop native account identity

Status: proposed

English | [中文](2026-09-07-desktop-native-account-identity.zh.md)

## Problem

Desktop account login and the bundled ManturHub CLI need one device identity without copying a reusable account secret into renderer state, process arguments or shell environments. A lost provisioning response and an offline logout must not create an orphan credential or silently restore local authorization after restart.

## Proposal

Electron Main will own one profile-local installation identity and independent OS-sealed attempt and device secrets. The native-account-v1 protocol commits the full verifier-first request before network transmission and preserves the same request after an unknown result. Confirmed ready metadata, including the original credential expiry, precedes activation. The device grant expires after an absolute ninety days without refresh.

Main will provide native password login, public pending registration and a same-origin system-browser authorization page. Skip persists independently of model keys and drafts. The sandboxed renderer will receive only public account state and guarded named operations. Desktop-managed CLI commands will receive a private, expiring broker-v2 descriptor; Main attaches the actual device bearer upstream. Missing or invalid managed identity fails explicitly instead of reading standalone CLI credentials.

Local logout disables the exact record and aborts its accepted requests before remote cleanup. Main waits for response consumption and command-tree cleanup, not only abort dispatch. OS-encrypted pending cancellation or revocation material remains until exact remote HTTP 204 or original expiry. A ready attempt with an uncertain activation retains the credential's lifetime, not the shorter attempt lifetime. Network failure does not prove expiry.

## Partial implementation

The desktop [store](../../../../apps/desktop/src/auth/store.ts), [HTTP client](../../../../apps/desktop/src/auth/http.ts), [request ownership](../../../../apps/desktop/src/auth/access.ts) and [login controller](../../../../apps/desktop/src/auth/controller.ts) implement these internal operations. Electron Main, preload, the Mantur account provider, native UI and bundled CLI are not connected to these modules. Calling the controller's poll or revocation operation requires an explicit owner; the modules do not start background retry timers themselves.

## Alternatives considered

**Share the device bearer through renderer storage or CLI environment.** This exposes account authority beyond Main and does not provide per-command cancellation or expiry.

**Delete offline revocation material after seven days.** This prevents later remote revocation of a still-valid ninety-day credential. Retention ends only at confirmed revocation or its original deadline.

**Resume by minting another attempt or repeating a password.** A lost response does not prove that the server rejected the first operation. Recovery uses the committed identity and explicit server state, not a new credential or an automatic password retry.

## Acceptance criteria

The actual Main/preload/provider/UI path must exercise login, Skip, registration, browser authorization, restart recovery and partial logout failure against the frozen backend. The traceable bundled CLI must pass broker-v2 joint tests for environment isolation, descriptor permissions, process-tree ownership, expiry, logout, complete streaming cancellation and presigned uploads. Tests must demonstrate that renderer messages, command arguments and diagnostics contain no device bearer or password. Native Keychain and Windows DPAPI/ACL acceptance requires their actual platforms; substituted cipher tests do not establish it.

## Risks

The controller relies on its Main caller to await complete response consumption and command cleanup. Poll and revoke scheduling, guarded IPC, real OS integration and native UI remain required; internal unit tests alone do not make this proposal available in the client.

The [existing account onboarding](../../implemented/feature/2026-09-03-mantur-account-onboarding.md), [environment isolation](../../implemented/architecture/2026-09-03-mantur-environment-isolation.md) and [bounded marketplace JSON reader](../../implemented/simplification/2026-09-03-share-manturhub-json-reader.md) retain their current consumers and rationale. This partial desktop implementation does not replace those paths or authorize a legacy-credential fallback.
