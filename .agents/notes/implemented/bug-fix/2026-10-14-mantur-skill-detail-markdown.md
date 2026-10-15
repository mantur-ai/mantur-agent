# Agent Note: Render Mantur skill details as Markdown

Status: implemented

English | [中文](2026-10-14-mantur-skill-detail-markdown.zh.md)

## Problem

Marketplace readmes contain HTML-escaped Markdown and an injected platform-access section for agents. Plain paragraphs expose internal markers and flatten headings and code inside a narrow dialog.

## Decision

The Mantur navigation plugin decodes HTML entities, removes only paired `MANTUR_AGENT_PLATFORM_ACCESS_START` / `END` sections from the displayed readme, and uses the shared untrusted Markdown renderer. The dialog has a responsive 800-pixel width and one scrolling content area. Installed skill instructions remain unchanged.

## Alternatives considered

**Modify downloaded instructions:** rejected because hiding implementation details in the marketplace must not remove instructions needed during execution.

**Render raw HTML:** rejected because catalog content is untrusted; the shared Markdown renderer already owns safe text presentation.

## Consequences

Component checks cover entity decoding, headings, emphasis, code, injected-section removal, and absence of executable script elements. The assembled marketplace snapshot covers the displayed document and dialog width. Windows native visual verification remains pending.
