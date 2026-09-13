# Agent Note: Await local frame extraction before editor closure

Status: implemented

English | [中文](2026-09-08-mantur-extract-frames-shutdown.zh.md)

## Problem

The [editor shutdown owner](2026-09-08-mantur-editing-owned-shutdown.md) rejected local frame extraction as unconfirmed. The route already returned its original asynchronous work, but contact-sheet cleanup swallowed failures and Python stamping bypassed the media process owner. Scene analysis and individual frame failures could return a partial preview without retaining the failed operation for shutdown.

## Decision

The third editor patch admits `openchatcut-extract-frames` into the existing request owner. Accepted requests retain their original completion, including work submitted after browser input stops. New requests are rejected after the cutoff. FFmpeg and FFprobe retain their existing exact child handles; Python stamping uses the same process owner. Operation errors and existing deadlines settle only after the child's `close`, including inherited output pipes. Shutdown does not cancel accepted extraction.

Both extraction and contact-sheet temporary directory removal remain awaited and propagate errors. Scene analysis, individual frame extraction and label failures remain in the request failure record even when upstream preview behavior returns partial output. This does not introduce a fallback or clear an existing failure. Shared contact-sheet code also serves render-still; its renderer shutdown restrictions remain unchanged.

## Alternatives considered

**Allow the plugin name without checking its callees.** This would certify cleanup and subprocess work that its HTTP response does not prove complete.

**Remove unsuccessful samples and forget their errors.** A preview can be useful while the operation still has failed work. The shutdown result must retain that distinction.

## Consequences

A real HTTP regression creates a fresh half-second local H.264 video, exercises explicit timestamps and automatic scene sampling, writes the returned JPEG, decodes it with FFmpeg and confirms the source bytes are unchanged. A controlled request body crosses the admission cutoff; the accepted request completes while another request is refused. A fixture child exits while its descendant holds stderr, proving extraction still waits for actual close. Delayed cleanup remains pending after HTTP200. Cleanup, partial-frame, scene-analysis and grid-cleanup failures reject the cached shutdown result. Removing cleanup error propagation or partial-frame failure recording makes the respective negative control fail.

Browser freeze and flush acknowledgements are controlled broker fixtures. This proves the backend request, media and file lifecycle, not a complete AgentLoop attachment or installed-client workflow. Local upload, Remotion, remote generation and other unowned producers require separate evidence. Dependencies, lockfiles, the audio finalizer and the user's drama projects are unchanged.
