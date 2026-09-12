# Agent Note: Mantur storyboard theme

Status: implemented

English | [中文](2026-09-06-mantur-storyboard-theme.zh.md)

## Problem

Mantur needs the approved warm-paper storyboard identity without changing conversation behavior, obscuring complete catalog titles, or tinting image previews. The design's secondary and status colors need stronger contrast for small text on the sidebar.

## Decision

The [Mantur brand plugin](../../../../packages/client/ui-brand-mantur/README.md) owns a disposable, light-only stylesheet. Its body marker limits the palette to Mantur; the existing inert application root excludes onboarding. System dark appearance remains unchanged. Small text uses darker warm-gray, vermilion, green, and amber values than the concept swatches.

The existing frame exposes a decoration selector. The supplied SVG paints only in 12 px top/bottom and 16 px right edge strips, without pointer events, and is hidden below 900 px. These narrower strips keep marks away from the transcript and controls without changing column geometry. Catalog images use neutral gray; video letterboxing stays dark. Typography, complete titles, and the five-column desktop recipe grid keep their existing behavior.

## Alternatives considered

**Replace the shared theme palette.** This would recolor non-Mantur compositions and onboarding, outside the approved scope.

**Register a new persisted theme choice.** The request selects Mantur's light identity, not another settings workflow. Retaining the existing light/dark/system preferences avoids changing stored settings.

**Paint the illustration across the conversation.** Full-page decoration competes with text and changes perceived image colors; edge-only decoration preserves the working area.

## Consequences

The identity stays local to Mantur and unloads with its brand plugin. Dark mode keeps the existing neutral palette rather than gaining an unapproved new design. The keyless Mantur browser scenario checks light/dark switching, onboarding exclusion, asset delivery, neutral previews, title wrapping, and five-column layout; the brand unit test checks stylesheet and marker disposal.
