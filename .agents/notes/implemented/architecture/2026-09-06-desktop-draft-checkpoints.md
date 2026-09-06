# Agent Note: Desktop draft checkpoints and restart refusal

Status: implemented

English | [中文](2026-09-06-desktop-draft-checkpoints.zh.md)

## Problem

The desktop starts its Web application on a random loopback port. Browser-local text persistence cannot recover drafts across those origins, and unsent image Files and complete reference metadata otherwise live only in the renderer. A successful process exit or a resolved Cordis disposer does not prove that final task events reached durable storage: teardown catches and logs failures.

## Decision

The [desktop carrier](../../../../apps/desktop/README.md#draft-checkpoints) owns one private, versioned draft file. Its narrow preload messages carry complete editor documents and selected image bytes, never arbitrary paths or browser object URLs. Main-frame authorization, whole-checkpoint revision comparison, attachment digests, and file synchronization precede each save receipt. Input locks cover restart saves and two-owner transfers; cancellation and failures release them. Full Lexical documents retain Skill identities and display labels, while separately recorded occurrence ids bind to the restored document order.

Each restart preparation owns a distinct set of input-lock releases. Cancellation detaches that ownership before unlocking; a late failure can release only the same preparation, and a late success cannot return its cancelled receipt. A newer preparation remains locked until its own release. Deterministic barriers cover cancellation followed by both delayed failure and delayed success while a newer save is pending.

The update installer refuses to proceed without a verified final Host checkpoint. It does not treat draft persistence, process closure, log messages, or `fiber.dispose()` resolution as that checkpoint. The refusal stops neither local tasks nor remote work. Windows draft durability and the unassigned-composer integration remain explicit limitations; neither receives simulated success.

## Alternatives considered

Keeping localStorage as the only copy loses origin-independent recovery and attachment bytes. Saving only clipboard text loses reference metadata. Separate source and destination writes can duplicate or lose an unassigned draft during transfer. Accepting a teardown promise hides failures contained by Cordis. Changing vendored teardown behavior or adding a global task-admission freeze would exceed this bounded draft change.

## Consequences

Draft checkpoints add private disk usage proportional to selected images. The file and directory synchronization path is verified on macOS only; Windows publication remains blocked until a native durable rename implementation is supplied. The draft format rejects unsupported versions. A current-origin legacy text draft can be imported, but conflicting content causes an explicit error. The application does not scan other origins or production profiles. Full automatic installation remains incomplete until the Host can stop accepting work and report final persistence failures reliably.

## Verification

Focused tests cover real temporary-file persistence and permissions, stale revisions, attachment corruption, exact Skill and occurrence restoration, native frame authorization, timeouts, late save receipts, and lock release. A real Loader browser test reopens the same Session on a second random loopback origin and verifies text, original PNG bytes, and the attachment digest without old localStorage. Test images and native messages are isolated fixtures. No release is published, no installed application is updated, and no user runtime is restarted by these tests.
