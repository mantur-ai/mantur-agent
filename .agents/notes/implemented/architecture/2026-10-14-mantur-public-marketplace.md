# Agent Note: Mantur public marketplace gateway

Status: implemented

English | [中文](2026-10-14-mantur-public-marketplace.zh.md)

## Problem

The desktop marketplace requested retired `/api/v1/skills` and `/api/v1/recipes` endpoints that return HTTP 404 in production. Public discovery moved to a paginated gateway with different metadata fields and anonymous Skill bundles.

The Host retains the gateway input schema and ordered steps. The client renders input descriptions, required fields, choices, defaults and step notes; empty schemas and step lists remain absent. Steps do not substitute for missing reproduction instructions.

## Decision

The Mantur marketplace plugin uses `/api/public/agent/v1` for Skill and Recipe discovery, detail and Skill bundles. It validates successful gateway envelopes, reads every Skill page, rejects inconsistent pagination and duplicate codes, and retains the existing bounded archive extraction and atomic installation. Public downloads do not carry credentials. No upstream core files change.

Recipe projection retains missing prices, authors, operator codes and copy counts as null. Gateway sample kinds accept the observed uppercase and lowercase values. Published timestamps retain their original timezone information, including an absent timezone. Published `usage` supplies reproduction instructions; missing instructions leave previews available while both the UI and store reject launch. No instructions, model names or prices are invented from a sample.

## Alternatives considered

**Only replace the endpoint prefix.** Pagination, field names and the bundle endpoint also changed, so a prefix replacement cannot restore listing and installation.

**Synthesize missing recipe instructions.** A sample does not establish reproducible parameters or authorization to invoke an operator. Missing instructions remain visible as an unavailable launch.

## Consequences

The plugin can browse production catalogs and install public Skills without sending credentials. Desktop presentation retains its explicit login flow before installation. Recipe entries without production instructions remain preview-only. The opt-in public integration test reads real production catalogs and installs a real bundle into a temporary directory without paid operations. This change does not establish Windows production-pipeline execution; standalone Node discovery and the bundled Skill's Electron child-process environment remain separate diagnostic concerns.
