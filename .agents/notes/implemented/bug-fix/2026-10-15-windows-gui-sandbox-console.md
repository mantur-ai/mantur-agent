# Agent Note: Prepare a console for GUI-launched sandbox runners

Status: implemented

English | [中文](2026-10-15-windows-gui-sandbox-console.zh.md)

## Problem

The Windows ACL sandbox requires children to inherit a console; its native verification records DLL initialization failure when restricted children create one themselves. Electron GUI launches do not guarantee an attached console. The reported PowerShell exit status `0xC0000142` matches that documented failure, but the affected machine has not been reproduced locally.

## Decision

The sandbox runner checks `GetConsoleCP` before creating its restricted token. Without a console it uses `AllocConsole` under its existing token and hides only its newly allocated window. It preserves and restores all three inherited standard handles because console allocation may replace redirected pipes. Preparation errors stop execution. The console lives until runner exit; existing terminal consoles are never hidden or detached.

This changes the upstream runner and FFI files in `packages/sandbox/sandbox-windows-acl`, adds its console preparation helper, and exports existing standard-handle constants from `packages/subprocess/win32-process`. A Mantur profile cannot express native console allocation before restricted-process creation. Token SIDs, filesystem grants, and Job Object ownership remain unchanged.

## Alternatives considered

**Disable confinement or retry unrestricted:** rejected because successful shell startup must not grant broader file access.

**Set CREATE_NO_WINDOW on the restricted child:** rejected because the sandbox's native record identifies this as an initialization failure, not a fix.

## Consequences

Portable tests cover attached-console preservation, handle restoration, absent windows, and API failures. The native runner regression detaches from its console, runs PowerShell through the real runner, and verifies an outside-workspace write is denied. That native test is required for upgrade validation and remains unexecuted on the current macOS host; this patch is not evidence that the reported user's machine is repaired.
