# Agent Note: Isolate recommended Skill update failures

Status: implemented

English | [中文](2026-10-22-bundled-skill-update-isolation.zh.md)

## Problem

Three packaged recommendations are withdrawn from the public marketplace. Their detail requests return 404, and treating the first failed request as failure of the entire homepage catalog hides usable local resources and prevents later recommendations from updating.

## Decision

The marketplace plugin returns available verified identities separately from one update outcome per packaged recommendation. A failed metadata request, download or resource verification records the skill name, failure stage and error. The packaged identity is offered only after its local resources pass verification; a local verification failure is recorded separately and excludes that identity. Cancellation still rejects the operation. A failed online check never certifies the packaged version as the current published version.

The client retains available entries during retries and exposes update failures independently of selection. Exact version and digest references continue to resolve through the existing verifier; retries do not rewrite saved drafts or remove installed skills. Archive digests, bounded extraction, path checks and immutable release publication remain required. No marketplace source or publication changes are involved, and no upstream core file changes are required.

The production mode recommends only `mantur-drama-visual-studio`, with the Chinese tab label `漫剧生产` and the button and newly inserted reference label `全自动漫剧生产线`. Script and asset recommendations retain their composition. This limits recommendation entry points rather than deleting packaged resources, user installations or drafts.

This supersedes the all-recommendations-must-succeed policy in [automatic recommended Skill updates](../architecture/2026-10-14-mantur-recommended-skill-updates.md).

## Alternatives considered

**Reject the whole catalog after one online failure.** A withdrawn listing or network fault would continue hiding unrelated verified skills.

**Report local availability as update success.** Local verification establishes usable bytes, not the current marketplace release. Separate outcomes preserve that distinction.

**Remove withdrawn local skills or change their remote names.** Withdrawal does not invalidate verified local resources or authorize a different skill identity.

## Consequences

Partial update success remains usable, and failed updates remain inspectable and retryable. The response fields change together with their client consumer and tests, so Host and client artifacts must be rebuilt together. No cached-release search selects an arbitrary older online version after a failed check; the fallback is the explicitly packaged identity. Real desktop and network acceptance remain separate from focused source tests.
