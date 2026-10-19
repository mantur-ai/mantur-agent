# Agent Note: Publish desktop downloads and updates through TOS

Status: implemented

English | [中文](2026-10-16-tos-desktop-distribution.zh.md)

## Problem

Users cannot reliably download installers or update metadata from GitHub on some mainland networks. Published 0.1.18 clients embed the GitHub provider.

## Decision

Desktop 0.1.20 uses the existing HTTPS resource domain and a generic update provider. Release automation uploads hash-verified files to immutable version directories in the existing Singapore TOS bucket, validates anonymous range access, then writes no-cache stable metadata with versioned artifact URLs. Only release objects receive public-read ACLs. The protected release environment stores credentials. A manual sync workflow supports retrying publication and adding manually released Windows installers. A cancelled or failed upstream build cannot publish; skipped optional Windows signing does not suppress Mac publication. Manual download links stay fixed under `stable/` and carry revalidation headers; only verified, present platform installers advance, with downgrade protection. Auto-update artifacts remain versioned so website deployments do not control desktop releases.

## Alternatives considered

Expiring signed URLs cannot serve an enduring update channel. Making the whole bucket public would expose unrelated assets. Replacing files inside signed 0.1.18 packages would invalidate signatures. None is used.

## Consequences

Clients unable to reach GitHub need one manual installation to migrate. Unsigned Windows installers remain manual-only. Existing signatures remain intact when mirroring packages. Tests reject corrupted artifacts, incorrect versions and update digests, unsafe filenames and missing metadata; the installed generic provider resolves the versioned TOS ZIP. A regional mainland download test remains necessary because a successful local transfer does not measure all users' networks.
