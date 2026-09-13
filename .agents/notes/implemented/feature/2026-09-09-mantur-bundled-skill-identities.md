# Agent Note: Exact App-bundled Skill identities

Status: implemented

English | [中文](2026-09-09-mantur-bundled-skill-identities.zh.md)

## Problem

Homepage presets must remain usable without installing Skills or authenticating to the marketplace. A user directory can contain an older Skill with the same name, so name-only resolution cannot identify the App's selected instructions.

## Decision

The desktop distributes pinned ZIPs with complete file inventories. Preparation verifies archive hashes and bounded extraction; loading verifies every file, the instruction name and version. The identity combines canonical name, version and a digest of the sorted file inventory. Resources live outside user and project Skill roots and use identity-specific directories.

The homepage inserts a `mantur-bundled-skill` reference. Its serializer verifies the identity and emits `/mantur-builtin:<name>@<version>#<digest>`. The marketplace Host recognizes this gesture only in direct user messages and appends the verified body through the existing sourced-message pre-step mechanism. The `skill-invocation` source records the version and digest. Missing, changed or non-user-invocable resources reject loading without substitution.

Ordinary `/name`, installed Skills and model-selected Skills keep the [Skill registry's resolution](2026-07-05-skill-system.md). The filesystem parser accepts already-read Markdown so bundle loading parses the exact verified bytes. Homepage selection neither overwrites user content nor submits the draft. Online discovery remains an explicit More skills action.

## Alternatives considered

**Give bundled roots global precedence.** That would override deliberate user and project customizations outside homepage presets.

**Copy bundles into the user directory.** That would conflate App resources with user-owned content and require startup writes or overwrite policy.

**Use the online catalog when local resources are missing.** That would hide packaging defects and silently change the selected version or account requirements.

## Consequences

The [keyless headless scenario](../../../../snapshots/session/mantur-bundled-skill/snapshot.yml) mounts the production injection hook through the shipped `dsh` profile. Its recorded request includes the selected body and bundled provenance while the ordinary catalog retains an older same-name user Skill.

App updates can advertise new identities while saved references retain the captured version. An old reference unavailable in the running App fails explicitly; existing logged instructions remain unchanged. The resource digest detects changed bytes relative to the bundled manifest, not an independently authenticated publisher signature.

Targeted tests cover the four audited archives, file alteration and absence, links, mismatched frontmatter versions, offline Host reads, same-name user copies, direct-user-only injection and recorded provenance. UI tests retain online installation cancellation and draft transfer coverage while adding offline selection. Content source approval and redistribution rights remain separate from technical package validation; suites without a supported root entry are not converted into ordinary Skills.
