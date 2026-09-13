# Agent Note: Composer Skill entry

Status: implemented

English | [中文](2026-09-11-composer-skill-entry.zh.md)

## Problem

The composer duplicated the sidebar marketplace and exposed installation controls where users expected offline Skill shortcuts.

## Decision

The composer recommendation rail contains offline Skill shortcuts only. Online Skill browsing and installation belong to the sidebar marketplace. The More skills button and its private search, detail and installation dialogs are removed at the user's request; hiding the button alone would retain unreachable installation controls.

## Alternatives considered

Hiding only the button retains unreachable dialogs and their login state. Removing the private dialogs keeps online installation with the marketplace owner.

## Consequences

Offline shortcuts remain available without login; online browsing and installation require the sidebar marketplace.

## Verification

Creation-guide and registration tests cover recommendation insertion, preference changes, dismissal and input bindings. The assembled browser scenario records the composer without More skills and preserves draft, attachment and layout checks. Marketplace installation retains its separate owner and tests.
