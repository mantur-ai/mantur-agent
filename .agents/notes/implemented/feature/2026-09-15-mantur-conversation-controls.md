# Agent Note: Mantur conversation controls

Status: implemented

English | [中文](2026-09-15-mantur-conversation-controls.zh.md)

## Problem

The Mantur conversation displays diagnostic tabs, log downloads and aggregate runtime statistics that users do not need during drama production. Recommended Skills and sidebar credits also have different left edges from their adjacent controls.

## Decision

The [Mantur bundle](../../../../packages/bundle/mantur-app/README.md) disables `ui-trajectory` and `session-log-download`. With only the conversation view registered, the shared header omits its tab bar. The [navigation plugin](../../../../packages/client/ui-mantur-navigation/README.md) shadows only the composer dock's `stats` entry with an empty component at priority -1. Disposal restores the shared occupant; session persistence and other dock entries remain available.

Skill buttons use the composer's side clearance. Expanded sidebar credit icons and numbers align with the Settings icon and text; collapsed credits retain their compact layout.

## Alternatives considered

Changing the shared conversation or chat implementation would affect other profiles. Hiding generated CSS classes would depend on build-specific names. Existing profile and slot overrides express the requested Mantur behavior.

## Consequences

The Mantur header and composer omit these diagnostics, including the browser `/export` command. Durable messages and background statistics remain enabled. The ordinary Web profile retains its existing controls. A recorded-turn browser check covers the conversation before and after reload; geometry checks cover the credit and Skill alignments.
