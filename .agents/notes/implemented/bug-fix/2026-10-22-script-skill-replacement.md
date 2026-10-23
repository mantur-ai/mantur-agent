# Agent Note: Replace the retired script recommendation

Status: implemented

English | [中文](2026-10-22-script-skill-replacement.zh.md)

## Problem

The public marketplace withdraws `short-drama`, so checking that name returns 404. Deleting its packaged resources would also invalidate existing exact draft references.

## Decision

The Mantur profile recommends `overseas-comic-script-studio`, whose public title is 出海短剧剧本创编. Its pinned archive and file inventory pass the same verification as other packaged Skills. `bundledUpdateNames` explicitly selects packaged names for online checks. Missing names reject before network access; omission preserves the all-packaged behavior. The profile excludes `short-drama` from this list while retaining its immutable packaged resources and its original identity. User installations and persisted references are not rewritten.

## Alternatives considered

Changing only the button leaves retired metadata requests active. Deleting the old archive breaks exact references. Aliasing the old name to new content changes the meaning of saved user input. Keeping resource retention separate from update selection avoids all three effects.

## Consequences

Old references remain resolvable offline without querying the withdrawn release. Cached releases remain immutable and are not garbage-collected by update selection. Other recommendation modes retain their update behavior. Host tests cover exclusion, cached reuse, retained exact references and missing configured names; resource preparation verifies the complete pinned archive inventory; client tests cover the new label and reference identity.

The asset recommendation uses `mantur-preroll-remix-studio` with the homepage label 短剧素材智能剪辑. Its predecessor `mantur-smartclip` retains packaged resources and old references but receives no default update checks. Both replacement Skills require the embedded CLI 1.2.10, pinned to its official npm archive with verified digest and locked dependencies; local broker tests verify the desktop identity transport.
