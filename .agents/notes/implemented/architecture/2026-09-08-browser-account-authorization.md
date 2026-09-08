# Agent Note: Browser account authorization

Status: implemented

English | [中文](2026-09-08-browser-account-authorization.zh.md)

## Problem

A desktop account and its embedded CLI need one revocable device identity. A separate password form duplicates website login, while sharing a website Cookie or platform Key exposes reusable account authority. Lost responses and old authorization attempts must not revive or revoke a newer login.

## Decision

[Main](../../../../apps/desktop/src/auth/controller.ts) implements browser-account-v2 with an external browser and an exact random IPv4 loopback callback. It checks state and issuer before exchanging a one-use code with PKCE. The complete create request and exchange identity are OS-encrypted before network transmission; the code is encrypted before exchange. The renderer receives public state and named actions, without URLs containing state, passwords or secrets. Confirmed exchange metadata precedes sign-in and window activation.

The backend protocol fixes a device grant to one explicitly selected default policy Key and one authorization generation. Only explicit website consent can initialize a missing default Key. An inactive default fails instead of selecting another Key. Logout revokes the device grant, not the shared policy Key. Main verifies issuer, environment, device, generation and original expiry; backend per-request policy enforcement remains required.

Response-loss recovery retries the exact encrypted exchange before the original attempt deadline. Restarting without a saved code cancels the original attempt; Main does not register a replacement listener or create another grant automatically. Cancellation immediately disables local access. Unknown exchange outcomes retain cleanup proof until HTTP 204 or the attempt expiry plus the protocol's maximum ninety-day grant lifetime. An old success receipt rejected as superseded, revoked or expired cannot enable local requests.

The [embedded CLI](../../../../apps/desktop/cli-runtime/README.md) is an unmodified fixed archive with a separate production lock. Main provides a profile-local launcher using the application's Electron Node runtime and desktop-managed identity. Broker-v2 keeps the upstream device secret in Main and grants the CLI only a private per-command descriptor. Missing resources or identity fail explicitly. These changes use desktop ownership and existing authorization/command plugins; no agent-loop change is required.

## Alternatives considered

**Native password and registration forms.** The user selected existing website login and device consent as the only desktop login path. The browser flow replaces the corresponding v1 sections of the [native account proposal](../../proposed/architecture/2026-09-07-desktop-native-account-identity.md); its broker ownership and native-platform acceptance requirements remain relevant.

**Copy a Key or reuse a global CLI login.** Separate credentials cannot guarantee immediate local account switching and logout. The embedded CLI uses the same Main grant through broker-v2.

**Retry with a new request or infer another default Key.** A lost response can already have committed an authorization. Exact finite replay and explicit policy selection preserve identity and revocation.

## Consequences

Account storage version 2 rejects other nonempty versions without automatic migration. No compatibility mode opens the old native forms or sends v1 credentials. The production default remains `https://hub.mantur.ai`; test configuration explicitly selects `https://hub.mantur.cn`, with no cross-origin retry.

Local HTTP, SQLite, callback, Loader and CLI tests exercise controlled data. Electron Node-mode CLI balance verification uses a local fixture response, not a real account or the Java service. Simulated-preload browser snapshots prove presentation and draft preservation only. Same-version Java/PostgreSQL 16 integration, real website consent, native Keychain/DPAPI and Windows ACL execution, packaged resources and platform-specific browser return remain acceptance work. No local result authorizes remote deployment or real Key creation.
