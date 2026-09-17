# Agent Note: Desktop client sessions and managed OpenAPI keys

Status: implemented

English | [中文](2026-09-17-client-session-migration.zh.md)

## Problem

The upstream account gateway exposes LOOPBACK/PKCE client sessions and rotating tokens. The retired browser-account-v2 device grant cannot authorize the current OpenAPI quote and invocation endpoints. Replacing the embedded CLI without changing Main would either fail or create an independent desktop identity.

## Decision

Main uses client sessions and OS-encrypted origin-scoped storage. Production defaults to `https://hub.mantur.ai`; test deployment is explicit. A dedicated ninety-day API Key authorizes OpenAPI calls through the existing command broker. The CLI receives only a private expiring broker descriptor, never the account tokens or API Key. Token refresh is single-flight and committed before reuse. Logout disables local authority and joins commands before clearing credentials. One-use exchange loss requires reauthorization; uncertain Key creation is recorded before sending and cannot be repeated automatically.

## Alternatives considered

Independent CLI login was rejected because account switching and logout would diverge from the desktop account. Token-only OpenAPI access was rejected after real quote endpoints returned HTTP 401. Reusing an arbitrary existing personal Key was rejected because ownership and revocation would be ambiguous. The user authorized dedicated Key creation and desktop account migration.

## Consequences

The new encrypted file does not convert the retired device-grant database; an upgraded user signs in again. Remote logout is best effort and local logout remains effective offline. The [browser account decision](2026-09-08-browser-account-authorization.md) remains authoritative for Main ownership, renderer isolation and platform acceptance, while this note replaces its frozen wire protocol. Focused controller, response-body, real child-process and embedded-package checks are required. Production browser authorization, macOS system storage and Windows native acceptance must be reported separately from fixtures.
