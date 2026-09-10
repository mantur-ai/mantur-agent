---
description: "Optional Mantur account Settings and dialogs for maintainers composing the Mantur desktop client."
kind: "package-reference"
---

# `@deepseek-ai/dsh-client-ui-mantur-account`

English | [中文](README.zh.md)

## Summary

This browser package adds optional Mantur account Settings and requested dialogs. It does not register a session onboarding step, so local session creation does not depend on account status. The Host's explicit identity mode selects desktop browser authorization or standalone device login. The desktop entry opens the system browser, where ordinary Mantur login and device consent take place. Cloud requests still require valid credentials.

The native preload publishes revisioned account display names, expiry and pending cleanup, never credentials, state-bearing URLs or authorization codes. One subscription serves Settings and requested dialogs. Main owns the callback, expiry and exact exchange recovery across renderer reloads. Older revisions and superseded action replies cannot replace the current account. Missing native capability reports an error without selecting standalone credentials.

The requested dialog uses `shell.overlay`. Return and Escape dismiss the view without cancelling Main's accepted operation; successful Not now persists the choice and cancels authorization. Repeated openings share one result. Another active modal, a busy operation or a missing owner fails explicitly. Unloading rejects unfinished requests and releases its observer; late results cannot reopen dismissed dialogs.

The login page presents one browser-login button and the product logo. Waiting, cancellation, exchange retry, expiry, independent device logout and account switching use Main-confirmed state. Opening the browser does not report sign-in.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

## Model Experience

### Account surfaces

#### What the model sees

Account Settings register `mantur-account` in `settings.section`; native dialogs register the same ID in `shell.overlay` and open on `mantur/native-account-open`. These entries remain browser presentation; their copy and state are never included in model requests.

#### Token effect

The account surfaces contribute zero tokens to model requests.

#### KV Cache effect

The account surfaces do not alter model request prefixes or cache reuse.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Native Not now waits for Main's persisted confirmation and survives renderer reload; account cleanup does not block local session creation.
- Simulated-preload browser tests do not establish native OS storage, real website consent or account authorization. Native macOS and Windows acceptance remain separate requirements.
- Skills already installed into the local live directory remain available when a maintainer changes the Host environment configuration.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Native Settings and marketplace dialogs share one Main account owner. Offline validation does not erase a locally active, unexpired grant; authoritative revocation blocks it. The [browser authorization decision](../../../.agents/notes/implemented/architecture/2026-09-08-browser-account-authorization.md) owns recovery and verification requirements.

</details>

**Runtime invariant:** no runtime invariant companion is published. This browser package owns no durable event stream or cross-plugin mutable state; its optional entry registrations and effect disposal are observed directly by package tests.
