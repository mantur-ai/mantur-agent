# Agent Note: Windows installation and login feedback

Status: implemented

English | [中文](2026-09-11-windows-install-and-login-feedback.zh.md)

## Problem

The Windows installer bypassed directory selection. Opening YAML used file associations, so a machine without a YAML editor offered software installation. Missing desktop-login routes appeared as an undifferentiated failure.

## Decision

The desktop NSIS package uses an installation wizard with directory selection. Native text-editor intent selects Windows Notepad, including WSL-translated paths, while general file opening retains file associations. Advanced-configuration copy explains empty initial files and separates them from account login.

The create-attempt HTTP client classifies a 404 as an unavailable endpoint, closes its response body and keeps credentials private. Other operations preserve remote attempt errors. Localized UI distinguishes endpoint availability, incompatible responses and network failure without changing the configured issuer or authentication protocol.

## Alternatives considered

Changing production clients to the test issuer would mix environments. Guessing configuration contents would conceal server failure. Neither is used. An unsigned EXE cannot acquire publisher trust through installer flags.

## Consequences

On 2026-09-11 the production create-attempt route returned 404 while the packaged client reproduced a protocol failure on macOS. Existing backend evidence records v2 deployment only on the test site. Production rollout, real browser consent and Windows signing remain separate requirements; these client corrections do not establish successful production login.

## Verification

Focused HTTP, native path-opening and component tests cover missing routes, remote attempt errors, quoted Windows/WSL paths and localized actions. The real assembled browser scenario records missing-endpoint and incompatible-response states while preserving the draft. Native Windows packaging and OS-level checks remain required for delivery.
