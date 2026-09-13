# Agent Note: Pin patched desktop configuration and URI dependencies

Status: implemented

English | [中文](2026-09-08-mantur-main-app-security.zh.md)

## Problem

The desktop dependency closure at the 7300 source baseline contains js-yaml 4.2.0, fast-uri 3.1.3 and ip-address 10.2.0. These packages account for nine high-severity advisories: two YAML CPU-exhaustion findings, six URI interpretation findings and one ambiguous IPv4 parsing finding. Workspace production audits also include dependencies outside the packaged main application, so their total is not a shipped-package inventory.

## Decision

The [workspace overrides](../../../../pnpm-workspace.yaml) select js-yaml 4.3.1 for the vulnerable 4.2.0 selection, fast-uri 3.1.6 under AJV 8.20.0, and ip-address 10.3.1 under express-rate-limit 8.5.2. The lockfile changes only these dependency selections. Owner-scoped overrides retain MCP SDK 1.29.0 and express-rate-limit 8.5.2; the YAML override also covers the vendored Include consumer without editing vendored source.

Js-yaml 4.3.1 is the first v4 release covering both the [merge-work limit](https://github.com/nodeca/js-yaml/security/advisories/GHSA-52cp-r559-cp3m) and [ordered-map lookup](https://github.com/nodeca/js-yaml/security/advisories/GHSA-5p4m-2wfm-xmqj) findings. Fast-uri [3.1.6](https://github.com/fastify/fast-uri/releases/tag/v3.1.6) completes the six URI fixes while retaining the v3 API. Ip-address [10.3.1](https://github.com/beaugunderson/ip-address/security/advisories/GHSA-mwp4-54f8-5fhr) rejects leading-zero IPv4 octets. The limit of 10,000 merged-key visits per YAML document remains enabled; legitimate configurations below it retain merge precedence and the Loader's expression handling.

## Alternatives considered

Refreshing broad semver ranges changes unrelated packages and the MCP stack without addressing additional assigned requirements. Editing vendored Include source duplicates a dependency decision owned by the workspace. Disabling parser limits or suppressing audit findings preserves vulnerable behavior.

## Consequences

The [regression suite](../../../../scripts/main-app-security.spec.ts) resolves dependencies through their actual owning packages. It covers YAML rejection and merge semantics, ordered-map lookup work in an isolated JavaScript realm, malformed URI rejection and Unicode canonicalization, and IPv4/IPv6 rate-limit buckets. Upgrade evidence also includes immutable installation, production audit, existing Loader and MCP/RPC regressions, the Mantur build, and negative controls against the affected versions.

Express-rate-limit uses Address6 and Node's IPv6 detection. The Address4 regression establishes the dependency fix, not an exploitable request path in that consumer. The seven high advisories in the separate e2b/vitest chains remain outside this change, and unversioned bundled fragments are not exhaustively inventoried. Source checks do not establish a rebuilt installer's acceptance or GUI behavior; the frozen baseline application remains unchanged.
