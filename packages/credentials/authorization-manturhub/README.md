---
description: "ManturHub device authorization provider and browser-safe account Remote for the Mantur desktop profile."
kind: "package-reference"
---

# `@deepseek-ai/dsh-authorization-manturhub`

English | [中文](README.zh.md)

## Summary

This Host package routes ManturHub requests to the selected production or test deployment. `standalone` identity owns per-origin credential records and device-code flows; `desktop-managed` identity delegates to Electron Main and never reads those records. The generated Remote exposes the identity mode and sanitized account status, never an API key or environment configuration.

## Table of Contents

- [Configuration](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="configuration"></a>

## Configuration

`environment` defaults to `production`. `baseUrl` defaults to `https://hub.mantur.ai` and names the production origin; `testBaseUrl` names the optional test origin and is required before `test` can be selected. Both values must be HTTP(S) origins without credentials, paths, queries, or fragments, and the test origin must differ from production. Maintainers select the environment through the `mantur-account` row in a machine-local `cordis.patch.yml`; the account browser Remote cannot read or change it. Restarting the desktop application after a change clears its in-memory account and marketplace state.

`identity` defaults to `standalone`. In this mode, the public production origin retains the original credential key; other origins use environment-and-origin-specific keys. Changing a test URL therefore starts signed out. Grants remain in the credential provider, never in the patch file.

`desktop-managed` requires an Electron parent IPC channel and explicit `native` settings: `environmentLabel`, `requestTimeoutMs`, `maxResponseBytes`, `leaseMs` and `revocationRetryMs`. The Mantur desktop profile supplies these budgets. Main validates the selected origin before the provider becomes available. Authenticated GETs retain their broker scope through response EOF or cancellation. A command environment lease may be released only after the command consumer confirms whole-tree cleanup. Connection disposal aborts scopes and waits for those receipts. Missing Main or invalid managed identity fails without consulting standalone storage. Native account actions belong to the guarded preload bridge; legacy device-login Remotes reject them.

The native provider registers with [command-scopes](../../shell/command-scopes/README.md). Bash, PowerShell and persistent terminal allocation prepare identity before spawning and acknowledge release only after whole-tree cleanup. A signed-out command receives explicit desktop-managed mode and an empty descriptor path, overriding stale caller environment.

Standalone device login rejects a verification URL on another origin. A session that omits `interval` or `expires_in` uses 5 seconds and 600 seconds. `slow_down` adds 5 seconds to the active polling interval; denial and expiry end the attempt without a credential.

## Model Experience

### Account authorization

#### What the model sees

The `manturAccount` authorization state remains outside every model request; no account identity, device code, or credential is included.

#### Token effect

The authorization flow contributes zero tokens to model requests.

#### KV Cache effect

Authorization does not alter model request prefixes or cache reuse.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Standalone login attempts are process-local; standalone sign-out removes only the local grant.
- Native forms, packaged CLI integration and native OS acceptance remain incomplete. Loopback command tests do not establish test-site readiness. See the [native account proposal](../../../.agents/notes/proposed/architecture/2026-09-07-desktop-native-account-identity.md).

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The device and account endpoints are resolved from one configured origin. The package-owned bounded JSON reader is shared with ManturHub Host consumers so response buffering follows one implementation. Tests select a loopback fake server.

</details>

No runtime invariant companion is published because the authorization service both commits the credential and reports success, so no independently observed values can diverge.
