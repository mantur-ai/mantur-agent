---
description: "Mantur account first-run and Settings surfaces for maintainers composing the Mantur desktop client."
kind: "package-reference"
---

# `@deepseek-ai/dsh-client-ui-mantur-account`

English | [中文](README.zh.md)

## Summary

This browser package adds the first Mantur onboarding step and a Mantur Account settings page. The Host's explicit identity mode selects native desktop forms or the standalone device flow. Desktop users can log in with a password, submit pending registration with an emailed code, or continue Google authorization in the system browser. Account login and Not now remain independent of the existing model-credential step; account login does not configure a model or grant model quota.

The native preload publishes revisioned public account metadata, never the device bearer. Passwords and registration codes remain transient form inputs and named IPC arguments; the observable store retains neither. Missing native capability or failed identity selection reports an error without switching to standalone credentials. One client subscription serves onboarding and Settings, rejects stale replies, and polls pending browser authorization every two seconds. Reopening uses the saved attempt; passwords, registration and code requests are never retried automatically.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

## Model Experience

### Account surfaces

#### What the model sees

The `settings.onboarding` account surface remains browser presentation; its copy and state are never included in model requests.

#### Token effect

The account surfaces contribute zero tokens to model requests.

#### KV Cache effect

The account surfaces do not alter model request prefixes or cache reuse.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Native Not now waits for Main's persisted confirmation and survives renderer reload. Standalone Not now applies only to the current empty-session onboarding sequence.
- Native form and simulated-preload browser tests do not establish Electron, OS storage or real-site acceptance. The marketplace login gate and packaged CLI still require native integration acceptance.
- Skills already installed into the local live directory remain available when a maintainer changes the Host environment configuration.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Native onboarding and Settings share Main-confirmed expiry, registration, link-verification and pending-revocation state. Registration submission is not sign-in; offline status is not expiry. The standalone occupants retain their Remote controller. The embedded Google mark preserves the official PNG bytes and is not covered by the repository's software license; its source is recorded in `google-logo.ts`.

</details>

**Runtime invariant:** the account onboarding slot has order `-100`, before the existing DeepSeek step at order `0`. No runtime invariant companion is published. This browser package owns no durable event stream or cross-plugin mutable state; its registration order and effect disposal are observed directly by package tests.
