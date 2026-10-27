# Agent Note: Keep response encoding errors inside the download request

Status: implemented

English | [中文](2026-10-26-mantur-undici-response-errors.zh.md)

## Problem

The embedded editor's AI SDK default downloader uses Undici 7.x. An HTTP response with excessive content encodings and an early connection close can terminate Node even when the caller catches the fetch rejection. Loopback-only inbound HTTP does not protect an outbound download from this response. The [maintainer advisory](https://github.com/nodejs/undici/security/advisories/GHSA-xjj6-f33q-929c) identifies 7.30.1 as the first repaired 7.x version.

## Decision

The editor adds the npm override `undici@7: 7.30.1` and locks its resolved tarball integrity in the cumulative [shutdown patch](../../../../packages/client/ui-mantur-editing/adapters/mantur-cut-shutdown.patch). The [source configuration](../../../../apps/desktop/mantur-cut/source.json) binds that patch's digest and resulting Git tree. The earlier two patches, existing dependency overrides and separately resolved Undici 6.x build dependency retain their values. The [image and archive dependency decision](2026-09-08-mantur-editor-security-dependencies.md) remains independently applicable.

## Alternatives considered

Changing the Harness lockfile does not update the editor's packaged dependencies. A broad audit fix changes unrelated providers and media dependencies. Replacing every Undici major version forces build consumers across a major-version boundary without addressing an additional demonstrated runtime path.

## Consequences

The official [response-encoding regression](https://github.com/nodejs/undici/blob/07ded4941b1e72afec862958c3b8ddf468f3b429/test/fetch/encoding.js) fails with 7.29.0 and passes with 7.30.1 on Node 24.18.1. The same local fixture runs in isolated test processes; the only adaptation selects the installed package path. Normal compressed downloads and rejected oversized encoding chains also pass. The upstream fixture reports a response-length mismatch on the vulnerable version; this is the same early-close failure scenario, not the unavailable original reviewer's socket-error payload.

This dependency-level result does not approve an installer. Each new candidate requires its actual resolved dependency versions, a fresh production audit and assessment of remaining findings, plus the separately owned media, signing and GUI checks. Signed resources are never modified in place.
