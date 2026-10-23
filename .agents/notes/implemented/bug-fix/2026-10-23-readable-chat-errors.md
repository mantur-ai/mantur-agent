# Agent Note: Readable chat failures

Status: implemented

English | [中文](2026-10-23-readable-chat-errors.zh.md)

## Problem

Provider diagnostics contain technical English and long identifiers. A separate error-code column leaves too little space for the failure explanation in narrow chat panels.

## Decision

The chat renderer selects localized guidance by stable error code and places the original code and diagnostic in collapsed native details. Authentication diagnostics remain hidden. Unknown codes receive general guidance without inferring a cause. The failure row reserves its remaining width for text and permits long diagnostics to wrap.

This change belongs in the upstream chat renderer because plugin slots cannot override the internal layout of its owned failure nodes. Persisted events, provider errors and model-visible data remain unchanged.

## Alternatives considered

Translating provider messages in place loses diagnostic fidelity. Guessing categories from English substrings couples guidance to unstable provider wording. Keeping a separate code column makes narrow layouts harder to read.

## Consequences

Known failures provide actionable localized guidance while technical details remain available for support. New codes require an explicit locale mapping. Automated checks cover classification, collapsed details and authentication redaction. Narrow desktop presentation requires separate visual verification. Other plugins retain ownership of their own failure views.
