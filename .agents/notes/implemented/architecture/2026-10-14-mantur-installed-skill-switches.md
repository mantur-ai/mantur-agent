# Agent Note: Installed skill switches and localized command menus

Status: implemented

English | [中文](2026-10-14-mantur-installed-skill-switches.zh.md)

## Problem

Installed skills lack a visible management entry and users cannot disable their invocation. English command labels make the shared reference menu unclear.

## Decision

The Mantur marketplace owns a local installed-skill manager and persists disabled names in the active Harness home. Updates preserve the switch because version files do not own user preferences. A switch applies to every version and provider with the same name. Historical instruction messages remain intact; this is invocation control, not filesystem access control.

The existing registry had provider-owned invocation flags but no deployment policy hook. `packages/skill/skill/src/index.ts` and `src/types.ts` add `skills/enabled`: summaries expose both flags as false when denied, and body reads check before and after provider loading. The Mantur plugin supplies persistent policy and also checks the exact bundled invocation path. This avoids hiding only UI rows while direct loads still succeed. Removing the policy listener restores ordinary registry behavior.

`packages/client/ui-commands/src/client/service.ts` localizes known command labels while preserving canonical candidate values for dispatch and English search. The input trigger menu retains command-before-skill ordering with a visible divider and a larger bounded viewport. These core presentation changes have no equivalent existing Mantur-only label extension.

## Alternatives considered

Hiding menu rows alone leaves manual invocations available. Deleting skill directories loses user files and cannot manage read-only application resources.

## Consequences

Disabling affects subsequent skill loads and preserves history and files. Management lists this client’s local catalog and packaged manifest; it does not enumerate other projects’ private skills.

## Verification

Upgrade evidence covers persistence across Host recreation, denied registry body loads, denial during in-flight loading, disabled exact bundled references, switch save failures, Chinese menu selection and canonical dispatch. The local acceptance app exercises the same profile and generated Remote methods.

The Mantur profile enables a host filesystem provider named `mantur-global-skills` so installed user skills are available to the management page before any conversation preset is mounted. Preset providers retain their own scoped discovery.

The composer command launcher includes the skill source beneath commands. `toggleSource` accepts explicit additional groups, retaining their roster order and ordinary reference selection behavior. This changes `ui-conversation` launcher wiring because the previous single-source call excluded installed skills; the source-launcher regression verifies selecting a skill from the combined menu.
