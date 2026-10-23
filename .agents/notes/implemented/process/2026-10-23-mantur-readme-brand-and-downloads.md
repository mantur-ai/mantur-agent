# Agent Note: Mantur README branding and release downloads

Status: implemented

English | [中文](2026-10-23-mantur-readme-brand-and-downloads.zh.md)

## Problem

The repository entry page needs a product identity independent of the organization avatar and installation guidance that distinguishes the versions actually available for each platform.

## Decision

The root README pair uses the existing blue infinity PNG from the Web public assets. It keeps the product name, task-oriented introduction, screenshots, upstream attribution and license links. The root pages omit YAML frontmatter so GitHub opens with the product mark rather than a metadata table; package README metadata rules remain unchanged.

Download links use the official TOS stable addresses owned by the [desktop release configuration](../../../../apps/desktop/package.json) and [publication procedure](../../../../apps/desktop/README.md). A dated platform table distinguishes available installer versions. Release assets, anonymous HEAD responses and successful signing workflow steps establish distribution claims; source-only or unmerged work does not establish a released capability.

The [product identity decision](../feature/2026-09-02-mantur-brand-identity.md) retains ownership of runtime branding. This documentation decision neither supersedes that mechanism nor changes the organization avatar or image assets.

## Alternatives considered

**Change the organization avatar.** It is shared by repositories and does not provide a repository-specific product header.

**Treat the latest GitHub tag as every platform's installer version.** The official stable Windows installer can differ from the latest Mac release and from the Windows assets attached to GitHub. Each platform needs its own availability check.

## Consequences

Readers can identify the product and download an available installer without treating update metadata as an installer. Stable addresses can advance, so the displayed versions carry a verification date and require rechecking when this guidance changes. Windows signing and update availability remain explicit limitations.

The README and this note remain bilingual triplets. Pairing, Markdown links, formatting and an independent content review verify the documentation; installer execution and authenticated creative workflows remain separate product acceptance work.
