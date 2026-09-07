# Agent Note: Mantur creation modes and assistant guide

Status: implemented

English | [中文](2026-09-06-mantur-creation-guide.zh.md)

## Problem

Drama creators need an entry point organized around writing, production, editing, and assets. A shortcut must help compose the current request without replacing an existing draft or silently changing the Agent's identity, model, or permissions.

## Decision

The Mantur navigation plugin occupies three generic conversation slots: creation choices below the headline, contextual guidance above the resident composer, and composition of owner-created heading, workspace, and content nodes. Host settings persist the last mode and explicit dismissal. Mode selection changes only the catalog recommendation filter and locale-owned guide copy; it never selects an Agent preset or adds model context.

Mantur places the existing workspace picker in a left-aligned footer directly below the input card. Rendering that same control after the editor keeps visual and keyboard order aligned without duplicating workspace state or draft-transfer logic. The content node retains its React position when the hero closes; the official composition retains the workspace-before-editor order.

The product composition supplies ordered real marketplace slugs. The browser intersects those lists with the current Host catalog and keeps fewer recommendations when matching Skills are absent. Catalog failures remain visible with Retry. Shortcut insertion uses the Session input facade to append a titled reference and deduplicate its source/ref identity. It never submits. Installation must succeed before insertion, and a Session switch invalidates the pending insertion. Marketplace Use retains the separate new-Session behavior described in the [marketplace decision](2026-09-03-mantur-marketplace-navigation.md).

Recommendation buttons use a curated localized short name, at most four Chinese characters. Catalog titles remain in tooltips, details, and inserted references; missing mappings produce an explicit configuration warning. Short names never change Skill IDs or model-visible references.

馒头仔 presents fixed copy in a fixed-position bubble anchored above/right of the mascot. It does not occupy a layout row, so its visibility and copy cannot move the recommendation row or composer. A constrained gap below the mode tabs uses the space beside them when it provides at least 180px of reading width; narrower windows keep the scrollable body below the tabs. This avoids clipping guidance to less than one line at the desktop's 880×600 minimum without changing text size, composer layout, or distance above the mascot. The close button stays outside the scroll area. Dismissal persists without forcing the bubble open after mode changes. The first message collapses the welcome region. The [Mantur brand identity](2026-09-02-mantur-brand-identity.md) remains unchanged; the assistant is not a replacement product logo.

Below 820px viewport width, the hero recommendation row reserves an additional 40px whether the guide is open or closed. This preserves a readable body below the tabs when the right-hand placement is too narrow, including the unassigned editor's automatic-project footer. Guide interaction cannot change the reserved height or font size. The mascot button ends at the composer border; its overflowing decorative image does not intercept editor clicks.

## Alternatives considered

**Use modes as Agent presets.** Preset selection can change tools, identity, and model-visible context. The requested navigation choices do not authorize those changes.

**Reuse marketplace Use for shortcuts.** That action creates a new Session. Current-composer reference insertion preserves the user's draft and attachments.

**Invent capability labels to fill every row.** The catalog does not contain four independent writing Skills. Intersecting configured real IDs with live metadata keeps availability and names truthful.

## Consequences

The shared conversation adds placement slots and one append-reference operation; product copy and recommendation policy remain in the Mantur plugin. Preferences use the existing Host settings transport. Guide details have their own open state because the conversation remains mounted behind marketplace pages. Focused tests cover dismissal, late installation settlement, draft preservation, and duplicate insertion; the built browser expectation checks the real Loader, Remote, composer, and narrow-window layout. No guide copy or mode change consumes model tokens.

Workspace switching transfers the complete editor document, reference occurrences, and images through the conversation owner. The [automatic-project decision](2026-09-06-mantur-automatic-project.md) owns durable transfer from the unassigned editor, including cancellation and retry behavior.

Every Web build includes the approved 2x/3x transparent mascot assets because the shipped Mantur overlay can load its UI plugin against the common frontend. The existing mode setting selects the four peeking illustrations without a second mode state. A fixed 184×120 canvas aligns its y=104 contact line with the composer border; the square welcome illustration serves the compact helper and existing native account illustrations without squeezing a peeking pose into a square. Original artwork remains archived, with no runtime substitution for missing assets. Component tests pin the mapping; built-browser checks cover asset decoding, contact geometry, mode persistence and draft preservation. Document metadata, favicon, and install-manifest branding remain profile-owned.
