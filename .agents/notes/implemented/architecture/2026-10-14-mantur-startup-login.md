# Agent Note: Mantur startup login

Status: implemented

English | [中文](2026-10-14-mantur-startup-login.zh.md)

## Problem

The native account plugin exposes Settings and requested dialogs but leaves unauthenticated installations on the conversation page. Sending a message can then fail with an unrelated missing model credential before account setup is visible.

## Decision

A root overlay observes the existing Main-owned account client at startup. Checking and failed authentication remain visible; only a settled authenticated snapshot releases the overlay. Persisted Skip choices do not bypass this check. The root slot covers restored conversations as well as blank sessions, without modifying the shared settings coordinator or agent loop.

After successful authentication the overlay stays dismissed for that renderer lifetime. Account changes remain owned by existing Settings and requested dialogs. Restarting or reloading checks authentication again. Login does not provision an independent model API key.

## Alternatives considered

Using the settings onboarding slot misses restored nonblank conversations. A root overlay covers every startup without changing the shared coordinator.

## Consequences

The startup page requires account login. It leaves model credentials and paid production authorization independent.

## Verification

Account component tests cover signed-out, skipped, pending and authenticated snapshots. The assembled native-account scenario checks startup login, browser waiting and failure, reload, and returning to marketplace details without losing drafts. Real production login and packaged Skill execution require separate live acceptance.
