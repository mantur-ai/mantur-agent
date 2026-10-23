# Agent Note: Marketplace Skill drafts

Status: implemented

English | [中文](2026-10-22-marketplace-skill-drafts.zh.md)

## Problem

The marketplace rejected installed Skill use without a selected Project. Install and use actions also looked identical, hiding installation state.

## Decision

The Mantur navigation plugin appends the existing structured `skill` reference and returns to conversation. With a selected Project it opens a new Session in that Project; without one it uses the resident unassigned draft. The existing first-send policy owns Project and Session preparation. Text and attachments in that draft remain intact, and repeated selection of the same reference is idempotent. Installed labels and green use actions distinguish installed Skills from neutral installation actions.

## Alternatives considered

**Remove the Project check and create an unassigned Session.** A Session needs valid Workspace ownership; the existing resident draft already defers creation safely.

**Prefill a plain slash command.** A structured reference gives the user a visible removable chip and reuses the installed Skill codec without replacing draft text.

## Consequences

No core files or model protocol change. Installing remains Host-confirmed and selecting never submits a turn. Different Skill references can coexist, matching existing composer shortcuts. Focused controller tests cover project ownership and locked input; the real-composition automatic-project browser test covers marketplace navigation, draft preservation, reload and explicit first Send without a real model.
