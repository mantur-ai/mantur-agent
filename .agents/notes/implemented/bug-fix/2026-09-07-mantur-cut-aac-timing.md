# Agent Note: Preserve AAC timing in Mantur Cut exports

Status: implemented

English | [中文](2026-09-07-mantur-cut-aac-timing.zh.md)

## Problem

Ordinary single H.264 exports through Remotion 4.0.509 encode AAC into ADTS before copying that audio into MP4. The intermediate format loses encoder priming information. Synthetic impulses through the original software and VideoToolbox paths arrive 2048 samples late at 48 kHz, approximately 42.67 milliseconds. The editor preview and saved timeline do not contain that delay.

## Decision

The controlled [Mantur Cut patch](../../../../packages/client/ui-mantur-editing/adapters/mantur-cut.patch) changes the editor's ordinary, non-muted H.264/AAC render path. Public Remotion options separate the existing PCM16 mix into WAV. After the existing video engine selection and retry finish, the configured FFmpeg performs one native AAC encode directly into the final MP4 and copies the video stream. FFprobe reads the rendered WAV sample rate; the final MP4 movie timescale uses that rate to preserve sample-level audio duration, including one-frame exports. No track offset compensates for priming.

The helper validates Remotion 4.0.509, resolved media executables, and native AAC support before video rendering. Unsupported custom executables fail explicitly; audio finalization never switches encoders or repeats the video render. Explicit mute, custom direct-hardware MP3 processing, separate-audio requests, and other codecs retain their existing paths. Native VideoToolbox uses the ordinary finalizer.

Each export owns a temporary directory beside its destination. The helper renders video and WAV there, encodes the final MP4, checks and syncs the file, renames it to the requested output, and removes its private files. Cancellation and timeout kill the owned media process and await its close before cleanup. I/O, encoding, cancellation, and cleanup errors remain failures; cleanup failure preserves the primary error. The export job reports finalization while AAC is running and retains failure-stage and cleanup metadata. Existing result promotion runs only after this operation resolves.

The patch changes editor render orchestration and its server export caller, not the Harness core, Agent loop, MCP protocol, dependency installations, or lock versions. Its source commit, result tree and patch digest remain recorded in the [editing package README](../../../../packages/client/ui-mantur-editing/README.md#understand-the-implementation).

## Fixed audio presence semantics

Remotion 4.0.509 records an asset container for every successfully rendered frame, including empty containers. Its audio-presence decision checks the nonempty frame-container array. A legal ordinary, non-muted H.264 render therefore produces audio even for pure pictures, silence, or zero-volume sources. PCM separation retains that existing behavior. The editor rejects empty frame ranges; at least one frame reaches a successful stitch. Explicit mute follows the original video-only path, because requesting separate audio there would fail.

The unwanted silent track on pure-picture exports remains an existing dependency defect. This change neither fixes that defect nor promises exact source-track identity for zero-volume assets. The version check and recorded output regression require reassessment when this dependency behavior changes; they never force a silent track to hide an incompatible upgrade.

## Alternatives considered

**Shift audio by a fixed duration.** Priming depends on the encoder and sample rate. Subtracting approximately 43 milliseconds hides the container defect and cannot preserve all ranges or sample rates.

**Keep AAC in ADTS until the last mux.** Stream copying cannot recover the discarded priming metadata. The negative control reintroducing ADTS fails the pulse check by 1024 samples with native AAC.

**Modify or upgrade Remotion.** This fix uses its existing public PCM separation API without changing the installed 4.0.509 packages. Correcting the dependency's audio-presence semantics is separate work with different output consequences.

## Verification

In the patched editor, `npm run verify:audio-finalization` runs process-failure checks and real Remotion renders with an explicitly supplied `CC_BROWSER_EXECUTABLE`; it never downloads a browser. Its owner-local expected JSON records stream durations, pulse offsets and encoder outcomes. The matrix covers 32/48 kHz, 24/30 fps, full and nonzero ranges, mixed and resampled sources, head and tail pulses, minimum one-frame output, silence, pure pictures, zero volume, and explicit mute. macOS additionally requires successful VideoToolbox rendering and an injected final-audio failure that must render video only once. Successful finalization preserves video packet hashes, PTS, DTS and packet durations.

Failure checks cover missing AAC support, rendering, missing WAV, encoding, rename, cleanup, cancellation and timeout. Cancellation and timeout assertions verify that the child PID has exited before the promise settles. Independent simultaneous runs use private directories. TypeScript checks and existing video-engine, direct-hardware, export-stage and export-runtime checks cover adjacent behavior. Windows failure fixtures are explicitly pending because the executable and permission controls are POSIX-specific; Windows rendering and non-Mac hardware remain unverified.

## Consequences

The final mux retains encoder delay metadata and sample-accurate duration at the cost of an additional WAV, temporary video and MP4 on disk, one final mux process, and a configured native AAC requirement. The output is unavailable until finalization completes. A cleanup failure after publication still rejects the job and lets its existing output cleanup remove the published file. The original successful drama export and active user editors are not modified by the synthetic regression run.
