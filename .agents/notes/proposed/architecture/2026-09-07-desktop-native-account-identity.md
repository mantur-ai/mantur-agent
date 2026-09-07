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

The desktop store, HTTP client, request owner and login controller implement provisioning and exact-grant cleanup. [Main](../../../../apps/desktop/src/auth/host.ts) configures them from the Mantur provider over child IPC, owns the revocation retry timer and exposes frame-bound preload operations. The [Host connection](../../../../packages/credentials/authorization-manturhub/src/native.ts) retains streaming responses through EOF or cancellation. Its disposal aborts command scopes but cannot send cleanup receipts on behalf of a command consumer. Main retains each private broker-v2 descriptor until that consumer releases it. The public snapshot reports a locally active, unexpired grant independently of an offline validation failure.

Local disallowance takes precedence over persisted active metadata in the public snapshot and command admission. A failed logout write leaves local access blocked and reports `logout-storage`; it does not report durable logout or confirmed remote revocation. The retained record permits an explicit retry.

The shell and terminal consumers prepare identity through command-scopes before process allocation. Whole-tree cleanup and Main release acknowledgment precede completion; canceled preparation also joins late allocations. Real Main, Loader, provider, Bash and frozen unpacked CLI tests cover balance, signed-out isolation and streaming logout cancellation. The real persistent terminal path retains its descriptor across sends and joins logout cleanup. The terminal test substitutes only an idle agent owner, not the Loader, backend or OS process. Packaged CLI invocation and native OS acceptance remain incomplete.

The [account UI](../../../../packages/client/ui-mantur-account/README.md) selects its form from the Host's identity mode, not the presence of a browser global. Native forms and Settings share a preload observer that checks operation ownership and Main revision before applying account state, errors or form outcomes. Password and registration inputs are transient; Main owns attempt recovery, fixed-URL reopening, persisted Skip and exact expiry. An absent bridge fails explicitly. Pending registration never reports authentication, and offline revocation remains visible. Real Loader/browser tests use a simulated public preload and do not establish Electron or real-site acceptance. Marketplace login routing remains incomplete.

## Alternatives considered

**Share the device bearer through renderer storage or CLI environment.** This exposes account authority beyond Main and does not provide per-command cancellation or expiry.

**Delete offline revocation material after seven days.** This prevents later remote revocation of a still-valid ninety-day credential. Retention ends only at confirmed revocation or its original deadline.

**Resume by minting another attempt or repeating a password.** A lost response does not prove that the server rejected the first operation. Recovery uses the committed identity and explicit server state, not a new credential or an automatic password retry.

## Acceptance criteria

The actual Main/preload/provider/UI path must exercise login, Skip, registration, browser authorization, restart recovery and partial logout failure against the frozen backend. The traceable bundled CLI must pass broker-v2 joint tests for environment isolation, descriptor permissions, process-tree ownership, expiry, logout, complete streaming cancellation and presigned uploads. Tests must demonstrate that renderer publications, command arguments and diagnostics contain no device bearer or password; password submission uses only its guarded transient IPC operation. Native Keychain and Windows DPAPI/ACL acceptance requires their actual platforms; substituted cipher tests do not establish it.

## Risks

The controller relies on its Main caller to await complete response consumption and command cleanup. A disconnected child cannot attest that orphan descendants have stopped; shutdown must report that missing proof. Complete native UI integration, packaging and OS acceptance remain required; internal tests alone do not make this proposal available in the client.

The [existing account onboarding](../../implemented/feature/2026-09-03-mantur-account-onboarding.md) retains its standalone consumers. [Environment isolation](../../implemented/architecture/2026-09-03-mantur-environment-isolation.md) and the [bounded marketplace JSON reader](../../implemented/simplification/2026-09-03-share-manturhub-json-reader.md) still apply. Desktop-managed identity replaces the desktop credential source explicitly; it never falls back to standalone credentials.
