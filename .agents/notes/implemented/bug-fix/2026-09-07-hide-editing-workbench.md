# Agent Note: Retain the current editing workbench when hidden

Status: implemented

English | [中文](2026-09-07-hide-editing-workbench.zh.md)

## Problem

Closing the workbench unmounts the browser editor. Its native Agent bridge unregisters, and reopening creates a different editor identity. A bound MCP client rejects that replacement as stale even when the project revision is unchanged. Unapplied editing operations can therefore become inaccessible during an ordinary panel-hide action.

## Decision

The [layout owner](../../../../packages/client/ui-layout/src/client/AppFrame.tsx) retains an opened workbench for the selected Session and hides it with the native `hidden` attribute. The stylesheet preserves `display: none` for that state. The child mounts only after first opening; selecting another Session or unmounting the shell releases it. Other Sessions do not retain browser editors. The existing open-state memory remains separate from the mounted instance.

The generic layout requires this change because it owns the conditional that removes the entire editing plugin subtree; a child plugin cannot prevent that removal. The affected upstream files are AppFrame, its stylesheet, and the layout slot/service documentation. The [editing integration](../feature/2026-09-06-mantur-local-editing-workbench.md) retains its existing Host and MCP ownership. No transport, identity check, tool replay, or project format changes.

## Alternatives considered

**Reconnect or rebind after hiding.** This changes connection recovery and draft ownership instead of preserving the editor during a display-only action. Native stale-binding protection remains intact.

**Retain every visited Session editor.** This adds a resource-retention policy for historical Sessions. Retention is bounded to the selected Session; returning after a Session switch does not promise continuation of an old draft.

## Consequences

A hidden current editor retains its memory and native bridge until the Session changes or its owner is disposed. Hidden content is excluded from layout and keyboard navigation. Explicit editor reload and page refresh still recreate the editor; saved files remain, but old drafts are not automatically resumed or replayed.

The upgrade check covers lazy first mount, repeated hide/show with one editor identity, Session isolation, and disposal. Full-client verification imports a local video into a two-operation draft, hides and reopens the same editor, then uses native review and terminal read to confirm the visible, persisted video. The AppFrame regression and its owner-local DOM snapshot pin the hidden subtree and release on Session change.
