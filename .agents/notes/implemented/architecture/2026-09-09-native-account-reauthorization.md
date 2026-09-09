# Agent Note: Explicit reauthorization for desktop account upgrades

Status: implemented

English | [中文](2026-09-09-native-account-reauthorization.zh.md)

## Problem

An installed desktop can retain a version-1 account database after its application files are replaced with browser-account-v2 code. Rejecting that database during Host initialization leaves the user unable to reach browser sign-in or Skip.

## Decision

Main checks for version 1 before starting the Host. A native localized dialog defaults to Quit. Only explicit confirmation creates a private, owner-checked backup beside the account directory and replaces the account database with empty version-2 storage. The backup retains OS-sealed bytes; the operation does not decrypt, import or remotely revoke old credentials. Projects, drafts, model credentials and other account files are outside the operation.

The replacement database and backup files are synced before atomic publication. A publication failure retains the original database; a directory-sync failure attempts to restore the prepared original copy. If restoration itself fails, the immutable backup remains and startup stops with fixed, secret-free recovery guidance. Unknown versions, unsafe directories and unfinished SQLite work fail without replacement. Main owns the single-instance lock and has not started an account owner during this operation.

Windows recovery fails explicitly because Node does not provide the required durable directory publication. New version-2 profiles remain valid there. The [desktop README](../../../../apps/desktop/README.md) owns user-visible behavior.

## Alternatives considered

**Silently discard or import old account records.** Either choice would change credential authority without explicit consent; importing also implies unsupported compatibility between native-account-v1 and browser-account-v2.

**Reject every old profile at startup.** This preserves data but prevents the ordinary installed-user upgrade path from reaching account onboarding.

## Consequences

A confirmed upgrade requires new browser consent or an explicit Skip. The private backup is recovery material, not an active login, and local replacement does not claim that old server grants were revoked. Synthetic database and Main-dialog tests cover cancellation, private backups, replacement failures and restoration; actual installed-package browser return and OS storage still require separate acceptance on each shipped platform and architecture.
