# Agent Note: Await local upload completion before editor closure

Status: implemented

English | [中文](2026-09-08-mantur-local-upload-shutdown.zh.md)

## Problem

The upload route discarded its asynchronous result, so editor shutdown could not confirm accepted uploads had finished. On filesystems without hard links, the existing exclusive-copy publication path awaited the file handle while its completed write stream still held a reference. Closing that handle could wait indefinitely, and its errors were swallowed.

## Decision

The route returns its original upload promise. The shutdown owner accepts only exact POST or PUT requests to `/upload` in an isolated runtime profile. That existing profile excludes R2 mirroring and legacy upload synchronization. Default profiles, DELETE and other upload-plugin routes remain unconfirmed.

The existing exclusive-copy path retains its write stream, destroys it after copying and awaits its actual `close` event. Stream destruction releases the file-handle reference; close errors propagate through the upload result and remain in the shutdown failure record. Accepted request bodies and storage work finish before browser flush. Requests after the admission cutoff receive 503.

## Alternatives considered

**Allow the entire upload plugin.** Its other routes and default-profile background work do not have this completion evidence.

**Ignore file-close errors or add a shutdown timeout fallback.** Neither proves the accepted file operation completed. The existing copy path must release its stream reference and retain errors.

## Consequences

Seven owner-local HTTP regressions use fresh 0.2-second H.264 fixtures: POST followed by frame extraction, PUT, a streamed body crossing shutdown admission, delayed copy close, failed close, deduplication and an unsupported DELETE. They compare uploaded bytes and hashes, preserve the source, and check partial-file removal on success. Negative controls discard handler completion, swallow close errors and incorrectly admit DELETE; each fails its corresponding assertion. Existing upload-route and five HTTP shutdown regressions remain passing.

Broker freeze and flush acknowledgements are controlled fixtures. These checks establish backend media and request completion, not installed-client GUI behavior, AgentLoop attachment, filesystem ownership guarantees or an original drama edit. The upload change adds no dependency, cloud operation or public MCP tool.
