# Agent Note: Optional Mantur account entry

Status: implemented

English | [中文](2026-09-09-optional-mantur-account-entry.zh.md)

## Problem

Account onboarding participates in empty-session setup. An unavailable account owner or unfinished account cleanup can therefore prevent local work that needs no ManturHub credentials.

## Decision

The account UI plugin registers Settings and explicitly requested native dialogs, without a `settings.onboarding` entry in either identity mode. Authentication and exact device-grant revocation remain owned by the existing account services. This change uses client slot extension points and does not modify the agent loop or command scopes.

## Alternatives considered

Automatically recording Skip would change a user preference without an explicit action. Ignoring authentication failures would authorize no cloud request and would conceal the actual failure. Removing the onboarding registration separates local session access from optional account interaction.

## Consequences

Local session creation does not wait for account authorization or cleanup. Cloud operations still require valid credentials. Settings and requested dialogs retain their existing failure and cancellation behavior. Package registration tests cover both identity modes and unavailable native capability; real packaged UI acceptance remains separate.
