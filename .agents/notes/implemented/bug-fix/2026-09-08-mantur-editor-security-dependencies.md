# Agent Note: Pin patched image and archive dependencies

Status: implemented

English | [中文](2026-09-08-mantur-editor-security-dependencies.zh.md)

## Problem

The embedded editor's production audit reports four high-severity entries from two dependency chains. ONNX Runtime selects adm-zip before 0.6.0, whose archive-size handling can allocate excessive memory. Transformers selects sharp before 0.35.0, which bundles vulnerable libvips code. The two parent packages inherit these findings; they are not four independent vulnerabilities.

## Decision

The editor package overrides `onnxruntime-node > adm-zip` to 0.6.0 and `@huggingface/transformers > sharp` to 0.35.4. Harness attachment storage also requires sharp 0.35.4 or later. The lockfiles retain Transformers 4.2.0, both ONNX Runtime versions, and the speech/model providers. The scoped changes update only these chains and sharp's matching platform binaries. The [source configuration](../../../../apps/desktop/mantur-cut/source.json) records the cumulative third patch and its resulting tree; the base and packaged patches remain fixed.

The version choices follow the [adm-zip release](https://github.com/cthackers/adm-zip/releases/tag/v0.6.0), [libvips advisory](https://github.com/lovell/sharp/security/advisories/GHSA-f88m-g3jw-g9cj), and [libheif advisory](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c). Sharp 0.35.4 provides libvips 8.18.6 and libheif 1.23.2. Harness checks the format allowlist after decoder metadata inspection, so rejecting AVIF as an attachment does not remove the need for a patched decoder. ONNX's installer extracts a named file, so adm-zip's changed directory-entry extraction behavior does not apply to that call. These dependencies support the packaged Node 24 runtime.

## Alternatives considered

Disabling image decoders or inference removes working features. A broad Transformers or ONNX upgrade changes model execution and is unnecessary for these two findings. Editing an audit report does not repair the installed dependency tree. A fourth patch layer would require changing the resource format without improving the dependency fix.

## Consequences

Dependency changes require a fresh immutable install, a production audit, actual image decoding through Transformers, named ZIP-entry extraction, and CPU inference with the retained ONNX versions. Platform-native checks apply only to the tested platform; macOS arm64 does not validate macOS x64 or Windows binaries. A complete rebuilt installer and GUI acceptance remain separate.

The [adm-zip symlink advisory](https://github.com/advisories/GHSA-vwc7-r8mq-g2x9) also covers 0.6.0 and lists no patched release. Its destination-symlink and overwrite conditions require separate installer-path assessment; fixing image decoding is not a clean production audit. Both installed decoder copies require verification in each new signed candidate, and signed resources are never patched in place.

The upstream editor starts semantic, CLAP and rhythm inference in separate utility processes. Loading both ONNX versions into one diagnostic process aborts on natural exit on macOS arm64 in both the original and patched dependency trees; this failure remains recorded. Individual-runtime probes must include natural process exit and preserve the actual worker loading pattern. Passing them does not authorize combining the runtimes or claim that Mantur's embedded HTTP entry exposes the upstream native-ASR bridge.
