# Agent Note: Versioned script selection workbench

Status: implemented

English | [中文](2026-09-09-script-workbench.zh.md)

## Problem

Writers need to review and manually edit generated episodes while requesting targeted changes from the existing Agent. Selected text alone cannot distinguish repeated dialogue or identify the file generation that the user reviewed. Independent registrants of the single workbench slot would also replace one another.

## Decision

The [script plugin](../../../../packages/client/ui-mantur-script/README.md) owns one common workbench shell and declares child slots for the optional editing plugin. Content selection leaves visibility unchanged. Mounted content survives same-Session switching and collapse; the layout retains its existing Session lifecycle. Unloading editing removes only its contributions. Successful live editing opens select that content through the shell callback while preserving the existing historical-replay and manual-dismissal suppression.

Each script is an existing project text file. Reading uses the shared Markdown component; exact selections come from LF-normalized source text and UTF-16 offsets. Explicit rewrite requests enter the existing scoped conversation as ordinary logged user messages, carrying the path, generation, original passage and instruction. Sending does not change the conversation composer or claim completion. The selected-rewrite tool verifies the generation and original substring, then uses the filesystem provider's guarded writer and Session sandbox policy. Manual saves and restoration use the same writer. Missing working directories and cross-project paths fail explicitly.

Document drafts are indexed by Session and path in a registration-owned store. Later disk observations preserve dirty drafts and expose a conflict. A save response updates the saved baseline while retaining text typed after that save began. A running-to-idle observation requests file refresh without interpreting it as the outcome of a particular queued message. This decision preserves the independent [details lifecycle](../bug-fix/2026-07-29-web-details-session-lifecycle.md); the scoped supersession audit found no earlier active script-workbench decision.

## Alternatives considered

**Send only selected text.** Rejected because repeated dialogue and stale files cannot be identified safely from that payload.

**Register another root workbench.** Rejected because a second single-slot contribution replaces the existing occupant and loses shared visibility ownership.

**Create another model conversation.** Rejected because script instructions and tool results belong in the user's existing Session history.

## Consequences

The common shell adds no model provider or login requirement. The existing filesystem owns version checks at atomic publication, avoiding a second file writer. Exact offsets distinguish repeated passages and conflict states keep manual text reviewable. The optional editing browser composition requires the common shell rather than supplying an independent root occupant.

Drafts and the last observed restoration point remain browser-lifetime state. Reload recovery and durable multi-version history are deferred. Arbitrary external processes do not share the filesystem's in-process target lock. The workbench edits whole existing files and does not infer episodes, create files, or map selections from rendered Markdown.

## Verification

The package tests exercise real-file guarded writes, duplicate selection offsets, conflict retention, in-flight typing, same-Session delivery, content lifetime, and registry disposal. A test-only Loader composition executes the actual tool over local files and records its schema. Browser composition uses the ordinary Mantur profile with isolated synthetic project files. Paid model calls and application packaging are outside this verification.
